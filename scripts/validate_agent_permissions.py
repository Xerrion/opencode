#!/usr/bin/env python3
"""Validate critical effective OpenCode agent permission profiles."""

from __future__ import annotations

import json
import subprocess
import sys
from dataclasses import dataclass
from fnmatch import fnmatchcase
from pathlib import Path
from typing import Any


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
    return json.loads(result.stdout)


def rules(agent: dict[str, Any]) -> list[Rule]:
    permission = agent["permission"]
    if not isinstance(permission, list):
        raise AssertionError(f"unexpected permission shape for {agent['name']}")
    return [Rule(**item) for item in permission]


def last_action(agent_rules: list[Rule], permission: str, pattern: str = "*") -> str:
    matching = []
    for rule in agent_rules:
        if not fnmatchcase(pattern, rule.pattern):
            continue
        if rule.permission == "*" or fnmatchcase(permission, rule.permission):
            matching.append(rule.action)
    if not matching:
        raise AssertionError(f"missing rule: {permission} {pattern}")
    return matching[-1]


def assert_action(
    profiles: dict[str, list[Rule]],
    agent: str,
    permission: str,
    action: str,
    pattern: str = "*",
) -> None:
    actual = last_action(profiles[agent], permission, pattern)
    if actual != action:
        raise AssertionError(
            f"{agent}: expected {permission} {pattern}={action}, got {actual}"
        )


def main() -> int:
    names = (
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
    profiles = {name: rules(load_agent(name)) for name in names}

    assert_action(profiles, "build", "edit", "deny")
    assert_action(profiles, "build", "bash", "deny")
    assert_action(profiles, "build", "task", "deny")
    for task in (
        "software-engineer",
        "explore",
        "researcher",
        "scribe",
        "reviewer",
        "wow-addon",
        "red-team",
    ):
        assert_action(profiles, "build", "task", "allow", task)

    assert_action(profiles, "reviewer", "edit", "deny")
    assert_action(profiles, "reviewer", "task", "deny")
    assert_action(profiles, "reviewer", "bash", "deny")
    assert_action(profiles, "reviewer", "bash", "allow", "git diff*")

    assert_action(profiles, "software-engineer", "edit", "allow")
    assert_action(profiles, "software-engineer", "bash", "allow")
    assert_action(profiles, "software-engineer", "bash", "deny", "rm *")
    assert_action(
        profiles, "software-engineer", "bash", "deny", "git push --force*"
    )
    assert_action(
        profiles, "software-engineer", "bash", "deny", "git reset --hard*"
    )
    assert_action(profiles, "software-engineer", "task", "deny")

    assert_action(profiles, "researcher", "edit", "deny")
    assert_action(profiles, "researcher", "task", "deny")
    assert_action(profiles, "researcher", "context7_*", "allow")
    assert_action(profiles, "researcher", "exa_*", "allow")
    assert_action(profiles, "researcher", "playwright_*", "allow")
    assert_action(profiles, "researcher", "servicenow_*", "deny")

    assert_action(profiles, "explore", "edit", "deny")
    assert_action(profiles, "explore", "task", "deny")
    assert_action(profiles, "explore", "playwright_*", "deny")
    assert_action(profiles, "explore", "servicenow_*", "deny")

    for agent in names:
        if agent in ("researcher", "wow-addon", "autonomous-engineer"):
            continue
        assert_action(profiles, agent, "gh_grep*", "deny")
    for agent in names:
        if agent == "agil-refinement":
            continue
        assert_action(profiles, agent, "atlassian_*", "deny")
    for agent in names:
        if agent == "servicenow":
            continue
        assert_action(profiles, agent, "servicenow_*", "deny")

    assert_action(profiles, "plan", "bash", "deny")
    assert_action(profiles, "plan", "edit", "deny")
    assert_action(profiles, "plan", "submit_plan", "allow")
    assert_action(profiles, "plan", "task", "allow", "explore")
    assert_action(profiles, "plan", "task", "deny")
    assert_action(profiles, "scribe", "edit", "deny")
    assert_action(profiles, "scribe", "edit", "allow", "**/*.md")
    assert_action(profiles, "red-team", "edit", "deny")
    assert_action(
        profiles, "red-team", "edit", "allow", ".scratch/red-team/**"
    )

    source = Path("opencode.jsonc").read_text(encoding="utf-8")
    agent_section = source.split('"agent": {', maxsplit=1)[1].split(
        '"instructions":', maxsplit=1
    )[0]
    active_file_agents = (
        "agil-refinement",
        "autonomous-engineer",
        "build",
        "explore",
        "plan",
        "red-team",
        "researcher",
        "reviewer",
        "scribe",
        "servicenow",
        "software-engineer",
        "wow-addon",
    )
    for name in active_file_agents:
        if f'"{name}": {{' in agent_section:
            raise AssertionError(f"stale inline agent shell: {name}")

    print("Critical agent permission assertions passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
