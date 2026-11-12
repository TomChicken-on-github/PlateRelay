"""模拟打印机的驱动：原始状态换算和增量合并。"""

from __future__ import annotations

from platerelay_daemon.adapter_api import NormalizedState as S
from platerelay_daemon.adapter_api import Substage as Sub
from platerelay_daemon.adapters.sim.session import apply_patch
from platerelay_daemon.adapters.sim.state_map import (
    map_snapshot,
    map_state,
    map_substage,
)
from platerelay_sim import SimPrinter
from platerelay_sim.server import merge_patch_diff


def test_raw_states_map_to_standard_states() -> None:
    assert map_state("idle", None) is S.IDLE
    assert map_state("paused", "user") is S.PAUSED
    assert map_state("paused", "alert") is S.ERROR_PAUSED
    assert map_state("paused", "filament_out") is S.ERROR_PAUSED
    assert map_state("done", None) is S.FINISHED
    assert map_state("stopped", None) is S.CANCELLED
    assert map_state("something-new", None) is S.UNKNOWN


def test_unknown_prepare_phase_falls_back_to_other() -> None:
    assert map_substage(S.PREPARING, "level") is Sub.LEVELING
    assert map_substage(S.PREPARING, "wax_the_bed") is Sub.OTHER
    assert map_substage(S.PRINTING, "level") is None


def test_incremental_pushes_rebuild_the_full_status() -> None:
    printer = SimPrinter()
    merged = printer.status()
    printer.store_file("a.gcode.3mf", 10)
    printer.start_print(file="a.gcode.3mf", task="a")
    printer.operator_filament_runs_out(0, 1)
    for _ in range(3):
        printer.tick(1)
        apply_patch(merged, merge_patch_diff(merged, printer.status()))
    printer.operator_loads_filament(0, 1)
    printer.resume()
    apply_patch(merged, merge_patch_diff(merged, printer.status()))
    assert merged == printer.status()


def test_empty_slot_is_reported_without_made_up_values() -> None:
    printer = SimPrinter()
    snapshot = map_snapshot(printer.status(), printer.info())
    empty = next(tray for tray in snapshot.trays if (tray.unit, tray.slot) == (0, 3))
    assert empty.material is None and empty.colour is None and empty.extruders == (1,)
    assert snapshot.model_id == "N6"
