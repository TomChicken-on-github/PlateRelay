"""只读拓竹驱动自己用的快照和事件类型。

这个驱动还没接到 daemon 的适配器接口上（那要等真机联调），先保留它原来的形状。
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Literal

from platerelay_daemon.adapter_api import NormalizedState, Substage


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
