# 自动生成，不要手改。来源在 packages/shared/schema/daemon/v1/，用 daemon/scripts/generate_protocol.sh 重新生成。

from __future__ import annotations

from typing import Annotated, Any, Literal
from pydantic import AwareDatetime, BaseModel, Field, RootModel
from uuid import UUID
from enum import StrEnum


class DaemonProtocol(RootModel[Any]):
    root: Annotated[
        Any,
        Field(
            description="daemon 协议的全部消息，由 schema/daemon/v1/ 下的文件合成。",
            title="DaemonProtocol",
        ),
    ]


class Uuid(RootModel[UUID]):
    root: Annotated[UUID, Field(description="UUIDv7")]


class Timestamp(RootModel[AwareDatetime]):
    root: Annotated[AwareDatetime, Field(description="RFC 3339 UTC 时间")]


class NormalizedState(StrEnum):
    """
    适配器上报的标准设备状态，不是面板的打印机状态；换算只在面板做。
    """

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
    """
    标准子阶段，只用于展示。
    """

    heating_bed = "heating_bed"
    heating_nozzle = "heating_nozzle"
    heating_chamber = "heating_chamber"
    cooling = "cooling"
    homing = "homing"
    leveling = "leveling"
    calibrating = "calibrating"
    cleaning_nozzle = "cleaning_nozzle"
    inspecting_first_layer = "inspecting_first_layer"
    identifying_plate = "identifying_plate"
    changing_filament = "changing_filament"
    loading_filament = "loading_filament"
    unloading_filament = "unloading_filament"
    other = "other"


class StandardErrorAction(StrEnum):
    """
    报错可选的标准动作。
    """

    RESUME = "RESUME"
    RESUME_ACCEPT_DEFECTS = "RESUME_ACCEPT_DEFECTS"
    RESUME_PROBLEM_SOLVED = "RESUME_PROBLEM_SOLVED"
    RETRY = "RETRY"
    CONFIRM_DONE = "CONFIRM_DONE"
    IGNORE = "IGNORE"
    IGNORE_PERMANENTLY = "IGNORE_PERMANENTLY"
    ACKNOWLEDGE = "ACKNOWLEDGE"
    STOP = "STOP"
    ABORT_OPERATION = "ABORT_OPERATION"
    SILENCE_ALARM = "SILENCE_ALARM"
    RECHECK = "RECHECK"
    FIRMWARE_RESTART = "FIRMWARE_RESTART"
    EMERGENCY_STOP = "EMERGENCY_STOP"


class ErrorActionOption(BaseModel):
    action: StandardErrorAction
    vendorActionId: Annotated[
        str | int | None, Field(description="厂商原始按钮 ID，排查用")
    ] = None
    label: str
    requiresOnSite: Annotated[bool, Field(description="必须有人在机器旁处理过才能点")]
    destructive: Annotated[bool, Field(description="会终止任务")]


class ErrorSeverity(StrEnum):
    fatal = "fatal"
    error = "error"
    warning = "warning"
    info = "info"


class ActiveError(BaseModel):
    """
    打印机上一条还没消失的报错。
    """

    errorId: Annotated[str, Field(description="本次报错的唯一 ID，适配器生成")]
    vendorCode: Annotated[str, Field(description="厂商原始码")]
    channel: Annotated[str, Field(description="报错来源通道，如 print_error、hms")]
    severity: Annotated[ErrorSeverity, Field(title="ErrorSeverity")]
    module: Annotated[str | None, Field(description="如 ams、toolhead")] = None
    message: str | None = None
    helpUrl: str | None = None
    blocksJob: Annotated[bool, Field(description="是否卡住了当前任务")]
    actions: list[ErrorActionOption]
    raisedAt: Timestamp


class AssignedPrinter(BaseModel):
    """
    分配给这个 daemon 的一台打印机。是不是系统任务以面板下发的为准。
    """

    printerId: Uuid
    brand: Annotated[str, Field(description="适配器品牌，如 bambu")]
    serial: str
    host: Annotated[str, Field(description="打印机在局域网里的地址")]
    accessCodeCipher: Annotated[
        str,
        Field(
            description="浏览器用 daemon 公钥加密的访问码密文（base64）。面板解不开，只是转交；daemon 只在内存里解密，不落盘、不进日志。"
        ),
    ]
    keyFingerprint: Annotated[
        str,
        Field(
            description="加密时用的 daemon 公钥指纹；对不上说明 daemon 换过密钥，要重填访问码"
        ),
    ]
    currentJobRef: Uuid | None
    cleanupJobRefs: Annotated[
        list[Uuid], Field(description="已结束、但打印机上可能还留着文件要收尾的任务")
    ]
    knownRunSeq: Annotated[
        int | None,
        Field(
            description="面板已知的这台打印机的最大运行序号；daemon 丢了本地状态时从比它大的数重新开始"
        ),
    ] = None


class SnapshotConfig(BaseModel):
    watchedSeconds: Annotated[int, Field(description="有人在看时的抓拍间隔")]
    unwatchedSeconds: Annotated[int, Field(description="没人看时的抓拍间隔")]
    staggerSeconds: Annotated[int, Field(description="多台打印机之间错开的秒数")]
    uploadKbps: Annotated[int, Field(description="抓拍上传的总速率上限")]


class DaemonConfig(BaseModel):
    """
    面板下发给 daemon 的参数。
    """

    snapshot: Annotated[SnapshotConfig, Field(title="SnapshotConfig")]
    transferTimeoutSeconds: Annotated[
        int, Field(description="下载或上传文件每次尝试的超时，从真正开始传起算")
    ]
    downloadConcurrency: Annotated[int, Field(description="同时下载的文件数")]
    discoveryEnabled: Annotated[
        bool, Field(description="是否被动监听局域网里的打印机广播")
    ]


class Ack(BaseModel):
    """
    接收方处理完一条需要确认的消息后回。重复收到的消息也直接回 ack，不再处理。
    """

    id: Annotated[Uuid, Field(description="被确认的那条消息的 id")]


class Auth(BaseModel):
    """
    daemon 用私钥对挑战签名。
    """

    signature: Annotated[
        str,
        Field(
            description='RSA-PSS（SHA-256，盐长 32）签名的 base64。签的是 UTF-8 字符串 "platerelay-daemon-auth/v1\\n" + daemonId + "\\n" + nonce + "\\n" + 面板的 origin'
        ),
    ]


class Challenge(BaseModel):
    """
    面板对 hello 的回应。
    """

    nonce: Annotated[
        str, Field(description="32 字节随机数的 base64，只能用一次，30 秒内有效")
    ]
    serverTime: Timestamp


class CommandStatus(StrEnum):
    """
    accepted = 打印机收下了，不代表做完，结果看后面的事件；done = 命令本身就是结果；rejected = daemon 没执行；expired = 收到时已过期，没执行，也保证以后不再执行；failed = 执行了但失败。一条命令可能先回 accepted 再回 done 或 failed，以最后一次为准。
    """

    accepted = "accepted"
    done = "done"
    rejected = "rejected"
    expired = "expired"
    failed = "failed"


class CommandResult(BaseModel):
    """
    daemon 对一条命令的回复。
    """

    commandId: Uuid
    status: Annotated[
        CommandStatus,
        Field(
            description="accepted = 打印机收下了，不代表做完，结果看后面的事件；done = 命令本身就是结果；rejected = daemon 没执行；expired = 收到时已过期，没执行，也保证以后不再执行；failed = 执行了但失败。一条命令可能先回 accepted 再回 done 或 failed，以最后一次为准。",
            title="CommandStatus",
        ),
    ]
    code: Annotated[
        str | None,
        Field(
            description="机器可读的原因，如 unsupported_command、printer_busy、daemon_restarted"
        ),
    ] = None
    message: Annotated[str | None, Field(description="固件或打印机原样返回的内容")] = (
        None
    )
    data: Annotated[
        dict[str, Any] | None,
        Field(
            description="按命令类型：job.start 的 step（queued / download / upload）和 attempts，storage.list 的 media 和 files 等"
        ),
    ] = None


class JobFile(BaseModel):
    fileId: Uuid
    sha256: str
    sizeBytes: int


class FilamentMapping(BaseModel):
    sliceSlot: Annotated[int, Field(description="切片文件里的耗材槽")]
    extruder: int
    unit: int
    slot: int


class JobStartParams(BaseModel):
    jobRef: Uuid
    expectedRunSeq: Annotated[
        int,
        Field(
            description="面板派单时见到的运行序号；发开打指令前对不上就拒绝，什么都不发"
        ),
    ]
    file: Annotated[JobFile, Field(title="JobFile")]
    plateIndex: int
    bedType: str
    mapping: list[FilamentMapping]
    timelapse: bool


class JobStartCommand(BaseModel):
    """
    下载文件、放到打印机上并开打。进了下载队列就算开始执行。下载和上传各自最多试 3 次；开打指令发出之后不再重试任何一步。
    """

    commandId: Uuid
    printerId: Uuid
    kind: Literal["job.start"]
    expiresAt: Annotated[
        Timestamp,
        Field(description="必须在这之前开始执行；收到时已过期的回 expired，不执行"),
    ]
    params: Annotated[JobStartParams, Field(title="JobStartParams")]


class StopJobParams(BaseModel):
    jobRef: Uuid


class StopExternalParams(BaseModel):
    external: Literal[True]


class JobStopCommand(BaseModel):
    """
    停止任务。传文件、准备中、打印中都用它；只在打印机正在跑这个任务时才发给打印机。external = 停掉打印机上正在跑的外部任务。
    """

    commandId: Uuid
    printerId: Uuid
    kind: Literal["job.stop"]
    expiresAt: Annotated[
        Timestamp,
        Field(description="必须在这之前开始执行；收到时已过期的回 expired，不执行"),
    ]
    params: StopJobParams | StopExternalParams


class JobSkipPartsParams(BaseModel):
    jobRef: Uuid
    partIds: list[int]


class JobSkipPartsCommand(BaseModel):
    """
    打印中跳过零件。
    """

    commandId: Uuid
    printerId: Uuid
    kind: Literal["job.skip_parts"]
    expiresAt: Annotated[
        Timestamp,
        Field(description="必须在这之前开始执行；收到时已过期的回 expired，不执行"),
    ]
    params: Annotated[JobSkipPartsParams, Field(title="JobSkipPartsParams")]


class ErrorResolveParams(BaseModel):
    errorId: str
    action: StandardErrorAction


class ErrorResolveCommand(BaseModel):
    """
    对一条报错选一个动作。动作是停止时按 job.stop 处理。
    """

    commandId: Uuid
    printerId: Uuid
    kind: Literal["error.resolve"]
    expiresAt: Annotated[
        Timestamp,
        Field(description="必须在这之前开始执行；收到时已过期的回 expired，不执行"),
    ]
    params: Annotated[ErrorResolveParams, Field(title="ErrorResolveParams")]


class ControlParams(BaseModel):
    action: Annotated[str, Field(description="必须在这台打印机机型的静态命令清单里")]
    args: Annotated[
        dict[str, Any], Field(description="设定值一律是目标值，不用切换或加减")
    ]


class ControlCommand(BaseModel):
    """
    设备控制：灯、温度、风扇、速度、暂停、继续、进退料等。
    """

    commandId: Uuid
    printerId: Uuid
    kind: Literal["control"]
    expiresAt: Annotated[
        Timestamp,
        Field(description="必须在这之前开始执行；收到时已过期的回 expired，不执行"),
    ]
    params: Annotated[ControlParams, Field(title="ControlParams")]


class RefreshCommand(BaseModel):
    """
    让打印机重新上报一次完整状态（只读）。
    """

    commandId: Uuid
    printerId: Uuid
    kind: Literal["refresh"]
    expiresAt: Annotated[
        Timestamp,
        Field(description="必须在这之前开始执行；收到时已过期的回 expired，不执行"),
    ]
    params: dict[str, Any]


class StorageListCommand(BaseModel):
    """
    列出打印机存储里的文件（只读，不删不下载）。
    """

    commandId: Uuid
    printerId: Uuid
    kind: Literal["storage.list"]
    expiresAt: Annotated[
        Timestamp,
        Field(description="必须在这之前开始执行；收到时已过期的回 expired，不执行"),
    ]
    params: dict[str, Any]


class VideoStreamParams(BaseModel):
    srtUrl: str
    rtspsUrl: str
    publishToken: str
    latencyMs: int
    expiresAt: Timestamp


class JpegFramesParams(BaseModel):
    framesUrl: str


class CameraOpenCommand(BaseModel):
    """
    开始往媒体服务推实况。
    """

    commandId: Uuid
    printerId: Uuid
    kind: Literal["camera.open"]
    expiresAt: Annotated[
        Timestamp,
        Field(description="必须在这之前开始执行；收到时已过期的回 expired，不执行"),
    ]
    params: VideoStreamParams | JpegFramesParams


class CameraCloseCommand(BaseModel):
    """
    停止推实况。
    """

    commandId: Uuid
    printerId: Uuid
    kind: Literal["camera.close"]
    expiresAt: Annotated[
        Timestamp,
        Field(description="必须在这之前开始执行；收到时已过期的回 expired，不执行"),
    ]
    params: dict[str, Any]


class SnapshotModeParams(BaseModel):
    watched: Annotated[bool, Field(description="这台打印机现在有没有人在看")]


class SnapshotModeCommand(BaseModel):
    """
    切换抓拍频率。
    """

    commandId: Uuid
    printerId: Uuid
    kind: Literal["snapshot.mode"]
    expiresAt: Annotated[
        Timestamp,
        Field(description="必须在这之前开始执行；收到时已过期的回 expired，不执行"),
    ]
    params: Annotated[SnapshotModeParams, Field(title="SnapshotModeParams")]


class SnapshotReason(StrEnum):
    FIRST_VIEWER = "FIRST_VIEWER"
    ERROR = "ERROR"


class SnapshotNowParams(BaseModel):
    reason: Annotated[SnapshotReason, Field(title="SnapshotReason")]


class SnapshotNowCommand(BaseModel):
    """
    立刻抓拍一张。
    """

    commandId: Uuid
    printerId: Uuid
    kind: Literal["snapshot.now"]
    expiresAt: Annotated[
        Timestamp,
        Field(description="必须在这之前开始执行；收到时已过期的回 expired，不执行"),
    ]
    params: Annotated[SnapshotNowParams, Field(title="SnapshotNowParams")]


class TimelapseCollectParams(BaseModel):
    jobRef: Uuid


class TimelapseCollectCommand(BaseModel):
    """
    取回并上传这个任务的延时摄影。
    """

    commandId: Uuid
    printerId: Uuid
    kind: Literal["timelapse.collect"]
    expiresAt: Annotated[
        Timestamp,
        Field(description="必须在这之前开始执行；收到时已过期的回 expired，不执行"),
    ]
    params: Annotated[TimelapseCollectParams, Field(title="TimelapseCollectParams")]


class Command(
    RootModel[
        JobStartCommand
        | JobStopCommand
        | JobSkipPartsCommand
        | ErrorResolveCommand
        | ControlCommand
        | RefreshCommand
        | StorageListCommand
        | CameraOpenCommand
        | CameraCloseCommand
        | SnapshotModeCommand
        | SnapshotNowCommand
        | TimelapseCollectCommand
    ]
):
    root: Annotated[
        JobStartCommand
        | JobStopCommand
        | JobSkipPartsCommand
        | ErrorResolveCommand
        | ControlCommand
        | RefreshCommand
        | StorageListCommand
        | CameraOpenCommand
        | CameraCloseCommand
        | SnapshotModeCommand
        | SnapshotNowCommand
        | TimelapseCollectCommand,
        Field(
            description="面板发给 daemon 的命令。daemon 只执行这里列出的类型，别的一律 rejected。同一个 commandId 最多执行一次：执行前先把它写进硬盘，daemon 重启也一样。",
            title="Command",
        ),
    ]


class ConfigUpdate(RootModel[DaemonConfig]):
    root: Annotated[
        DaemonConfig,
        Field(description="面板设置变了且和 daemon 有关时下发。", title="ConfigUpdate"),
    ]


class DiscoveredPrinter(BaseModel):
    brand: str
    serial: str
    host: str
    modelId: str | None = None
    name: str | None = None
    lastSeenAt: Timestamp


class DiscoveryReport(BaseModel):
    """
    被动监听局域网广播听到的打印机，每次是完整列表，有变化时发，最多每 10 秒一次。只听不发。
    """

    printers: list[DiscoveredPrinter]


class EnrollRequest(BaseModel):
    """
    POST /daemon/v1/enroll 的请求体。
    """

    token: Annotated[
        str, Field(description="一次性注册令牌，15 分钟有效，用一次就作废")
    ]
    publicKey: Annotated[str, Field(description="daemon 公钥，SPKI DER 的 base64")]
    name: str
    platform: str
    daemonVersion: str
    protocolVersion: Annotated[str, Field(pattern="^\\d+\\.\\d+$")]


class EnrollResponse(BaseModel):
    """
    POST /daemon/v1/enroll 的响应体。
    """

    daemonId: Uuid


class Envelope(BaseModel):
    """
    控制通道上每个 JSON 文本帧的信封。
    """

    id: Annotated[Uuid, Field(description="每条消息唯一，接收方按它去重")]
    type: Annotated[
        str, Field(description="消息类型，如 printer.event；不认识的类型回 ack 后忽略")
    ]
    ts: Timestamp
    body: dict[str, Any]


class AdapterInfo(BaseModel):
    brand: str
    version: str


class Hello(BaseModel):
    """
    daemon 连上后发的第一条消息。
    """

    daemonId: Uuid
    protocolVersion: Annotated[
        str, Field(description="主.次，如 1.0", pattern="^\\d+\\.\\d+$")
    ]
    daemonVersion: str
    platform: Annotated[str, Field(description="linux / windows / docker 等")]
    bootId: Annotated[Uuid, Field(description="daemon 进程每次启动生成")]
    adapters: list[AdapterInfo]


class Ping(BaseModel):
    """
    心跳。
    """


class Pong(BaseModel):
    """
    心跳回应。
    """


class ConnectionUpEvent(BaseModel):
    """
    daemon 重新连上打印机；面板随后按最新快照对账。
    """

    printerId: Uuid
    bootId: Uuid
    seq: Annotated[int, Field(ge=0)]
    kind: Literal["connection.up"]
    data: dict[str, Any] | None = None


class ConnectionDownData(BaseModel):
    reason: Annotated[str, Field(description="如 access_code_key_mismatch")]


class ConnectionDownEvent(BaseModel):
    """
    daemon 连不上这台打印机。
    """

    printerId: Uuid
    bootId: Uuid
    seq: Annotated[int, Field(ge=0)]
    kind: Literal["connection.down"]
    data: Annotated[ConnectionDownData, Field(title="ConnectionDownData")]


class JobStagedEvent(BaseModel):
    """
    文件已经放到打印机上，开打指令已发出。
    """

    printerId: Uuid
    bootId: Uuid
    seq: Annotated[int, Field(ge=0)]
    kind: Literal["job.staged"]
    jobRef: Uuid
    data: dict[str, Any] | None = None


class JobStartedEvent(BaseModel):
    """
    打印机报告开始打印。
    """

    printerId: Uuid
    bootId: Uuid
    seq: Annotated[int, Field(ge=0)]
    kind: Literal["job.started"]
    jobRef: Uuid
    data: dict[str, Any] | None = None


class PauseReason(StrEnum):
    USER = "USER"
    ERROR = "ERROR"
    RUNOUT = "RUNOUT"


class JobPausedData(BaseModel):
    reason: Annotated[PauseReason, Field(title="PauseReason")]


class JobPausedEvent(BaseModel):
    """
    任务暂停。
    """

    printerId: Uuid
    bootId: Uuid
    seq: Annotated[int, Field(ge=0)]
    kind: Literal["job.paused"]
    jobRef: Uuid
    data: Annotated[JobPausedData, Field(title="JobPausedData")]


class JobResumedEvent(BaseModel):
    """
    任务从暂停恢复。
    """

    printerId: Uuid
    bootId: Uuid
    seq: Annotated[int, Field(ge=0)]
    kind: Literal["job.resumed"]
    jobRef: Uuid
    data: dict[str, Any] | None = None


class JobFinishedEvent(BaseModel):
    """
    打印机报告打完。
    """

    printerId: Uuid
    bootId: Uuid
    seq: Annotated[int, Field(ge=0)]
    kind: Literal["job.finished"]
    jobRef: Uuid
    data: dict[str, Any] | None = None


class JobFailedData(BaseModel):
    reason: str
    beforeStart: Annotated[bool, Field(description="true = 开打前就失败了")]


class JobFailedEvent(BaseModel):
    """
    打印机报告任务失败。
    """

    printerId: Uuid
    bootId: Uuid
    seq: Annotated[int, Field(ge=0)]
    kind: Literal["job.failed"]
    jobRef: Uuid
    data: Annotated[JobFailedData, Field(title="JobFailedData")]


class JobCancelledData(BaseModel):
    commandId: Annotated[
        Uuid | None,
        Field(description="带着 = 面板发的停止生效了；没有 = 有人在打印机屏幕上停的"),
    ] = None
    beforeStart: Annotated[
        bool, Field(description="true = 没开打就停下了。订单去向只看这个字段")
    ]


class JobCancelledEvent(BaseModel):
    """
    任务被停止。
    """

    printerId: Uuid
    bootId: Uuid
    seq: Annotated[int, Field(ge=0)]
    kind: Literal["job.cancelled"]
    jobRef: Uuid
    data: Annotated[JobCancelledData, Field(title="JobCancelledData")]


class JobPartsSkippedData(BaseModel):
    partIds: Annotated[list[int], Field(description="打印机上报的已跳过零件的完整列表")]


class JobPartsSkippedEvent(BaseModel):
    """
    已跳过的零件变了。
    """

    printerId: Uuid
    bootId: Uuid
    seq: Annotated[int, Field(ge=0)]
    kind: Literal["job.parts_skipped"]
    jobRef: Uuid
    data: Annotated[JobPartsSkippedData, Field(title="JobPartsSkippedData")]


class ExternalStartedData(BaseModel):
    name: str


class ExternalStartedEvent(BaseModel):
    """
    打印机开始跑一个不是系统下发的任务。一个已结束任务又跑起来也报成这个。
    """

    printerId: Uuid
    bootId: Uuid
    seq: Annotated[int, Field(ge=0)]
    kind: Literal["external.started"]
    data: Annotated[ExternalStartedData, Field(title="ExternalStartedData")]


class ExternalEndedData(BaseModel):
    result: Annotated[str, Field(description="FINISHED / FAILED / CANCELLED")]


class ExternalEndedEvent(BaseModel):
    """
    外部任务结束。
    """

    printerId: Uuid
    bootId: Uuid
    seq: Annotated[int, Field(ge=0)]
    kind: Literal["external.ended"]
    data: Annotated[ExternalEndedData, Field(title="ExternalEndedData")]


class ErrorRaisedData(BaseModel):
    error: ActiveError


class ErrorRaisedEvent(BaseModel):
    """
    打印机出现一条新报错。
    """

    printerId: Uuid
    bootId: Uuid
    seq: Annotated[int, Field(ge=0)]
    kind: Literal["error.raised"]
    jobRef: Uuid | None = None
    data: Annotated[ErrorRaisedData, Field(title="ErrorRaisedData")]


class ErrorClearedBy(StrEnum):
    PANEL = "PANEL"
    DEVICE = "DEVICE"
    UNKNOWN = "UNKNOWN"


class ErrorClearedData(BaseModel):
    errorId: str
    clearedBy: Annotated[ErrorClearedBy, Field(title="ErrorClearedBy")]


class ErrorClearedEvent(BaseModel):
    """
    一条报错消失了。
    """

    printerId: Uuid
    bootId: Uuid
    seq: Annotated[int, Field(ge=0)]
    kind: Literal["error.cleared"]
    jobRef: Uuid | None = None
    data: Annotated[ErrorClearedData, Field(title="ErrorClearedData")]


class FilamentRefilledEvent(BaseModel):
    """
    固件自动续料换了槽，只记日志。
    """

    printerId: Uuid
    bootId: Uuid
    seq: Annotated[int, Field(ge=0)]
    kind: Literal["filament.refilled"]
    jobRef: Uuid | None = None
    data: Annotated[
        dict[str, Any], Field(description="fromSlot、toSlot；具体字段等真机实测后再定")
    ]


class TimelapseFile(BaseModel):
    name: str
    sizeBytes: int


class TimelapseReadyData(BaseModel):
    files: list[TimelapseFile]


class TimelapseReadyEvent(BaseModel):
    """
    延时摄影文件已经生成，等 daemon 上传。
    """

    printerId: Uuid
    bootId: Uuid
    seq: Annotated[int, Field(ge=0)]
    kind: Literal["timelapse.ready"]
    jobRef: Uuid
    data: Annotated[TimelapseReadyData, Field(title="TimelapseReadyData")]


class PrinterEvent(
    RootModel[
        ConnectionUpEvent
        | ConnectionDownEvent
        | JobStagedEvent
        | JobStartedEvent
        | JobPausedEvent
        | JobResumedEvent
        | JobFinishedEvent
        | JobFailedEvent
        | JobCancelledEvent
        | JobPartsSkippedEvent
        | ExternalStartedEvent
        | ExternalEndedEvent
        | ErrorRaisedEvent
        | ErrorClearedEvent
        | FilamentRefilledEvent
        | TimelapseReadyEvent
    ]
):
    root: Annotated[
        ConnectionUpEvent
        | ConnectionDownEvent
        | JobStagedEvent
        | JobStartedEvent
        | JobPausedEvent
        | JobResumedEvent
        | JobFinishedEvent
        | JobFailedEvent
        | JobCancelledEvent
        | JobPartsSkippedEvent
        | ExternalStartedEvent
        | ExternalEndedEvent
        | ErrorRaisedEvent
        | ErrorClearedEvent
        | FilamentRefilledEvent
        | TimelapseReadyEvent,
        Field(
            description="打印机上的一个离散事件。面板靠事件推进状态，用快照对账。同一台打印机的事件按 seq 顺序处理。",
            title="PrinterEvent",
        ),
    ]


class SnapshotJob(BaseModel):
    """
    打印机正在跑或刚结束的任务，没有为 null。
    """

    jobRef: Annotated[
        Uuid | None, Field(description="系统任务的打印任务 ID；外部任务没有")
    ] = None
    external: Annotated[bool, Field(description="true = 不是系统下发的任务")]
    name: Annotated[str | None, Field(description="打印机上的任务名或文件名")] = None
    percent: Annotated[int | None, Field(ge=0, le=100)] = None
    remainingSeconds: Annotated[int | None, Field(ge=0)] = None
    layer: Annotated[int | None, Field(ge=0)] = None
    totalLayers: Annotated[int | None, Field(ge=0)] = None
    skippedParts: Annotated[
        list[int] | None, Field(description="打印机上报的已跳过零件")
    ] = None


class PendingStartStage(StrEnum):
    QUEUED = "QUEUED"
    DOWNLOADING = "DOWNLOADING"
    UPLOADING = "UPLOADING"


class PendingStart(BaseModel):
    jobRef: Uuid
    stage: Annotated[PendingStartStage, Field(title="PendingStartStage")]


class Temperature(BaseModel):
    current: float
    target: float | None = None


class SnapshotNozzle(BaseModel):
    extruder: Annotated[int, Field(ge=1)]
    diameterMm: float
    flow: str | None = None


class SnapshotTray(BaseModel):
    unit: Annotated[int, Field(description="AMS 编号；外挂料 = -1")]
    slot: int
    label: str | None = None
    material: str | None = None
    subType: str | None = None
    colour: Annotated[str | None, Field(description="#RRGGBB")] = None
    rfidUid: Annotated[
        str | None,
        Field(description="RFID 卷的唯一号，非 RFID 卷省略；面板拿它判断是否换过料"),
    ] = None
    remainingPercent: Annotated[
        int | None,
        Field(description="打印机自己估的余量，照传但面板不用来算", ge=0, le=100),
    ] = None
    extruders: Annotated[
        list[int] | None, Field(description="这个料位能供给的挤出机")
    ] = None


class StorageMedium(BaseModel):
    medium: Annotated[str, Field(description="internal / usb / sdcard 等")]
    present: bool
    writable: bool | None = None
    freeBytes: int | None = None


class CameraCapabilities(BaseModel):
    stream: bool
    snapshot: bool


class PrinterSnapshot(BaseModel):
    """
    整台打印机的完整状态（不是增量），变化时发，同一台最多每秒一次。不确认、不重发，下一份会覆盖它。拿不到的字段省略，不填假值。
    """

    printerId: Uuid
    bootId: Annotated[Uuid, Field(description="daemon 这次启动的标识")]
    seq: Annotated[
        int,
        Field(
            description="这台打印机在这次启动里单调递增；面板丢掉比已处理的更旧的快照",
            ge=0,
        ),
    ]
    connected: Annotated[bool, Field(description="daemon 现在连不连得上这台打印机")]
    state: NormalizedState
    substage: Substage | None = None
    job: Annotated[
        SnapshotJob | None,
        Field(
            description="打印机正在跑或刚结束的任务，没有为 null。", title="SnapshotJob"
        ),
    ] = None
    pendingStarts: Annotated[
        list[PendingStart] | None,
        Field(
            description="daemon 手里还没发出开打指令的任务；已经停下、不会再开打的不列。对账靠它认出任务还在进行。"
        ),
    ] = None
    temps: Annotated[
        dict[str, Temperature] | None, Field(description="键如 nozzle1、bed、chamber")
    ] = None
    nozzles: list[SnapshotNozzle] | None = None
    trays: list[SnapshotTray] | None = None
    bedType: str | None = None
    storage: list[StorageMedium] | None = None
    activeErrors: list[ActiveError] | None = None
    controls: Annotated[
        dict[str, Any] | None, Field(description="设定值类控制的当前值，如灯、速度档")
    ] = None
    camera: Annotated[CameraCapabilities | None, Field(title="CameraCapabilities")] = (
        None
    )
    deviceBoot: Annotated[
        str | None,
        Field(description="适配器给的打印机这次开机的标识，拿不到就省略；只用于显示"),
    ] = None
    runSeq: Annotated[
        int,
        Field(
            description="daemon 给这台打印机记的运行序号，落盘、只增不减：每看到打印机开始一次运行加一；有一段时间看不到打印机、证明不了它没跑过东西的也加一。只用于开打前检查和确认任务没开打。",
            ge=0,
        ),
    ]


class PrintersAssign(BaseModel):
    """
    这个 daemon 负责哪些打印机，每次都是完整列表。列表里没有的打印机，daemon 断开它并删掉它的本地状态。
    """

    printers: list[AssignedPrinter]


class TokenRenew(BaseModel):
    """
    HTTP 令牌到期前面板换新的。
    """

    httpToken: str
    httpTokenExpiresAt: Timestamp


class UpgradeRequired(BaseModel):
    """
    daemon 的协议版本太老，面板发完这条就断开。
    """

    minProtocolVersion: Annotated[str, Field(pattern="^\\d+\\.\\d+$")]
    upgradeCommand: Annotated[
        str, Field(description="给人执行的升级命令；daemon 只记进日志，不自动升级")
    ]


class Welcome(BaseModel):
    """
    认证通过。daemon 用 serverTime 算出和面板的时钟差，之后按面板的时间判断命令是否过期。
    """

    sessionId: Uuid
    protocolVersion: Annotated[str, Field(pattern="^\\d+\\.\\d+$")]
    serverTime: Timestamp | None = None
    heartbeatSeconds: Annotated[int, Field(ge=1)]
    httpToken: Annotated[
        str, Field(description="调 HTTP 接口用的令牌，和这条连接同生共死")
    ]
    httpTokenExpiresAt: Timestamp
    printers: list[AssignedPrinter]
    config: DaemonConfig
