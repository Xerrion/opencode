#!/usr/bin/env python3
"""Validate effective OpenCode agent profiles against security invariants."""

from __future__ import annotations

import json
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass
from fnmatch import fnmatchcase
from pathlib import Path
from typing import Any


ACTIVE_AGENTS = (
    "build",
    "plan",
    "reviewer",
    "software-engineer",
    "researcher",
    "explore",
    "scribe",
    "wow-addon",
    "red-team",
    "autonomous-engineer",
    "agil-refinement",
    "servicenow",
)
DISABLED_AGENTS = ("accountant", "jira")

READ_ONLY_PLAYWRIGHT_TOOLS = (
    "playwright_browser_navigate",
    "playwright_browser_navigate_back",
    "playwright_browser_find",
    "playwright_browser_snapshot",
    "playwright_browser_network_requests",
    "playwright_browser_wait_for",
)
MUTATING_PLAYWRIGHT_TOOLS = (
    "playwright_browser_click",
    "playwright_browser_close",
    "playwright_browser_console_messages",
    "playwright_browser_drag",
    "playwright_browser_drop",
    "playwright_browser_evaluate",
    "playwright_browser_file_upload",
    "playwright_browser_fill_form",
    "playwright_browser_handle_dialog",
    "playwright_browser_hover",
    "playwright_browser_network_request",
    "playwright_browser_press_key",
    "playwright_browser_resize",
    "playwright_browser_run_code_unsafe",
    "playwright_browser_select_option",
    "playwright_browser_tabs",
    "playwright_browser_take_screenshot",
    "playwright_browser_type",
)
MUTATING_NAMESPACES = (
    "atlassian_issue_update",
    "firefly_iii_transaction_create",
    "linear_issue_create",
    "servicenow_artifact_update",
    "supabase_apply_migration",
    "vercel_deploy",
)


@dataclass(frozen=True)
class Rule:
    permission: str
    pattern: str
    action: str


def load_agent(name: str) -> dict[str, Any]:
    result = subprocess.run(
        ["opencode", "debug", "agent", name],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    profile = json.loads(result.stdout)
    if not isinstance(profile, dict):
        raise AssertionError(f"unexpected profile shape for {name}")
    return profile


def assert_agent_unavailable(name: str) -> None:
    result = subprocess.run(
        ["opencode", "debug", "agent", name],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if result.returncode == 0:
        raise AssertionError(f"disabled agent is active: {name}")


def parse_rules(agent: dict[str, Any]) -> list[Rule]:
    permission = agent.get("permission")
    if not isinstance(permission, list):
        raise AssertionError(f"unexpected permission shape for {agent.get('name')}")
    return [Rule(**item) for item in permission]


def last_action(agent_rules: list[Rule], permission: str, argument: str = "*") -> str:
    matching = [
        rule.action
        for rule in agent_rules
        if fnmatchcase(argument, rule.pattern)
        and (rule.permission == "*" or fnmatchcase(permission, rule.permission))
    ]
    if not matching:
        raise AssertionError(f"missing rule: {permission} {argument}")
    return matching[-1]


def actions_for(agent_rules: list[Rule], permission: str, argument: str) -> list[str]:
    return [
        rule.action
        for rule in agent_rules
        if fnmatchcase(argument, rule.pattern)
        and (rule.permission == "*" or fnmatchcase(permission, rule.permission))
    ]


def assert_action(
    profiles: dict[str, list[Rule]],
    agent: str,
    permission: str,
    argument: str,
    expected: str,
) -> None:
    actual = last_action(profiles[agent], permission, argument)
    if actual != expected:
        raise AssertionError(
            f"{agent}: expected {permission} {argument}={expected}, got {actual}"
        )


def assert_profile_metadata(raw_profiles: dict[str, dict[str, Any]]) -> None:
    expected_modes = {
        "build": "primary",
        "plan": "primary",
        "autonomous-engineer": "primary",
        "agil-refinement": "primary",
        "servicenow": "primary",
    }
    for name, profile in raw_profiles.items():
        expected_mode = expected_modes.get(name, "subagent")
        if profile.get("mode") != expected_mode:
            raise AssertionError(
                f"{name}: expected mode {expected_mode}, got {profile.get('mode')}"
            )
        if profile.get("disable") is True:
            raise AssertionError(f"active agent is disabled: {name}")

    for name in DISABLED_AGENTS:
        assert_agent_unavailable(name)


def assert_task_targets(profiles: dict[str, list[Rule]]) -> None:
    build_targets = {
        "software-engineer",
        "explore",
        "researcher",
        "scribe",
        "reviewer",
        "wow-addon",
        "red-team",
    }
    autonomous_targets = {
        "explore",
        "researcher",
        "reviewer",
        "scribe",
        "wow-addon",
        "red-team",
    }
    plan_targets = {"explore", "researcher", "wow-addon"}
    for target in ACTIVE_AGENTS:
        assert_action(
            profiles,
            "build",
            "task",
            target,
            "allow" if target in build_targets else "deny",
        )
        assert_action(
            profiles,
            "autonomous-engineer",
            "task",
            target,
            "allow" if target in autonomous_targets else "deny",
        )
        assert_action(
            profiles,
            "plan",
            "task",
            target,
            "allow" if target in plan_targets else "deny",
        )


def assert_read_only_agents(profiles: dict[str, list[Rule]]) -> None:
    write_capable_commands = (
        "git diff --output=review.patch",
        "git status > status.txt",
        "find . -delete",
        "find . -exec touch owned.txt ;",
        "rg secret | Set-Content findings.txt",
        "python -c \"open('owned.txt','w').write('x')\"",
    )
    for agent in ("reviewer", "explore", "researcher"):
        assert_action(profiles, agent, "edit", "src/app.py", "deny")
        assert_action(profiles, agent, "write", "docs/report.md", "deny")
        for command in write_capable_commands:
            assert_action(profiles, agent, "bash", command, "deny")


def assert_research_playwright(profiles: dict[str, list[Rule]]) -> None:
    for agent in ("researcher", "wow-addon"):
        for tool_id in READ_ONLY_PLAYWRIGHT_TOOLS:
            assert_action(profiles, agent, tool_id, "https://example.invalid", "allow")
        for tool_id in MUTATING_PLAYWRIGHT_TOOLS:
            assert_action(profiles, agent, tool_id, "target-element", "deny")
        assert_action(
            profiles, agent, "playwright_future_mutator", "target-element", "deny"
        )


def assert_scribe_paths(profiles: dict[str, list[Rule]]) -> None:
    allowed_paths = (
        "README.md",
        "README-WINDOWS.md",
        "CHANGELOG.md",
        "docs/guide.md",
        "docs/reference/api.mdx",
    )
    denied_paths = (
        "AGENTS.md",
        "nested/AGENTS.md",
        "agents/reviewer.md",
        "commands/build.md",
        "skills/security/SKILL.md",
        ".opencode/agent/reviewer.md",
        ".opencode/agents/reviewer.md",
        ".opencode/command/build.md",
        ".opencode/commands/build.md",
        ".opencode/skill/security/SKILL.md",
        ".opencode/skills/security/SKILL.md",
        "src/config.md",
    )
    for permission in ("edit", "write"):
        for path in allowed_paths:
            assert_action(profiles, "scribe", permission, path, "allow")
        for path in denied_paths:
            assert_action(profiles, "scribe", permission, path, "deny")


def assert_red_team_confinement(profiles: dict[str, list[Rule]]) -> None:
    for permission in ("edit", "write"):
        assert_action(
            profiles, "red-team", permission, ".scratch/red-team/probe.py", "allow"
        )
        assert_action(
            profiles,
            "red-team",
            permission,
            ".deliverables/red-team/report.md",
            "allow",
        )
        assert_action(profiles, "red-team", permission, "src/app.py", "deny")
        assert_action(profiles, "red-team", permission, "../outside.txt", "deny")
    for command in (
        "python .scratch/red-team/probe.py",
        "powershell -Command Set-Content src/app.py owned",
        "npm test -- --outputFile=owned.json",
        "curl -X POST https://example.invalid",
    ):
        assert_action(profiles, "red-team", "bash", command, "deny")


def assert_executor_shell(profiles: dict[str, list[Rule]]) -> None:
    safe_commands = (
        "git status --short",
        "git add agents/reviewer.md",
        "git commit -m \"fix: harden permissions\"",
        "npm test",
        "python -m compileall scripts",
    )
    dangerous_commands = (
        "git push",
        "git push -f origin main",
        "git push origin +main:main",
        "git.exe push --force-with-lease origin main",
        "git -c alias.p=push p -f origin main",
        "git.exe -c alias.p=push p origin +main:main",
        "git-push -f origin main",
        "git -C repo push origin main",
        "git.exe -C repo push origin main",
        "git --git-dir=.git push origin main",
        "git reset --hard HEAD~1",
        "git reset HEAD~1 --hard",
        "git.exe reset HEAD~1 --hard",
        "git -c advice.detachedHead=false reset HEAD~1 --hard",
        "git.exe -c advice.detachedHead=false reset --hard HEAD~1",
        "git-reset --hard HEAD~1",
        "git -C repo reset --hard HEAD",
        "git.exe -C repo reset HEAD --hard",
        "rm -rf build",
        "rm.exe -rf build",
        "del /s /q build",
        "del.exe /s /q build",
        "erase /s /q build",
        "rmdir /s /q build",
        "rd /s /q build",
        "Remove-Item -Recurse build",
        "remove-item -recurse build",
        "sudo reboot",
        "sudo.exe reboot",
        "doas shutdown -h now",
        "doas.exe reboot",
        "su root",
        "shutdown /s /t 0",
        "shutdown.exe /r /t 0",
        "reboot now",
        "Restart-Computer -Force",
        "Stop-Computer -Force",
        "poweroff",
        "halt",
        "systemctl poweroff",
        "systemctl reboot",
    )
    for agent in ("software-engineer", "autonomous-engineer", "servicenow"):
        command_actions = actions_for(profiles[agent], "bash", "npm test")
        if "allow" not in command_actions:
            raise AssertionError(f"{agent}: broad bash allow is missing")
        if command_actions[-1] != "allow":
            raise AssertionError(f"{agent}: broad bash allow is not effective")
        for command in safe_commands:
            assert_action(profiles, agent, "bash", command, "allow")
        for command in dangerous_commands:
            assert_action(profiles, agent, "bash", command, "deny")
            matched_actions = actions_for(profiles[agent], "bash", command)
            if "allow" not in matched_actions or matched_actions[-1] != "deny":
                raise AssertionError(
                    f"{agent}: hard denial must follow broad allow for {command}"
                )

    global_rules = profiles["build"]
    for command in dangerous_commands:
        if last_action(global_rules, "bash", command) != "deny":
            raise AssertionError(f"global shell defaults permit dangerous command: {command}")


def assert_namespace_matrix(profiles: dict[str, list[Rule]]) -> None:
    namespace_owners = {
        "atlassian_issue_update": {"agil-refinement"},
        "servicenow_artifact_update": {"servicenow"},
    }
    for tool_id in MUTATING_NAMESPACES:
        owners = namespace_owners.get(tool_id, set())
        for agent in ACTIVE_AGENTS:
            expected = "allow" if agent in owners else "deny"
            assert_action(profiles, agent, tool_id, "*", expected)


def assert_core_capability_matrix(profiles: dict[str, list[Rule]]) -> None:
    expected = {
        "build": ("deny", "deny", "deny"),
        "plan": ("deny", "allow", "deny"),
        "reviewer": ("deny", "allow", "deny"),
        "software-engineer": ("allow", "allow", "allow"),
        "researcher": ("deny", "deny", "deny"),
        "explore": ("deny", "allow", "deny"),
        "scribe": ("allow", "allow", "deny"),
        "wow-addon": ("deny", "allow", "deny"),
        "red-team": ("allow", "allow", "deny"),
        "autonomous-engineer": ("allow", "allow", "allow"),
        "agil-refinement": ("deny", "allow", "deny"),
        "servicenow": ("allow", "allow", "allow"),
    }
    for agent, (edit_action, read_action, bash_action) in expected.items():
        edit_path = (
            ".scratch/red-team/probe.py"
            if agent == "red-team"
            else "README.md"
            if agent == "scribe"
            else "src/app.py"
        )
        assert_action(profiles, agent, "edit", edit_path, edit_action)
        assert_action(profiles, agent, "read", "src/app.py", read_action)
        assert_action(profiles, agent, "bash", "npm test", bash_action)


def assert_plannotator_ordering(profiles: dict[str, list[Rule]]) -> None:
    assert_action(profiles, "plan", "submit_plan", "*", "allow")
    assert_action(profiles, "build", "submit_plan", "*", "deny")
    plan_rules = profiles["plan"]
    deny_indices = [
        index
        for index, rule in enumerate(plan_rules)
        if rule.permission in ("*", "submit_plan")
        and fnmatchcase("*", rule.pattern)
        and rule.action != "allow"
    ]
    allow_index = max(
        index
        for index, rule in enumerate(plan_rules)
        if rule.permission == "submit_plan" and rule.action == "allow"
    )
    if deny_indices and allow_index <= max(deny_indices):
        raise AssertionError("plan: submit_plan allow must follow inherited restrictions")


def assert_rejects_reintroduced_blockers(profiles: dict[str, list[Rule]]) -> None:
    regression_cases: tuple[
        tuple[str, str, Rule, Callable[[dict[str, list[Rule]]], None]], ...
    ] = (
        (
            "research Playwright mutation",
            "researcher",
            Rule("playwright_browser_click", "*", "allow"),
            assert_research_playwright,
        ),
        (
            "reviewer shell write",
            "reviewer",
            Rule("bash", "git diff*", "allow"),
            assert_read_only_agents,
        ),
        (
            "scribe control-plane write",
            "scribe",
            Rule("edit", "agents/**", "allow"),
            assert_scribe_paths,
        ),
        (
            "red-team outside write",
            "red-team",
            Rule("edit", "*", "allow"),
            assert_red_team_confinement,
        ),
        (
            "executor push",
            "software-engineer",
            Rule("bash", "git push*", "allow"),
            assert_executor_shell,
        ),
        (
            "external namespace mutation",
            "reviewer",
            Rule("servicenow_*", "*", "allow"),
            assert_namespace_matrix,
        ),
    )
    for label, agent, unsafe_rule, assertion in regression_cases:
        unsafe_profiles = {name: list(rules) for name, rules in profiles.items()}
        unsafe_profiles[agent].append(unsafe_rule)
        try:
            assertion(unsafe_profiles)
        except AssertionError:
            continue
        raise AssertionError(f"regression guard accepted unsafe state: {label}")


def assert_no_inline_agent_shells() -> None:
    source = Path("opencode.jsonc").read_text(encoding="utf-8")
    marker = '"agent": {'
    if marker not in source:
        return
    agent_section = source.split(marker, maxsplit=1)[1].split('"provider":', maxsplit=1)[0]
    for name in ACTIVE_AGENTS:
        if f'"{name}": {{' in agent_section:
            raise AssertionError(f"stale inline agent shell: {name}")


def main() -> int:
    raw_profiles = {name: load_agent(name) for name in ACTIVE_AGENTS}
    profiles = {name: parse_rules(profile) for name, profile in raw_profiles.items()}

    assert_profile_metadata(raw_profiles)
    assert_task_targets(profiles)
    assert_read_only_agents(profiles)
    assert_research_playwright(profiles)
    assert_scribe_paths(profiles)
    assert_red_team_confinement(profiles)
    assert_executor_shell(profiles)
    assert_namespace_matrix(profiles)
    assert_core_capability_matrix(profiles)
    assert_plannotator_ordering(profiles)
    assert_rejects_reintroduced_blockers(profiles)
    assert_no_inline_agent_shells()

    print(f"Validated {len(ACTIVE_AGENTS)} effective agent profiles")
    return 0


if __name__ == "__main__":
    sys.exit(main())
