"""Portability regressions for the Copilot converter.

Run with: python3 -m unittest discover -s scripts -v
"""

import os
from pathlib import Path, PurePosixPath, PureWindowsPath
import runpy
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from scripts import convert_from_opencode as converter


SCRIPT_PATH = Path(converter.__file__).resolve()


class ConverterPortabilityTests(unittest.TestCase):
    def test_roots_use_current_home_with_native_path_semantics(self):
        for home in (
            PurePosixPath("/Users/Another User"),
            PureWindowsPath("D:/Users/Another User"),
        ):
            with self.subTest(home=home), patch.object(Path, "home", return_value=home):
                module = runpy.run_path(str(SCRIPT_PATH))

                self.assertEqual(module["SOURCE_ROOT"], home / ".config" / "opencode")
                self.assertEqual(module["TARGET_ROOT"], home / ".copilot")

    def test_readme_uses_home_relative_paths(self):
        readme = converter.build_readme()

        for path in (
            "`~/.config/opencode`",
            "`~/.copilot`",
            "`~/.config/github-copilot`",
            "`~/.config/opencode/scripts/convert_from_opencode.py`",
            "python3 ~/.copilot/scripts/convert_from_opencode.py\n",
            "python3 ~/.copilot/scripts/convert_from_opencode.py --validate --list\n",
        ):
            with self.subTest(path=path):
                self.assertIn(path, readme)
        self.assertNotRegex(readme, r"/Users/|[A-Za-z]:[\\/]")

    def test_global_instruction_header_is_portable_and_preserves_source(self):
        body = "# Original instructions\n\nKeep these rules.\n"
        with patch.object(converter, "read_required_safe_text", return_value=body) as read:
            generated = converter.convert_global_instruction_file()

        read.assert_called_once_with(converter.SOURCE_ROOT / "AGENTS.md")
        self.assertEqual(generated.path, converter.TARGET_ROOT / "copilot-instructions.md")
        self.assertEqual(generated.source, converter.SOURCE_ROOT / "AGENTS.md")
        self.assertIn("`~/.config/opencode/AGENTS.md`", generated.content)
        self.assertIn("`~/.copilot`", generated.content)
        self.assertIn(
            "`python3 ~/.copilot/scripts/convert_from_opencode.py`", generated.content
        )
        self.assertNotRegex(generated.content, r"/Users/|[A-Za-z]:[\\/]")
        self.assertTrue(generated.content.endswith(body))

    def test_cli_uses_home_outside_working_directory_and_preserves_safety(self):
        with TemporaryDirectory() as directory:
            home = Path(directory) / "Test User"
            source = home / ".config" / "opencode"
            target = home / ".copilot"
            fixtures = {
                source / "AGENTS.md": "# Global rules\n",
                source / "agents" / "example.md": (
                    "---\ndescription: Example\nmode: subagent\n---\nAgent body.\n"
                ),
                source / "skills" / "example" / "SKILL.md": (
                    "---\nname: example\ndescription: Example\n---\nSkill body.\n"
                ),
                target / "agents" / "orphan.agent.md": "Obsolete\n",
                target / "config.json": "{}\n",
                target / "scripts" / "keep.py": "# Keep this script\n",
                target / "instructions" / "wow-addon-dev.instructions.md": (
                    "---\ndescription: Hand authored\napplyTo: '**'\n---\n"
                    "Keep this instruction.\n"
                ),
            }
            for path, content in fixtures.items():
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8")

            environment = dict(os.environ, HOME=str(home), USERPROFILE=str(home))
            for arguments in (("--dry-run",), (), ("--validate", "--list")):
                result = subprocess.run(
                    [sys.executable, str(SCRIPT_PATH), *arguments],
                    cwd=directory,
                    env=environment,
                    capture_output=True,
                    text=True,
                    check=False,
                )
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                if arguments == ("--dry-run",):
                    self.assertIn("Would write", result.stdout)
                    self.assertIn("Would remove", result.stdout)
                    self.assertFalse((target / "README.md").exists())
                    for path, content in fixtures.items():
                        self.assertEqual(path.read_text(encoding="utf-8"), content)

            self.assertIn("Validation passed", result.stdout)
            self.assertFalse((target / "agents" / "orphan.agent.md").exists())
            for relative_path in (
                "config.json",
                "scripts/keep.py",
                "instructions/wow-addon-dev.instructions.md",
            ):
                path = target / relative_path
                self.assertEqual(path.read_text(encoding="utf-8"), fixtures[path])
            self.assertEqual(
                (target / "README.md").read_text(encoding="utf-8"),
                converter.build_readme(),
            )


if __name__ == "__main__":
    unittest.main()
