"""拓竹 gcode_state + stg_cur → 标准主状态和子阶段。

映射表见 docs/printer-driver-interface-draft.md §4.1，标【推断】的条目需要真机实测。
stg_cur 的编号与名称来自 pybambu 的 CURRENT_STAGE_IDS。
"""

from __future__ import annotations

from platerelay_daemon.driver_api import NormalizedState as S, Substage as Sub

from ._vendor.pybambu.const import CURRENT_STAGE_IDS

IDLE_STAGES = {-1, 255}
PRINTING_STAGE = 0

USER_PAUSE_STAGES = {5, 16, 30}
ERROR_PAUSE_STAGES = {6, 17, 20, 21, 23, 26, 27, 28, 32, 33, 34, 35}
FILAMENT_STAGES = {4: Sub.CHANGING_FILAMENT, 22: Sub.UNLOADING_FILAMENT, 24: Sub.LOADING_FILAMENT}

PREPARE_SUBSTAGES: dict[int, Sub] = {
    2: Sub.HEATING_BED, 54: Sub.HEATING_BED,
    7: Sub.HEATING_NOZZLE,
    49: Sub.HEATING_CHAMBER,
    29: Sub.COOLING, 50: Sub.COOLING, 69: Sub.COOLING,
    1: Sub.LEVELING, 40: Sub.LEVELING, 47: Sub.LEVELING, 48: Sub.LEVELING,
    13: Sub.HOMING,
    3: Sub.CALIBRATING, 8: Sub.CALIBRATING, 12: Sub.CALIBRATING, 18: Sub.CALIBRATING,
    19: Sub.CALIBRATING, 25: Sub.CALIBRATING,
    9: Sub.OTHER,
    10: Sub.INSPECTING_FIRST_LAYER,
    11: Sub.IDENTIFYING_PLATE,
    14: Sub.CLEANING_NOZZLE,
}


def stage_name(stg_cur: int | None) -> str | None:
    if stg_cur is None:
        return None
    return CURRENT_STAGE_IDS.get(stg_cur, CURRENT_STAGE_IDS["default"])


def _prepare_substage(stg_cur: int | None) -> Sub | None:
    if stg_cur is None or stg_cur in IDLE_STAGES or stg_cur == PRINTING_STAGE:
        return None
    if stg_cur in FILAMENT_STAGES:
        return FILAMENT_STAGES[stg_cur]
    # 未知编号一律归 other，不报错。
    return PREPARE_SUBSTAGES.get(stg_cur, Sub.OTHER)


def map_state(
    gcode_state: str | None, stg_cur: int | None, print_error: int = 0
) -> tuple[S, Sub | None]:
    gs = (gcode_state or "").upper()

    if gs == "IDLE":
        return S.IDLE, None
    if gs == "INIT":
        return S.NOT_READY, None
    if gs in ("PREPARE", "SLICING"):
        return S.PREPARING, _prepare_substage(stg_cur)
    if gs == "RUNNING":
        if stg_cur is None or stg_cur == PRINTING_STAGE or stg_cur in IDLE_STAGES:
            return S.PRINTING, None
        if stg_cur in FILAMENT_STAGES:
            return S.PRINTING, FILAMENT_STAGES[stg_cur]
        return S.PREPARING, _prepare_substage(stg_cur)
    if gs == "PAUSE":
        if print_error or stg_cur in ERROR_PAUSE_STAGES:
            return S.ERROR_PAUSED, None
        if stg_cur in USER_PAUSE_STAGES:
            return S.PAUSED, None
        # 暂停原因不明时按正常暂停处理，报错暂停一定会带 print_error 或报错类阶段。
        return S.PAUSED, None
    if gs == "FINISH":
        return S.FINISHED, None
    if gs == "FAILED":
        return S.FAILED, None
    if gs == "OFFLINE":
        return S.OFFLINE, None
    return S.UNKNOWN, None
