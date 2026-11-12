"""适配器接口：一个品牌的驱动要实现什么，以及它对外只能用的类型。

适配器只回答"这台打印机现在是什么样"并执行动作。它不认识面板的任务标识，只认识文件名和任务名；
哪个任务是系统派的、任务什么时候算开始和结束，都由 daemon 核心比较前后两份状态来判断。

这个包不 import daemon 的其他部分，适配器也只能 import 这个包。
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from pathlib import Path
from typing import Any, ClassVar, Literal, Protocol


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


# 打印机正在跑一个任务
RUNNING_STATES = frozenset({
    NormalizedState.PREPARING,
    NormalizedState.PRINTING,
    NormalizedState.PAUSED,
    NormalizedState.ERROR_PAUSED,
})
# 上一个任务的结局；机器会一直停在这里，直到下一个任务
ENDED_STATES = frozenset({NormalizedState.FINISHED, NormalizedState.FAILED, NormalizedState.CANCELLED})


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
class ErrorAction:
    action: str  # 标准动作名，如 RESUME、STOP、ACKNOWLEDGE
    label: str
    vendor_action_id: str | int | None = None
    requires_on_site: bool = False
    destructive: bool = False


@dataclass(frozen=True)
class DeviceError:
    error_id: str
    vendor_code: str
    channel: str
    severity: Literal["fatal", "error", "warning", "info"]
    blocks_job: bool
    raised_at: datetime
    message: str | None = None
    module: str | None = None
    actions: tuple[ErrorAction, ...] = ()
    # 这条报错是不是断料；核心据此区分暂停原因
    runout: bool = False


@dataclass(frozen=True)
class DeviceJob:
    """打印机上正在跑或刚结束的任务，按打印机自己的说法。"""

    name: str | None
    percent: int | None = None
    remaining_seconds: int | None = None
    layer: int | None = None
    total_layers: int | None = None
    skipped_parts: tuple[int, ...] = ()


@dataclass(frozen=True)
class Temperature:
    current: float
    target: float | None = None


@dataclass(frozen=True)
class Nozzle:
    extruder: int
    diameter_mm: float
    flow: str | None = None


@dataclass(frozen=True)
class Tray:
    unit: int
    slot: int
    label: str | None = None
    material: str | None = None
    sub_type: str | None = None
    colour: str | None = None
    rfid_uid: str | None = None
    remaining_percent: int | None = None
    extruders: tuple[int, ...] = ()


@dataclass(frozen=True)
class StorageStatus:
    medium: str
    present: bool
    writable: bool | None = None
    free_bytes: int | None = None
    total_bytes: int | None = None


@dataclass(frozen=True)
class DeviceSnapshot:
    """合并后的完整状态。拿不到的字段留空，不填假值。"""

    connected: bool
    state: NormalizedState
    substage: Substage | None = None
    job: DeviceJob | None = None
    temps: dict[str, Temperature] = field(default_factory=dict)
    nozzles: tuple[Nozzle, ...] = ()
    trays: tuple[Tray, ...] = ()
    bed_type: str | None = None
    storage: tuple[StorageStatus, ...] = ()
    errors: tuple[DeviceError, ...] = ()
    controls: dict[str, Any] = field(default_factory=dict)
    camera_stream: bool = False
    camera_snapshot: bool = False
    device_boot: str | None = None
    model_id: str | None = None
    model_name: str | None = None


OFFLINE_SNAPSHOT = DeviceSnapshot(connected=False, state=NormalizedState.OFFLINE)


@dataclass(frozen=True)
class DeviceEvent:
    """设备层面的变化。changed 之后核心自己去拿新快照。"""

    kind: Literal["connected", "disconnected", "changed"]
    reason: str | None = None


@dataclass(frozen=True)
class RemoteFile:
    name: str
    size_bytes: int | None = None
    modified_at: datetime | None = None
    medium: str = "internal"


@dataclass(frozen=True)
class SlotMapping:
    slice_slot: int
    extruder: int
    unit: int
    slot: int


@dataclass(frozen=True)
class StartJob:
    remote_file: str
    task_name: str
    plate_index: int
    bed_type: str
    mapping: tuple[SlotMapping, ...]
    timelapse: bool


@dataclass(frozen=True)
class ControlSpec:
    action: str
    category: Literal["light", "temperature", "fan", "speed", "pause", "resume", "filament", "dry", "motion"]
    args: dict[str, Any]
    destructive: bool = False


@dataclass(frozen=True)
class ModelDescription:
    model_id: str
    model_name: str
    controls: tuple[ControlSpec, ...]
    skip_parts: bool = False
    refresh: bool = True


class AdapterError(Exception):
    """适配器调用失败。error_class 决定核心怎么处理：

    transient 可以重试；needs_human 要人去机器旁处理；fatal_config 配置不对（如访问码错）；
    unsupported 这台机器做不了；machine_fault 机器或固件拒绝，message 是它的原话。
    """

    error_class: ClassVar[str] = "transient"


class TransientError(AdapterError):
    error_class = "transient"


class NeedsHumanError(AdapterError):
    error_class = "needs_human"


class FatalConfigError(AdapterError):
    error_class = "fatal_config"


class UnsupportedError(AdapterError):
    error_class = "unsupported"


class MachineFaultError(AdapterError):
    error_class = "machine_fault"


class ControlNotAllowedError(AdapterError):
    """适配器处于只读模式时，拒绝一切会改变打印机状态的操作。"""

    error_class = "unsupported"


# 旧名字，只读拓竹驱动还在用
DriverError = AdapterError


class PrinterSession(Protocol):
    """和一台打印机的一次会话。动作失败抛 AdapterError，成功就是打印机收下了。"""

    async def connect(self) -> None: ...
    async def close(self) -> None: ...

    def events(self) -> AsyncIterator[DeviceEvent]: ...
    def snapshot(self) -> DeviceSnapshot: ...
    async def refresh(self) -> None: ...

    async def ran_during_gap(self, since: datetime) -> bool | None:
        """since 之后（daemon 看不到打印机的那段时间）它跑没跑过任务。None = 证明不了。"""

    async def upload(self, local_file: Path, remote_name: str) -> RemoteFile: ...
    async def start(self, job: StartJob) -> None: ...
    async def stop(self) -> None: ...
    async def skip_parts(self, part_ids: list[int]) -> None: ...
    async def resolve_error(self, error_id: str, action: str) -> None: ...
    async def control(self, action: str, args: dict[str, Any]) -> None: ...

    async def storage_status(self) -> list[StorageStatus]: ...
    async def list_files(self) -> list[RemoteFile]: ...
    async def delete(self, remote_name: str) -> None: ...


@dataclass(frozen=True)
class PrinterTarget:
    host: str
    serial: str
    # 访问码只在内存里，用到时才取，不落盘、不进日志
    access_code: Callable[[], str]


class Adapter(Protocol):
    brand: ClassVar[str]
    version: ClassVar[str]

    @classmethod
    def describe(cls, model_id: str) -> ModelDescription: ...

    @classmethod
    def open(cls, target: PrinterTarget) -> PrinterSession: ...
