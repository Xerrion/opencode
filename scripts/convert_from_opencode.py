#!/usr/bin/env python3
"""Regenerate the GitHub Copilot CLI copy of local opencode assets.

The converter writes only the opencode-derived Copilot CLI files under
``~/.copilot``. It deliberately avoids Copilot CLI runtime/state files and
does not copy opencode plugins, tools, package state, or DCP/MCP runtime config.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path


SOURCE_ROOT = Path("/Users/lasn/.config/opencode")
TARGET_ROOT = Path("/Users/lasn/.copilot")

PROTECTED_TOP_LEVEL_NAMES = {
    "command-history-state.json",
    "config.json",
    "ide",
    "installed-plugins",
    "logs",
    "permissions-config.json",
    "plugin-data",
    "session-state",
    "vscode.session.metadata.cache.json",
}
PROTECTED_TOP_LEVEL_PREFIXES = ("session-store.db",)

ALLOWED_TOP_LEVEL_FILES = {
    "README.md",
    "copilot-instructions.md",
}
ALLOWED_GENERATED_DIRECTORIES = {
    "agents",
    "instructions",
    "scripts",
    "skills",
}
# Deliberately excludes "scripts": it is writable but not generated, and this converter lives there.
PRUNABLE_GENERATED_DIRECTORIES = (
    "agents",
    "instructions",
    "skills",
)
# Authored directly in the Copilot layout with no opencode source, so pruning must leave them alone.
HAND_AUTHORED_TARGETS = frozenset(
    {
        Path("instructions/wow-addon-dev.instructions.md"),
    }
)

SOURCE_EXCLUDED_PARTS = {
    ".git",
    "__pycache__",
    "node_modules",
    "plugins",
    "tools",
}
SOURCE_EXCLUDED_FILE_NAMES = {
    "bun.lock",
    "dcp.jsonc",
    "opencode.jsonc",
    "package-lock.json",
    "package.json",
    "pnpm-lock.yaml",
    "yarn.lock",
}

OPENCODE_AGENT_FRONTMATTER_KEYS = {
    "mode",
    "permission",
    "temperature",
}

PRIVATE_KEY_PATTERN = re.compile(
    r"-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----"
)
SECRET_ASSIGNMENT_PATTERN = re.compile(
    r"(?i)\b(?:password|passwd|secret|token|api[_-]?key|access[_-]?key)\b\s*[:=]\s*"
    r"['\"][^'\"{}$\s][^'\"]{15,}['\"]"
)
WELL_KNOWN_TOKEN_PATTERN = re.compile(
    r"(?i)\b(?:ghp|gho|ghu|ghs|ghr|github_pat|sk-[A-Za-z0-9]|xox[baprs]-)[A-Za-z0-9_\-]{16,}"
)


@dataclass(frozen=True)
class SourceDocument:
    """A Markdown document split into simple YAML metadata and body."""

    path: Path
    metadata: dict[str, str]
    body: str


@dataclass(frozen=True)
class ConvertedFile:
    """A generated target file with optional source provenance."""

    path: Path
    content: str
    source: Path | None = None


@dataclass(frozen=True)
class SkippedSource:
    """A source path intentionally skipped during safe conversion."""

    path: Path
    reason: str


class ConversionError(RuntimeError):
    """Raised when conversion cannot safely continue."""


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Convert opencode configuration into GitHub Copilot CLI layout."
    )
    parser.add_argument("--validate", action="store_true", help="validate the generated target layout")
    parser.add_argument("--list", action="store_true", help="list generated target files")
    parser.add_argument("--dry-run", action="store_true", help="show planned writes without changing files")
    args = parser.parse_args()

    try:
        if not args.validate:
            converted_files, skipped_sources = build_converted_files()
            orphaned_paths = find_orphaned_targets(converted_files)
            if args.dry_run:
                print_planned_writes(converted_files, skipped_sources, orphaned_paths)
            else:
                write_converted_files(converted_files)
                remove_orphaned_targets(orphaned_paths)
                print_skipped_sources(skipped_sources)

        if args.validate:
            for message in validate_target_layout():
                print(message)
            print("Validation passed")

        if args.list:
            print_generated_tree()
    except ConversionError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1

    return 0


def build_converted_files() -> tuple[list[ConvertedFile], list[SkippedSource]]:
    ensure_roots_exist()

    skipped_sources: list[SkippedSource] = []
    converted_files: list[ConvertedFile] = []
    converted_files.append(convert_global_instruction_file())
    converted_files.extend(convert_instruction_files())
    converted_files.extend(convert_agent_files())
    converted_files.extend(convert_skill_files(skipped_sources))
    converted_files.append(ConvertedFile(TARGET_ROOT / "README.md", build_readme()))

    sorted_files = sorted(converted_files, key=lambda converted_file: str(converted_file.path))
    return sorted_files, skipped_sources


def ensure_roots_exist() -> None:
    if not SOURCE_ROOT.exists():
        raise ConversionError(f"source root does not exist: {SOURCE_ROOT}")
    if not TARGET_ROOT.exists():
        raise ConversionError(f"target root does not exist: {TARGET_ROOT}")


def convert_global_instruction_file() -> ConvertedFile:
    source_path = SOURCE_ROOT / "AGENTS.md"
    source_content = read_required_safe_text(source_path)
    header = (
        "# GitHub Copilot CLI Personal Global Instructions\n\n"
        "Generated from `/Users/lasn/.config/opencode/AGENTS.md` for the "
        "GitHub Copilot CLI personal configuration at `~/.copilot`. "
        "Keep opencode as the source of truth and refresh this copy with "
        "`python3 ~/.copilot/scripts/convert_from_opencode.py`.\n\n"
        "---\n\n"
    )
    return ConvertedFile(
        TARGET_ROOT / "copilot-instructions.md",
        normalize_newline(header + source_content),
        source_path,
    )


def convert_instruction_files() -> list[ConvertedFile]:
    instruction_files: list[ConvertedFile] = []
    skills_directory = SOURCE_ROOT / "skills"
    if skills_directory.exists():
        for skill_path in sorted(skills_directory.glob("*/SKILL.md")):
            skill_name = skill_path.parent.name
            source_document = read_source_document(skill_path)
            description = source_document.metadata.get(
                "description", f"Converted opencode skill: {skill_name}"
            )
            frontmatter = build_frontmatter(
                {
                    "description": description,
                    "applyTo": apply_to_for_instruction(skill_name),
                }
            )
            target_path = TARGET_ROOT / "instructions" / f"{slugify(skill_name)}.instructions.md"
            instruction_files.append(
                ConvertedFile(target_path, normalize_newline(frontmatter + source_document.body), skill_path)
            )

    philosophy_path = SOURCE_ROOT / "philosophy" / "AGENTS.md"
    if philosophy_path.exists():
        philosophy_content = read_required_safe_text(philosophy_path)
        frontmatter = build_frontmatter(
            {
                "description": "Philosophy-loading discipline converted from opencode philosophy/AGENTS.md.",
                "applyTo": "**",
            }
        )
        instruction_files.append(
            ConvertedFile(
                TARGET_ROOT / "instructions" / "philosophy-discipline.instructions.md",
                normalize_newline(frontmatter + philosophy_content),
                philosophy_path,
            )
        )

    return instruction_files


def convert_agent_files() -> list[ConvertedFile]:
    agent_files: list[ConvertedFile] = []
    agents_directory = SOURCE_ROOT / "agents"
    if not agents_directory.exists():
        return agent_files

    for agent_path in sorted(agents_directory.glob("*.md")):
        source_document = parse_agent_source_document(agent_path)
        agent_name = agent_path.stem
        description = source_document.metadata.get(
            "description", f"Converted opencode agent: {agent_name}"
        )
        frontmatter = build_frontmatter({"description": description})
        body = prepend_agent_conversion_note(source_document.body)
        target_path = TARGET_ROOT / "agents" / f"{slugify(agent_name)}.agent.md"
        agent_files.append(ConvertedFile(target_path, normalize_newline(frontmatter + body), agent_path))

    return agent_files


def parse_agent_source_document(path: Path) -> SourceDocument:
    source_document = read_source_document(path)
    metadata = {
        key: value
        for key, value in source_document.metadata.items()
        if key not in OPENCODE_AGENT_FRONTMATTER_KEYS
    }
    return SourceDocument(path=source_document.path, metadata=metadata, body=source_document.body)


def convert_skill_files(skipped_sources: list[SkippedSource]) -> list[ConvertedFile]:
    skill_files: list[ConvertedFile] = []
    skills_directory = SOURCE_ROOT / "skills"
    if not skills_directory.exists():
        return skill_files

    for skill_directory in sorted(path for path in skills_directory.iterdir() if path.is_dir()):
        skill_name = skill_directory.name
        for source_path in sorted(path for path in skill_directory.rglob("*") if path.is_file()):
            if should_skip_source_path(source_path):
                skipped_sources.append(SkippedSource(source_path, "excluded source path"))
                continue

            text = read_optional_safe_text(source_path, skipped_sources)
            if text is None:
                continue

            relative_skill_path = source_path.relative_to(skill_directory)
            target_path = TARGET_ROOT / "skills" / skill_name / relative_skill_path
            skill_files.append(ConvertedFile(target_path, normalize_newline(text), source_path))

    return skill_files


def read_source_document(path: Path) -> SourceDocument:
    content = read_required_safe_text(path)
    metadata, body = split_frontmatter(content)
    return SourceDocument(path=path, metadata=metadata, body=body)


def read_required_safe_text(path: Path) -> str:
    try:
        content = path.read_text(encoding="utf-8")
    except UnicodeDecodeError as error:
        raise ConversionError(f"required source is not UTF-8 text: {path}") from error

    if contains_sensitive_literal(content):
        raise ConversionError(f"sensitive-looking literal found; refusing to copy {path}")
    return content


def read_optional_safe_text(path: Path, skipped_sources: list[SkippedSource]) -> str | None:
    try:
        content = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        skipped_sources.append(SkippedSource(path, "non-UTF-8 resource"))
        return None

    if contains_sensitive_literal(content):
        skipped_sources.append(SkippedSource(path, "sensitive-looking literal"))
        return None
    return content


def contains_sensitive_literal(content: str) -> bool:
    return any(
        pattern.search(content)
        for pattern in (PRIVATE_KEY_PATTERN, SECRET_ASSIGNMENT_PATTERN, WELL_KNOWN_TOKEN_PATTERN)
    )


def split_frontmatter(content: str) -> tuple[dict[str, str], str]:
    lines = content.splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        return {}, content

    closing_index = first_frontmatter_closing_index(lines)
    if closing_index is None:
        return {}, content

    metadata = parse_simple_frontmatter(lines[1:closing_index])
    body = "".join(lines[closing_index + 1 :])
    return metadata, body.lstrip("\n")


def first_frontmatter_closing_index(lines: list[str]) -> int | None:
    for index, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            return index
    return None


def parse_simple_frontmatter(lines: list[str]) -> dict[str, str]:
    metadata: dict[str, str] = {}
    for line in lines:
        if line.startswith((" ", "\t")):
            continue

        match = re.match(r"^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$", line.rstrip("\n"))
        if match is None:
            continue

        key, value = match.groups()
        metadata[key] = normalize_frontmatter_value(value)

    return metadata


def normalize_frontmatter_value(value: str) -> str:
    stripped_value = value.strip()
    if (
        len(stripped_value) >= 2
        and stripped_value[0] == stripped_value[-1]
        and stripped_value[0] in {'"', "'"}
    ):
        return stripped_value[1:-1]
    return stripped_value


def build_frontmatter(fields: dict[str, str]) -> str:
    lines = ["---"]
    for key, value in fields.items():
        lines.append(f"{key}: {quote_yaml_string(value)}")
    lines.append("---")
    lines.append("")
    return "\n".join(lines)


def quote_yaml_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def apply_to_for_instruction(skill_name: str) -> str:
    if skill_name.startswith("wow-"):
        return "**/*.{lua,toc,xml}"
    if skill_name.startswith("servicenow-"):
        return "**/*.{js,ts,xml}"
    if skill_name == "frontend-philosophy":
        return "**/*.{css,scss,sass,less,html,js,jsx,ts,tsx,vue,svelte}"
    if skill_name == "mcp-builder":
        return "**/*.{js,jsx,ts,tsx,py,json}"
    return "**"


def prepend_agent_conversion_note(body: str) -> str:
    note = (
        "> Note: Converted from an opencode custom agent for GitHub Copilot CLI. "
        "Opencode-specific delegation, permission, skill-loading, and tool semantics "
        "may require equivalent Copilot CLI tools or MCP servers.\n\n"
    )
    return note + body


def should_skip_source_path(path: Path) -> bool:
    if any(part in SOURCE_EXCLUDED_PARTS for part in path.parts):
        return True
    return path.name in SOURCE_EXCLUDED_FILE_NAMES


def build_readme() -> str:
    return normalize_newline(
        "# GitHub Copilot CLI Personal Configuration\n\n"
        "This directory contains live GitHub Copilot CLI runtime/state plus a "
        "non-destructive opencode-derived copy generated from `/Users/lasn/.config/opencode`. "
        "The canonical Copilot CLI location is `/Users/lasn/.copilot`; the older "
        "`/Users/lasn/.config/github-copilot` conversion is retained only as historical reference.\n\n"
        "## Generated opencode-derived files\n\n"
        "- `copilot-instructions.md` - personal global Copilot CLI instructions generated from opencode `AGENTS.md`.\n"
        "- `instructions/*.instructions.md` - Copilot instruction files generated from opencode skills and philosophy guidance.\n"
        "- `skills/<skill-name>/SKILL.md` - Copilot custom skills copied from opencode skills, with safe skill-local resources preserved.\n"
        "- `agents/<name>.agent.md` - Copilot custom agents converted from opencode agents with opencode-only frontmatter removed.\n"
        "- `scripts/convert_from_opencode.py` - symlink to the versioned converter at `/Users/lasn/.config/opencode/scripts/convert_from_opencode.py`.\n\n"
        "## Pruning\n\n"
        "Each run deletes files under `agents/`, `instructions/`, and `skills/` that the current "
        "conversion no longer produces, so removing an opencode agent or skill also removes its mirror. "
        "`scripts/` is never pruned. Files authored directly here with no opencode source must be listed "
        "in `HAND_AUTHORED_TARGETS` or they will be treated as orphans and deleted. "
        "Use `--dry-run` to preview writes and deletions.\n\n"
        "## Runtime files intentionally untouched\n\n"
        "The converter does not overwrite, delete, move, or inspect Copilot CLI runtime/state such as "
        "`config.json`, `permissions-config.json`, `command-history-state.json`, `session-state/`, "
        "`session-store.db*`, `logs/`, `installed-plugins/`, `plugin-data/`, `ide/`, or "
        "`vscode.session.metadata.cache.json`. Unknown runtime-looking files should be left in place.\n\n"
        "## Not converted\n\n"
        "- VS Code `.prompt.md` and `.chatmode.md` files are not generated because Copilot CLI `~/.copilot` does not use them.\n"
        "- Opencode slash commands have no direct Copilot CLI equivalent; convert one manually to an agent only when it is clearly persona/workflow-like.\n"
        "- Opencode `plugins/`, `tools/`, `.git`, `node_modules`, package locks, and DCP runtime config are excluded.\n"
        "- MCP configuration is not copied automatically because Copilot CLI and opencode wire MCP servers differently and may carry credentials or local runtime assumptions.\n"
        "- Files with obvious private keys or token/secret literal assignments are refused or skipped.\n\n"
        "## Refresh\n\n"
        "```bash\n"
        "python3 /Users/lasn/.copilot/scripts/convert_from_opencode.py\n"
        "python3 /Users/lasn/.copilot/scripts/convert_from_opencode.py --validate --list\n"
        "```\n"
    )


def write_converted_files(converted_files: list[ConvertedFile]) -> None:
    assert_safe_targets([converted_file.path for converted_file in converted_files])
    for converted_file in converted_files:
        converted_file.path.parent.mkdir(parents=True, exist_ok=True)
        converted_file.path.write_text(converted_file.content, encoding="utf-8")
        print(f"Wrote {converted_file.path}")


def find_orphaned_targets(converted_files: list[ConvertedFile]) -> list[Path]:
    """Return generated files this conversion no longer produces.

    Scans only PRUNABLE_GENERATED_DIRECTORIES. Every candidate is re-checked against the
    same target guards used for writes, so a path the converter may not write is also a
    path it may not delete.
    """
    expected_paths = {converted_file.path for converted_file in converted_files}
    orphaned_paths: list[Path] = []
    for directory_name in PRUNABLE_GENERATED_DIRECTORIES:
        directory = TARGET_ROOT / directory_name
        if not directory.is_dir():
            continue
        for path in sorted(directory.rglob("*")):
            if path.is_dir() or path in expected_paths:
                continue
            if path.relative_to(TARGET_ROOT) in HAND_AUTHORED_TARGETS:
                continue
            assert_safe_targets([path])
            orphaned_paths.append(path)
    return orphaned_paths


def remove_orphaned_targets(orphaned_paths: list[Path]) -> None:
    for orphaned_path in orphaned_paths:
        orphaned_path.unlink()
        print(f"Removed {orphaned_path}")
    remove_empty_generated_directories()


def remove_empty_generated_directories() -> None:
    for directory_name in PRUNABLE_GENERATED_DIRECTORIES:
        directory = TARGET_ROOT / directory_name
        if not directory.is_dir():
            continue
        descendants = sorted(directory.rglob("*"), key=lambda path: len(path.parts), reverse=True)
        for path in descendants:
            if path.is_dir() and not any(path.iterdir()):
                path.rmdir()
                print(f"Removed empty {path}")


def assert_safe_targets(paths: list[Path]) -> None:
    for path in paths:
        assert_path_inside_target(path)
        relative_path = path.relative_to(TARGET_ROOT)
        assert_not_protected_target(relative_path)
        if is_allowed_generated_target(relative_path):
            continue
        raise ConversionError(f"refusing to write outside generated Copilot CLI layout: {path}")


def assert_path_inside_target(path: Path) -> None:
    try:
        path.relative_to(TARGET_ROOT)
    except ValueError as error:
        raise ConversionError(f"target path escapes Copilot directory: {path}") from error


def assert_not_protected_target(relative_path: Path) -> None:
    top_level_name = relative_path.parts[0]
    if top_level_name in PROTECTED_TOP_LEVEL_NAMES:
        raise ConversionError(f"refusing to write protected Copilot runtime path: {TARGET_ROOT / relative_path}")
    if any(top_level_name.startswith(prefix) for prefix in PROTECTED_TOP_LEVEL_PREFIXES):
        raise ConversionError(f"refusing to write protected Copilot runtime path: {TARGET_ROOT / relative_path}")


def is_allowed_generated_target(relative_path: Path) -> bool:
    if len(relative_path.parts) == 1:
        return relative_path.name in ALLOWED_TOP_LEVEL_FILES
    return relative_path.parts[0] in ALLOWED_GENERATED_DIRECTORIES


def print_planned_writes(
    converted_files: list[ConvertedFile],
    skipped_sources: list[SkippedSource],
    orphaned_paths: list[Path],
) -> None:
    assert_safe_targets([converted_file.path for converted_file in converted_files])
    for converted_file in converted_files:
        source = f" <- {converted_file.source}" if converted_file.source else ""
        print(f"Would write {converted_file.path}{source}")
    for orphaned_path in orphaned_paths:
        print(f"Would remove {orphaned_path}")
    print_skipped_sources(skipped_sources)


def print_skipped_sources(skipped_sources: list[SkippedSource]) -> None:
    for skipped_source in skipped_sources:
        print(f"Skipped {skipped_source.path}: {skipped_source.reason}")


def validate_target_layout() -> list[str]:
    ensure_roots_exist()
    messages = validate_protected_runtime_paths()
    messages.extend(validate_generated_files())
    messages.extend(validate_markdown_frontmatter())
    messages.extend(validate_generated_content_safety())
    return messages


def validate_protected_runtime_paths() -> list[str]:
    messages: list[str] = []
    for path in protected_runtime_paths_to_check():
        if path.exists():
            messages.append(f"Protected runtime path preserved: {path}")
        else:
            messages.append(f"Protected runtime path absent (not created): {path}")
    return messages


def protected_runtime_paths_to_check() -> list[Path]:
    paths = [TARGET_ROOT / name for name in sorted(PROTECTED_TOP_LEVEL_NAMES)]
    paths.extend(sorted(TARGET_ROOT.glob("session-store.db*")))
    return sorted(set(paths), key=str)


def validate_generated_files() -> list[str]:
    required_directories = [TARGET_ROOT / name for name in sorted({"agents", "instructions", "skills"})]
    for directory in required_directories:
        if not directory.exists():
            raise ConversionError(f"missing generated directory: {directory}")

    if not (TARGET_ROOT / "copilot-instructions.md").exists():
        raise ConversionError("missing generated copilot-instructions.md")
    if not (TARGET_ROOT / "README.md").exists():
        raise ConversionError("missing generated README.md")

    instruction_paths = sorted((TARGET_ROOT / "instructions").glob("*.instructions.md"))
    agent_paths = sorted((TARGET_ROOT / "agents").glob("*.agent.md"))
    skill_paths = sorted((TARGET_ROOT / "skills").glob("*/SKILL.md"))
    assert_has_files(instruction_paths, "instructions/*.instructions.md")
    assert_has_files(agent_paths, "agents/*.agent.md")
    assert_has_files(skill_paths, "skills/*/SKILL.md")

    assert_no_wrong_extension(TARGET_ROOT / "instructions", "*.md", ".instructions.md")
    assert_no_wrong_extension(TARGET_ROOT / "agents", "*.md", ".agent.md")
    assert_no_forbidden_copilot_cli_files()
    assert_no_excluded_directories_under_generated_roots()

    return [
        f"Validated {len(instruction_paths)} instruction files",
        f"Validated {len(agent_paths)} agent files",
        f"Validated {len(skill_paths)} skill entry files",
    ]


def assert_has_files(paths: list[Path], label: str) -> None:
    if not paths:
        raise ConversionError(f"no generated files found for {label}")


def assert_no_wrong_extension(directory: Path, pattern: str, expected_suffix: str) -> None:
    for path in sorted(directory.glob(pattern)):
        if not path.name.endswith(expected_suffix):
            raise ConversionError(f"unexpected extension in {directory}: {path.name}")


def assert_no_forbidden_copilot_cli_files() -> None:
    forbidden_paths = [
        path
        for path in TARGET_ROOT.rglob("*")
        if path.is_file() and path.name.endswith((".prompt.md", ".chatmode.md"))
    ]
    if forbidden_paths:
        formatted_paths = ", ".join(str(path) for path in sorted(forbidden_paths))
        raise ConversionError(f"Copilot CLI target must not contain prompt/chatmode files: {formatted_paths}")


def assert_no_excluded_directories_under_generated_roots() -> None:
    generated_roots = [TARGET_ROOT / "agents", TARGET_ROOT / "instructions", TARGET_ROOT / "skills"]
    for root in generated_roots:
        for path in root.rglob("*"):
            if any(part in SOURCE_EXCLUDED_PARTS for part in path.relative_to(root).parts):
                raise ConversionError(f"excluded directory copied into generated output: {path}")


def validate_markdown_frontmatter() -> list[str]:
    instruction_paths = sorted((TARGET_ROOT / "instructions").glob("*.instructions.md"))
    agent_paths = sorted((TARGET_ROOT / "agents").glob("*.agent.md"))

    for path in instruction_paths:
        metadata, body = validated_frontmatter(path)
        if "description" not in metadata:
            raise ConversionError(f"missing description frontmatter: {path}")
        if "applyTo" not in metadata:
            raise ConversionError(f"missing applyTo frontmatter: {path}")
        assert_no_raw_opencode_permission_frontmatter(path, metadata)
        assert_no_immediate_duplicated_yaml_delimiter(path, body)

    for path in agent_paths:
        metadata, body = validated_frontmatter(path)
        if "description" not in metadata:
            raise ConversionError(f"missing description frontmatter: {path}")
        disallowed_keys = OPENCODE_AGENT_FRONTMATTER_KEYS.intersection(metadata)
        if disallowed_keys:
            invalid_keys = ", ".join(sorted(disallowed_keys))
            raise ConversionError(f"opencode-only frontmatter remains in {path}: {invalid_keys}")
        assert_no_raw_opencode_permission_frontmatter(path, metadata)
        assert_no_immediate_duplicated_yaml_delimiter(path, body)

    return ["Validated generated markdown frontmatter"]


def validated_frontmatter(path: Path) -> tuple[dict[str, str], str]:
    content = path.read_text(encoding="utf-8")
    lines = content.splitlines(keepends=True)
    if len(lines) < 3 or lines[0].strip() != "---":
        raise ConversionError(f"missing YAML frontmatter: {path}")

    closing_index = first_frontmatter_closing_index(lines)
    if closing_index is None:
        raise ConversionError(f"unterminated YAML frontmatter: {path}")

    metadata = parse_simple_frontmatter(lines[1:closing_index])
    body = "".join(lines[closing_index + 1 :])
    return metadata, body


def assert_no_raw_opencode_permission_frontmatter(path: Path, metadata: dict[str, str]) -> None:
    if "permission" in metadata:
        raise ConversionError(f"raw opencode permission map in frontmatter: {path}")


def assert_no_immediate_duplicated_yaml_delimiter(path: Path, body: str) -> None:
    if body.lstrip("\n").startswith("---\n"):
        raise ConversionError(f"duplicated YAML delimiter after generated frontmatter: {path}")


def validate_generated_content_safety() -> list[str]:
    scanned_count = 0
    for path in generated_text_paths():
        content = path.read_text(encoding="utf-8")
        if contains_sensitive_literal(content):
            raise ConversionError(f"sensitive-looking literal found in generated content: {path}")
        scanned_count += 1
    return [f"Scanned {scanned_count} generated text files for obvious secrets"]


def generated_text_paths() -> list[Path]:
    paths = [TARGET_ROOT / "README.md", TARGET_ROOT / "copilot-instructions.md"]
    for directory_name in ("agents", "instructions", "skills", "scripts"):
        directory = TARGET_ROOT / directory_name
        if directory.exists():
            paths.extend(path for path in directory.rglob("*") if path.is_file())
    return sorted(set(paths), key=str)


def print_generated_tree() -> None:
    for path in generated_text_paths():
        if path.exists():
            print(path.relative_to(TARGET_ROOT))


def slugify(value: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip().lower())
    slug = re.sub(r"-+", "-", slug).strip("-.")
    if not slug:
        raise ConversionError(f"cannot create file name from value: {value!r}")
    return slug


def normalize_newline(content: str) -> str:
    return content.rstrip() + "\n"


if __name__ == "__main__":
    raise SystemExit(main())
