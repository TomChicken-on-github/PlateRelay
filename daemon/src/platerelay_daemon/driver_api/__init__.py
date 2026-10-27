"""Driver 接口：标准状态、事件和错误类型。

对应 docs/printer-driver-interface-draft.md 的 §3、§5.1、§7。这里只放目前用到的部分，
报错处理（§6）、命令（§5.2）等以后再补。
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Literal


class NormalizedState(StrEnum):
    OFFLINE = "OFFLINE"
    NOT_READY = "NOT_READY"
    IDLE = "IDLE"
    BUSY = "BUSY"
    PREPARING = "PREPARING"
    PRINTING = "PRINTING"
    PAUSED = "PAUSED"
    ERROR_PAUSED = "ERROR_PAUSED"
    FINISHED = "FINISHED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"
    FAULT = "FAULT"
    UNKNOWN = "UNKNOWN"


class Substage(StrEnum):
    HEATING_BED = "heating_bed"
    HEATING_NOZZLE = "heating_nozzle"
    HEATING_CHAMBER = "heating_chamber"
    COOLING = "cooling"
    HOMING = "homing"
    LEVELING = "leveling"
    CALIBRATING = "calibrating"
    CLEANING_NOZZLE = "cleaning_nozzle"
    INSPECTING_FIRST_LAYER = "inspecting_first_layer"
    IDENTIFYING_PLATE = "identifying_plate"
    CHANGING_FILAMENT = "changing_filament"
    LOADING_FILAMENT = "loading_filament"
    UNLOADING_FILAMENT = "unloading_filament"
    OTHER = "other"


@dataclass(frozen=True)
class DeviceInfo:
    printer_id: str
    brand: str
    model: str
    nozzles: list[dict[str, Any]] = field(default_factory=list)


@dataclass(frozen=True)
class DeviceStatus:
    state: NormalizedState
    substage: Substage | None = None
    raw_substage: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Progress:
    percent: int | None = None
    remaining_sec: int | None = None
    layer: int | None = None
    total_layers: int | None = None
    temps: dict[str, float] = field(default_factory=dict)


@dataclass(frozen=True)
class DeviceSnapshot:
    info: DeviceInfo
    connected: bool
    status: DeviceStatus
    progress: Progress


@dataclass(frozen=True)
class ConnectionEvent:
    state: Literal["connected", "disconnected"]
    reason: str | None = None
    type: Literal["connection"] = "connection"


@dataclass(frozen=True)
class StatusEvent:
    status: DeviceStatus
    type: Literal["status"] = "status"


@dataclass(frozen=True)
class ProgressEvent:
    progress: Progress
    type: Literal["progress"] = "progress"


@dataclass(frozen=True)
class Envelope:
    """每个事件都带 printerId、seq（单台设备内单调递增）、ts。"""

    printer_id: str
    seq: int
    event: ConnectionEvent | StatusEvent | ProgressEvent
    ts: float = field(default_factory=time.time)


class DriverError(Exception):
    """driver 调用失败，分类见草稿 §7。"""

    error_class: str = "transient"


class UnsupportedError(DriverError):
    error_class = "unsupported"


class ControlNotAllowedError(DriverError):
    """driver 处于只读模式时，拒绝一切会改变打印机状态的操作。"""

    error_class = "unsupported"
