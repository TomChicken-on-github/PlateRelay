"""模块之间的依赖方向。"""

from __future__ import annotations

import ast
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src"


def imported_modules(package: Path) -> set[str]:
    found: set[str] = set()
    for path in package.rglob("*.py"):
        if "_vendor" in path.parts:
            continue
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
                found.add(node.module)
            elif isinstance(node, ast.Import):
                found.update(alias.name for alias in node.names)
    return found


def test_simulated_printer_knows_nothing_about_the_daemon() -> None:
    assert not {name for name in imported_modules(SRC / "platerelay_sim") if name.startswith("platerelay_daemon")}


def test_adapters_only_use_the_adapter_api() -> None:
    for brand in ("sim", "bambu"):
        internal = {name for name in imported_modules(SRC / "platerelay_daemon/adapters" / brand) if name.startswith("platerelay_daemon")}
        allowed = {name for name in internal if name == "platerelay_daemon.adapter_api" or name.startswith(f"platerelay_daemon.adapters.{brand}")}
        assert internal == allowed, internal - allowed


def test_adapter_api_stands_alone() -> None:
    assert not {name for name in imported_modules(SRC / "platerelay_daemon/adapter_api") if name.startswith("platerelay_")}


def test_core_never_imports_the_simulated_printer() -> None:
    assert not {name for name in imported_modules(SRC / "platerelay_daemon") if name.startswith("platerelay_sim")}
