"""模拟打印机的原始状态 → 标准状态。

这台机器的状态词汇是它自己的（见它的接口说明），这里逐项对到标准状态；
不认识的值一律落到 UNKNOWN / other，不猜。
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from platerelay_daemon.adapter_api import (
    DeviceError,
    DeviceJob,
    DeviceSnapshot,
    ErrorAction,
    Nozzle,
    NormalizedState as S,
    StorageStatus,
    Substage as Sub,
    Temperature,
    Tray,
)

STATES: dict[str, S] = {
    "idle": S.IDLE,
    "busy": S.BUSY,
    "preparing": S.PREPARING,
    "printing": S.PRINTING,
    "done": S.FINISHED,
    "failed": S.FAILED,
    "stopped": S.CANCELLED,
    "fault": S.FAULT,
}

PHASES: dict[str, Sub] = {
    "bed_heat": Sub.HEATING_BED,
    "nozzle_heat": Sub.HEATING_NOZZLE,
    "home": Sub.HOMING,
    "level": Sub.LEVELING,
    "purge": Sub.CLEANING_NOZZLE,
}

SEVERITY = {"fatal": "fatal", "pause": "error", "warn": "warning", "info": "info"}

# 机器报错上的按钮 → 标准动作
CHOICES: dict[str, tuple[str, str, bool, bool]] = {
    # 原始按钮: (标准动作, 显示名, 要人先到场处理, 会终止任务)
    "resume": ("RESUME_PROBLEM_SOLVED", "已处理，继续打印", True, False),
    "stop": ("STOP", "停止打印", False, True),
    "dismiss": ("ACKNOWLEDGE", "知道了", False, False),
}

RUNOUT_CODE_PREFIX = "0700-20"


def map_state(state: str | None, pause_cause: str | None) -> S:
    if state == "paused":
        return S.PAUSED if pause_cause == "user" else S.ERROR_PAUSED
    return STATES.get(state or "", S.UNKNOWN)


def map_substage(state: S, phase: str | None) -> Sub | None:
    if state is not S.PREPARING or phase is None:
        return None
    return PHASES.get(phase, Sub.OTHER)


def map_error(alert: dict[str, Any]) -> DeviceError:
    code = str(alert.get("code", ""))
    level = alert.get("level")
    actions = []
    for choice in alert.get("choices", []):
        if choice in CHOICES:
            action, label, on_site, destructive = CHOICES[choice]
            actions.append(ErrorAction(action=action, label=label, vendor_action_id=choice, requires_on_site=on_site, destructive=destructive))
    return DeviceError(
        error_id=f"alert-{alert.get('id')}",
        vendor_code=code,
        channel="alerts",
        severity=SEVERITY.get(level, "warning"),
        blocks_job=level == "pause",
        raised_at=datetime.fromtimestamp(alert.get("at", 0), UTC),
        message=alert.get("text"),
        module="ams" if code.startswith("07") else None,
        actions=tuple(actions),
        runout=code.startswith(RUNOUT_CODE_PREFIX),
    )


def _colour(raw: str | None) -> str | None:
    # 机器给 RRGGBBAA，标准是 #RRGGBB
    if not raw or len(raw) < 6:
        return None
    return f"#{raw[:6].upper()}"


def map_trays(ams: list[dict[str, Any]]) -> tuple[Tray, ...]:
    trays = []
    for unit in ams:
        for slot in unit.get("slots", []):
            extruders = tuple(slot.get("feeds", []))
            label = f"AMS {unit['unit'] + 1} · {slot['slot'] + 1}"
            if slot.get("empty"):
                trays.append(Tray(unit=unit["unit"], slot=slot["slot"], label=label, extruders=extruders))
                continue
            trays.append(Tray(
                unit=unit["unit"],
                slot=slot["slot"],
                label=label,
                material=slot.get("material"),
                sub_type=slot.get("sub"),
                colour=_colour(slot.get("color")),
                rfid_uid=slot.get("tag"),
                remaining_percent=slot.get("remain"),
                extruders=extruders,
            ))
    return tuple(trays)


def map_snapshot(status: dict[str, Any], info: dict[str, Any]) -> DeviceSnapshot:
    state = map_state(status.get("state"), status.get("pause_cause"))
    raw_print = status.get("print")
    job = None
    if raw_print:
        remain = raw_print.get("remain_min")
        job = DeviceJob(
            name=raw_print.get("task") or raw_print.get("file"),
            percent=raw_print.get("progress"),
            remaining_seconds=remain * 60 if remain is not None else None,
            layer=raw_print.get("layer"),
            total_layers=raw_print.get("layers"),
            skipped_parts=tuple(raw_print.get("skipped", [])),
        )
    temps: dict[str, Temperature] = {}
    raw_temps = status.get("temps", {})
    for index, nozzle in enumerate(raw_temps.get("nozzle", []), start=1):
        temps[f"nozzle{index}"] = Temperature(nozzle["cur"], nozzle.get("set"))
    if "bed" in raw_temps:
        temps["bed"] = Temperature(raw_temps["bed"]["cur"], raw_temps["bed"].get("set"))
    if "chamber" in raw_temps:
        temps["chamber"] = Temperature(raw_temps["chamber"]["cur"])
    storage = tuple(
        StorageStatus(medium=medium, present=True, writable=True, free_bytes=item.get("free"), total_bytes=item.get("total"))
        for medium, item in status.get("storage", {}).items()
    )
    lights = status.get("lights", {})
    features = info.get("features", {})
    return DeviceSnapshot(
        connected=True,
        state=state,
        substage=map_substage(state, status.get("phase")),
        job=job,
        temps=temps,
        nozzles=tuple(
            Nozzle(extruder=item["index"] + 1, diameter_mm=item["diameter"], flow=item.get("flow"))
            for item in info.get("nozzles", [])
        ),
        trays=map_trays(status.get("ams", [])),
        storage=storage,
        errors=tuple(map_error(alert) for alert in status.get("alerts", [])),
        controls={"light": "on" if lights.get("chamber") else "off"} if "chamber" in lights else {},
        camera_stream=bool(features.get("camera")),
        camera_snapshot=bool(features.get("camera")),
        device_boot=str(status["boot_time"]) if "boot_time" in status else None,
        model_id=info.get("model_id"),
    )
