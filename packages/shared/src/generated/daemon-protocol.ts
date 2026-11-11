// 自动生成，不要手改。来源在 packages/shared/schema/，用 `pnpm --filter @platerelay/shared generate` 重新生成。

/**
 * UUIDv7
 * 
 * This interface was referenced by `DaemonProtocol`'s JSON-Schema
 * via the `definition` "Uuid".
 */
export type Uuid = string
/**
 * RFC 3339 UTC 时间
 * 
 * This interface was referenced by `DaemonProtocol`'s JSON-Schema
 * via the `definition` "Timestamp".
 */
export type Timestamp = string
/**
 * 适配器上报的标准设备状态，不是面板的打印机状态；换算只在面板做。
 * 
 * This interface was referenced by `DaemonProtocol`'s JSON-Schema
 * via the `definition` "NormalizedState".
 */
export type NormalizedState = ("OFFLINE" | "NOT_READY" | "IDLE" | "BUSY" | "PREPARING" | "PRINTING" | "PAUSED" | "ERROR_PAUSED" | "FINISHED" | "FAILED" | "CANCELLED" | "FAULT" | "UNKNOWN")
/**
 * 标准子阶段，只用于展示。
 * 
 * This interface was referenced by `DaemonProtocol`'s JSON-Schema
 * via the `definition` "Substage".
 */
export type Substage = ("heating_bed" | "heating_nozzle" | "heating_chamber" | "cooling" | "homing" | "leveling" | "calibrating" | "cleaning_nozzle" | "inspecting_first_layer" | "identifying_plate" | "changing_filament" | "loading_filament" | "unloading_filament" | "other")
/**
 * 报错可选的标准动作。
 * 
 * This interface was referenced by `DaemonProtocol`'s JSON-Schema
 * via the `definition` "StandardErrorAction".
 */
export type StandardErrorAction = ("RESUME" | "RESUME_ACCEPT_DEFECTS" | "RESUME_PROBLEM_SOLVED" | "RETRY" | "CONFIRM_DONE" | "IGNORE" | "IGNORE_PERMANENTLY" | "ACKNOWLEDGE" | "STOP" | "ABORT_OPERATION" | "SILENCE_ALARM" | "RECHECK" | "FIRMWARE_RESTART" | "EMERGENCY_STOP")
export type ErrorSeverity = ("fatal" | "error" | "warning" | "info")
/**
 * accepted = 打印机收下了，不代表做完，结果看后面的事件；done = 命令本身就是结果；rejected = daemon 没执行；expired = 收到时已过期，没执行，也保证以后不再执行；failed = 执行了但失败。一条命令可能先回 accepted 再回 done 或 failed，以最后一次为准。
 */
export type CommandStatus = ("accepted" | "done" | "rejected" | "expired" | "failed")
/**
 * 面板发给 daemon 的命令。daemon 只执行这里列出的类型，别的一律 rejected。同一个 commandId 最多执行一次：执行前先把它写进硬盘，daemon 重启也一样。
 * 
 * This interface was referenced by `DaemonProtocol`'s JSON-Schema
 * via the `definition` "Command".
 */
export type Command = (JobStartCommand | JobStopCommand | JobSkipPartsCommand | ErrorResolveCommand | ControlCommand | RefreshCommand | StorageListCommand | CameraOpenCommand | CameraCloseCommand | SnapshotModeCommand | SnapshotNowCommand | TimelapseCollectCommand)
export type SnapshotReason = ("FIRST_VIEWER" | "ERROR")
/**
 * 打印机上的一个离散事件。面板靠事件推进状态，用快照对账。同一台打印机的事件按 seq 顺序处理。
 * 
 * This interface was referenced by `DaemonProtocol`'s JSON-Schema
 * via the `definition` "PrinterEvent".
 */
export type PrinterEvent = (ConnectionUpEvent | ConnectionDownEvent | JobStagedEvent | JobStartedEvent | JobPausedEvent | JobResumedEvent | JobFinishedEvent | JobFailedEvent | JobCancelledEvent | JobPartsSkippedEvent | ExternalStartedEvent | ExternalEndedEvent | ErrorRaisedEvent | ErrorClearedEvent | FilamentRefilledEvent | TimelapseReadyEvent)
export type PauseReason = ("USER" | "ERROR" | "RUNOUT")
export type ErrorClearedBy = ("PANEL" | "DEVICE" | "UNKNOWN")
/**
 * 打印机正在跑或刚结束的任务，没有为 null。
 */
export type SnapshotJob = ({
/**
 * UUIDv7
 */
jobRef?: string
/**
 * true = 不是系统下发的任务
 */
external: boolean
/**
 * 打印机上的任务名或文件名
 */
name?: string
percent?: number
remainingSeconds?: number
layer?: number
totalLayers?: number
/**
 * 打印机上报的已跳过零件
 */
skippedParts?: number[]
} | null)
export type PendingStartStage = ("QUEUED" | "DOWNLOADING" | "UPLOADING")

/**
 * daemon 协议的全部消息，由 schema/daemon/v1/ 下的文件合成。
 */
export interface DaemonProtocol {
[k: string]: unknown
}
/**
 * This interface was referenced by `DaemonProtocol`'s JSON-Schema
 * via the `definition` "ErrorActionOption".
 */
export interface ErrorActionOption {
action: StandardErrorAction
/**
 * 厂商原始按钮 ID，排查用
 */
vendorActionId?: (string | number)
label: string
/**
 * 必须有人在机器旁处理过才能点
 */
requiresOnSite: boolean
/**
 * 会终止任务
 */
destructive: boolean
}
/**
 * 打印机上一条还没消失的报错。
 * 
 * This interface was referenced by `DaemonProtocol`'s JSON-Schema
 * via the `definition` "ActiveError".
 */
export interface ActiveError {
/**
 * 本次报错的唯一 ID，适配器生成
 */
errorId: string
/**
 * 厂商原始码
 */
vendorCode: string
/**
 * 报错来源通道，如 print_error、hms
 */
channel: string
severity: ErrorSeverity
/**
 * 如 ams、toolhead
 */
module?: string
message?: string
helpUrl?: string
/**
 * 是否卡住了当前任务
 */
blocksJob: boolean
actions: ErrorActionOption[]
raisedAt: Timestamp
}
/**
 * 分配给这个 daemon 的一台打印机。是不是系统任务以面板下发的为准。
 * 
 * This interface was referenced by `DaemonProtocol`'s JSON-Schema
 * via the `definition` "AssignedPrinter".
 */
export interface AssignedPrinter {
printerId: Uuid
/**
 * 适配器品牌，如 bambu
 */
brand: string
serial: string
/**
 * 打印机在局域网里的地址
 */
host: string
/**
 * 浏览器用 daemon 公钥加密的访问码密文（base64）。面板解不开，只是转交；daemon 只在内存里解密，不落盘、不进日志。
 */
accessCodeCipher: string
/**
 * 加密时用的 daemon 公钥指纹；对不上说明 daemon 换过密钥，要重填访问码
 */
keyFingerprint: string
currentJobRef: (string | null)
/**
 * 已结束、但打印机上可能还留着文件要收尾的任务
 */
cleanupJobRefs: Uuid[]
/**
 * 面板已知的这台打印机的最大运行序号；daemon 丢了本地状态时从比它大的数重新开始
 */
knownRunSeq?: number
}
/**
 * 面板下发给 daemon 的参数。
 * 
 * This interface was referenced by `DaemonProtocol`'s JSON-Schema
 * via the `definition` "DaemonConfig".
 */
export interface DaemonConfig {
snapshot: SnapshotConfig
/**
 * 下载或上传文件每次尝试的超时，从真正开始传起算
 */
transferTimeoutSeconds: number
/**
 * 同时下载的文件数
 */
downloadConcurrency: number
/**
 * 是否被动监听局域网里的打印机广播
 */
discoveryEnabled: boolean
}
export interface SnapshotConfig {
/**
 * 有人在看时的抓拍间隔
 */
watchedSeconds: number
/**
 * 没人看时的抓拍间隔
 */
unwatchedSeconds: number
/**
 * 多台打印机之间错开的秒数
 */
staggerSeconds: number
/**
 * 抓拍上传的总速率上限
 */
uploadKbps: number
}
/**
 * 接收方处理完一条需要确认的消息后回。重复收到的消息也直接回 ack，不再处理。
 * 
 * This interface was referenced by `DaemonProtocol`'s JSON-Schema
 * via the `definition` "Ack".
 */
export interface Ack {
/**
 * UUIDv7
 */
id: string
}
/**
 * daemon 用私钥对挑战签名。
 * 
 * This interface was referenced by `DaemonProtocol`'s JSON-Schema
 * via the `definition` "Auth".
 */
export interface Auth {
/**
 * RSA-PSS（SHA-256，盐长 32）签名的 base64。签的是 UTF-8 字符串 "platerelay-daemon-auth/v1\n" + daemonId + "\n" + nonce + "\n" + 面板的 origin
 */
signature: string
}
/**
 * 面板对 hello 的回应。
 * 
 * This interface was referenced by `DaemonProtocol`'s JSON-Schema
 * via the `definition` "Challenge".
 */
export interface Challenge {
/**
 * 32 字节随机数的 base64，只能用一次，30 秒内有效
 */
nonce: string
serverTime: Timestamp
}
/**
 * daemon 对一条命令的回复。
 * 
 * This interface was referenced by `DaemonProtocol`'s JSON-Schema
 * via the `definition` "CommandResult".
 */
export interface CommandResult {
commandId: Uuid
status: CommandStatus
/**
 * 机器可读的原因，如 unsupported_command、printer_busy、daemon_restarted
 */
code?: (string | null)
/**
 * 固件或打印机原样返回的内容
 */
message?: (string | null)
/**
 * 按命令类型：job.start 的 step（queued / download / upload）和 attempts，storage.list 的 media 和 files 等
 */
data?: {

}
}
/**
 * 下载文件、放到打印机上并开打。进了下载队列就算开始执行。下载和上传各自最多试 3 次；开打指令发出之后不再重试任何一步。
 */
export interface JobStartCommand {
commandId: Uuid
printerId: Uuid
kind: "job.start"
/**
 * RFC 3339 UTC 时间
 */
expiresAt: string
params: JobStartParams
}
export interface JobStartParams {
jobRef: Uuid
/**
 * 面板派单时见到的运行序号；发开打指令前对不上就拒绝，什么都不发
 */
expectedRunSeq: number
file: JobFile
plateIndex: number
bedType: string
mapping: FilamentMapping[]
timelapse: boolean
}
export interface JobFile {
fileId: Uuid
sha256: string
sizeBytes: number
}
export interface FilamentMapping {
/**
 * 切片文件里的耗材槽
 */
sliceSlot: number
extruder: number
unit: number
slot: number
}
/**
 * 停止任务。传文件、准备中、打印中都用它；只在打印机正在跑这个任务时才发给打印机。external = 停掉打印机上正在跑的外部任务。
 */
export interface JobStopCommand {
commandId: Uuid
printerId: Uuid
kind: "job.stop"
/**
 * RFC 3339 UTC 时间
 */
expiresAt: string
params: (StopJobParams | StopExternalParams)
}
export interface StopJobParams {
jobRef: Uuid
}
export interface StopExternalParams {
external: true
}
/**
 * 打印中跳过零件。
 */
export interface JobSkipPartsCommand {
commandId: Uuid
printerId: Uuid
kind: "job.skip_parts"
/**
 * RFC 3339 UTC 时间
 */
expiresAt: string
params: JobSkipPartsParams
}
export interface JobSkipPartsParams {
jobRef: Uuid
partIds: number[]
}
/**
 * 对一条报错选一个动作。动作是停止时按 job.stop 处理。
 */
export interface ErrorResolveCommand {
commandId: Uuid
printerId: Uuid
kind: "error.resolve"
/**
 * RFC 3339 UTC 时间
 */
expiresAt: string
params: ErrorResolveParams
}
export interface ErrorResolveParams {
errorId: string
action: StandardErrorAction
}
/**
 * 设备控制：灯、温度、风扇、速度、暂停、继续、进退料等。
 */
export interface ControlCommand {
commandId: Uuid
printerId: Uuid
kind: "control"
/**
 * RFC 3339 UTC 时间
 */
expiresAt: string
params: ControlParams
}
export interface ControlParams {
/**
 * 必须在这台打印机机型的静态命令清单里
 */
action: string
/**
 * 设定值一律是目标值，不用切换或加减
 */
args: {

}
}
/**
 * 让打印机重新上报一次完整状态（只读）。
 */
export interface RefreshCommand {
commandId: Uuid
printerId: Uuid
kind: "refresh"
/**
 * RFC 3339 UTC 时间
 */
expiresAt: string
params: {

}
}
/**
 * 列出打印机存储里的文件（只读，不删不下载）。
 */
export interface StorageListCommand {
commandId: Uuid
printerId: Uuid
kind: "storage.list"
/**
 * RFC 3339 UTC 时间
 */
expiresAt: string
params: {

}
}
/**
 * 开始往媒体服务推实况。
 */
export interface CameraOpenCommand {
commandId: Uuid
printerId: Uuid
kind: "camera.open"
/**
 * RFC 3339 UTC 时间
 */
expiresAt: string
params: (VideoStreamParams | JpegFramesParams)
}
export interface VideoStreamParams {
srtUrl: string
rtspsUrl: string
publishToken: string
latencyMs: number
expiresAt: Timestamp
}
export interface JpegFramesParams {
framesUrl: string
}
/**
 * 停止推实况。
 */
export interface CameraCloseCommand {
commandId: Uuid
printerId: Uuid
kind: "camera.close"
/**
 * RFC 3339 UTC 时间
 */
expiresAt: string
params: {

}
}
/**
 * 切换抓拍频率。
 */
export interface SnapshotModeCommand {
commandId: Uuid
printerId: Uuid
kind: "snapshot.mode"
/**
 * RFC 3339 UTC 时间
 */
expiresAt: string
params: SnapshotModeParams
}
export interface SnapshotModeParams {
/**
 * 这台打印机现在有没有人在看
 */
watched: boolean
}
/**
 * 立刻抓拍一张。
 */
export interface SnapshotNowCommand {
commandId: Uuid
printerId: Uuid
kind: "snapshot.now"
/**
 * RFC 3339 UTC 时间
 */
expiresAt: string
params: SnapshotNowParams
}
export interface SnapshotNowParams {
reason: SnapshotReason
}
/**
 * 取回并上传这个任务的延时摄影。
 */
export interface TimelapseCollectCommand {
commandId: Uuid
printerId: Uuid
kind: "timelapse.collect"
/**
 * RFC 3339 UTC 时间
 */
expiresAt: string
params: TimelapseCollectParams
}
export interface TimelapseCollectParams {
jobRef: Uuid
}
/**
 * 面板设置变了且和 daemon 有关时下发。
 * 
 * This interface was referenced by `DaemonProtocol`'s JSON-Schema
 * via the `definition` "ConfigUpdate".
 */
export interface ConfigUpdate {
snapshot: SnapshotConfig
/**
 * 下载或上传文件每次尝试的超时，从真正开始传起算
 */
transferTimeoutSeconds: number
/**
 * 同时下载的文件数
 */
downloadConcurrency: number
/**
 * 是否被动监听局域网里的打印机广播
 */
discoveryEnabled: boolean
}
/**
 * 被动监听局域网广播听到的打印机，每次是完整列表，有变化时发，最多每 10 秒一次。只听不发。
 * 
 * This interface was referenced by `DaemonProtocol`'s JSON-Schema
 * via the `definition` "DiscoveryReport".
 */
export interface DiscoveryReport {
printers: DiscoveredPrinter[]
}
export interface DiscoveredPrinter {
brand: string
serial: string
host: string
modelId?: string
name?: string
lastSeenAt: Timestamp
}
/**
 * POST /daemon/v1/enroll 的请求体。
 * 
 * This interface was referenced by `DaemonProtocol`'s JSON-Schema
 * via the `definition` "EnrollRequest".
 */
export interface EnrollRequest {
/**
 * 一次性注册令牌，15 分钟有效，用一次就作废
 */
token: string
/**
 * daemon 公钥，SPKI DER 的 base64
 */
publicKey: string
name: string
platform: string
daemonVersion: string
protocolVersion: string
}
/**
 * POST /daemon/v1/enroll 的响应体。
 * 
 * This interface was referenced by `DaemonProtocol`'s JSON-Schema
 * via the `definition` "EnrollResponse".
 */
export interface EnrollResponse {
daemonId: Uuid
}
/**
 * 控制通道上每个 JSON 文本帧的信封。
 * 
 * This interface was referenced by `DaemonProtocol`'s JSON-Schema
 * via the `definition` "Envelope".
 */
export interface Envelope {
/**
 * UUIDv7
 */
id: string
/**
 * 消息类型，如 printer.event；不认识的类型回 ack 后忽略
 */
type: string
ts: Timestamp
body: {

}
}
/**
 * daemon 连上后发的第一条消息。
 * 
 * This interface was referenced by `DaemonProtocol`'s JSON-Schema
 * via the `definition` "Hello".
 */
export interface Hello {
daemonId: Uuid
/**
 * 主.次，如 1.0
 */
protocolVersion: string
daemonVersion: string
/**
 * linux / windows / docker 等
 */
platform: string
/**
 * UUIDv7
 */
bootId: string
adapters: AdapterInfo[]
}
export interface AdapterInfo {
brand: string
version: string
}
/**
 * 心跳。
 * 
 * This interface was referenced by `DaemonProtocol`'s JSON-Schema
 * via the `definition` "Ping".
 */
export interface Ping {

}
/**
 * 心跳回应。
 * 
 * This interface was referenced by `DaemonProtocol`'s JSON-Schema
 * via the `definition` "Pong".
 */
export interface Pong {

}
/**
 * daemon 重新连上打印机；面板随后按最新快照对账。
 */
export interface ConnectionUpEvent {
printerId: Uuid
bootId: Uuid
seq: number
kind: "connection.up"
data?: {

}
}
/**
 * daemon 连不上这台打印机。
 */
export interface ConnectionDownEvent {
printerId: Uuid
bootId: Uuid
seq: number
kind: "connection.down"
data: ConnectionDownData
}
export interface ConnectionDownData {
/**
 * 如 access_code_key_mismatch
 */
reason: string
}
/**
 * 文件已经放到打印机上，开打指令已发出。
 */
export interface JobStagedEvent {
printerId: Uuid
bootId: Uuid
seq: number
kind: "job.staged"
jobRef: Uuid
data?: {

}
}
/**
 * 打印机报告开始打印。
 */
export interface JobStartedEvent {
printerId: Uuid
bootId: Uuid
seq: number
kind: "job.started"
jobRef: Uuid
data?: {

}
}
/**
 * 任务暂停。
 */
export interface JobPausedEvent {
printerId: Uuid
bootId: Uuid
seq: number
kind: "job.paused"
jobRef: Uuid
data: JobPausedData
}
export interface JobPausedData {
reason: PauseReason
}
/**
 * 任务从暂停恢复。
 */
export interface JobResumedEvent {
printerId: Uuid
bootId: Uuid
seq: number
kind: "job.resumed"
jobRef: Uuid
data?: {

}
}
/**
 * 打印机报告打完。
 */
export interface JobFinishedEvent {
printerId: Uuid
bootId: Uuid
seq: number
kind: "job.finished"
jobRef: Uuid
data?: {

}
}
/**
 * 打印机报告任务失败。
 */
export interface JobFailedEvent {
printerId: Uuid
bootId: Uuid
seq: number
kind: "job.failed"
jobRef: Uuid
data: JobFailedData
}
export interface JobFailedData {
reason: string
/**
 * true = 开打前就失败了
 */
beforeStart: boolean
}
/**
 * 任务被停止。
 */
export interface JobCancelledEvent {
printerId: Uuid
bootId: Uuid
seq: number
kind: "job.cancelled"
jobRef: Uuid
data: JobCancelledData
}
export interface JobCancelledData {
/**
 * UUIDv7
 */
commandId?: string
/**
 * true = 没开打就停下了。订单去向只看这个字段
 */
beforeStart: boolean
}
/**
 * 已跳过的零件变了。
 */
export interface JobPartsSkippedEvent {
printerId: Uuid
bootId: Uuid
seq: number
kind: "job.parts_skipped"
jobRef: Uuid
data: JobPartsSkippedData
}
export interface JobPartsSkippedData {
/**
 * 打印机上报的已跳过零件的完整列表
 */
partIds: number[]
}
/**
 * 打印机开始跑一个不是系统下发的任务。一个已结束任务又跑起来也报成这个。
 */
export interface ExternalStartedEvent {
printerId: Uuid
bootId: Uuid
seq: number
kind: "external.started"
data: ExternalStartedData
}
export interface ExternalStartedData {
name: string
}
/**
 * 外部任务结束。
 */
export interface ExternalEndedEvent {
printerId: Uuid
bootId: Uuid
seq: number
kind: "external.ended"
data: ExternalEndedData
}
export interface ExternalEndedData {
/**
 * FINISHED / FAILED / CANCELLED
 */
result: string
}
/**
 * 打印机出现一条新报错。
 */
export interface ErrorRaisedEvent {
printerId: Uuid
bootId: Uuid
seq: number
kind: "error.raised"
jobRef?: Uuid
data: ErrorRaisedData
}
export interface ErrorRaisedData {
error: ActiveError
}
/**
 * 一条报错消失了。
 */
export interface ErrorClearedEvent {
printerId: Uuid
bootId: Uuid
seq: number
kind: "error.cleared"
jobRef?: Uuid
data: ErrorClearedData
}
export interface ErrorClearedData {
errorId: string
clearedBy: ErrorClearedBy
}
/**
 * 固件自动续料换了槽，只记日志。
 */
export interface FilamentRefilledEvent {
printerId: Uuid
bootId: Uuid
seq: number
kind: "filament.refilled"
jobRef?: Uuid
/**
 * fromSlot、toSlot；具体字段等真机实测后再定
 */
data: {

}
}
/**
 * 延时摄影文件已经生成，等 daemon 上传。
 */
export interface TimelapseReadyEvent {
printerId: Uuid
bootId: Uuid
seq: number
kind: "timelapse.ready"
jobRef: Uuid
data: TimelapseReadyData
}
export interface TimelapseReadyData {
files: TimelapseFile[]
}
export interface TimelapseFile {
name: string
sizeBytes: number
}
/**
 * 整台打印机的完整状态（不是增量），变化时发，同一台最多每秒一次。不确认、不重发，下一份会覆盖它。拿不到的字段省略，不填假值。
 * 
 * This interface was referenced by `DaemonProtocol`'s JSON-Schema
 * via the `definition` "PrinterSnapshot".
 */
export interface PrinterSnapshot {
printerId: Uuid
/**
 * UUIDv7
 */
bootId: string
/**
 * 这台打印机在这次启动里单调递增；面板丢掉比已处理的更旧的快照
 */
seq: number
/**
 * daemon 现在连不连得上这台打印机
 */
connected: boolean
state: NormalizedState
substage?: (Substage | null)
job?: SnapshotJob
/**
 * daemon 手里还没发出开打指令的任务；已经停下、不会再开打的不列。对账靠它认出任务还在进行。
 */
pendingStarts?: PendingStart[]
/**
 * 键如 nozzle1、bed、chamber
 */
temps?: {
[k: string]: Temperature
}
nozzles?: SnapshotNozzle[]
trays?: SnapshotTray[]
bedType?: string
storage?: StorageMedium[]
activeErrors?: ActiveError[]
/**
 * 设定值类控制的当前值，如灯、速度档
 */
controls?: {

}
camera?: CameraCapabilities
/**
 * 适配器给的打印机这次开机的标识，拿不到就省略；只用于显示
 */
deviceBoot?: string
/**
 * daemon 给这台打印机记的运行序号，落盘、只增不减：每看到打印机开始一次运行加一；有一段时间看不到打印机、证明不了它没跑过东西的也加一。只用于开打前检查和确认任务没开打。
 */
runSeq: number
}
export interface PendingStart {
jobRef: Uuid
stage: PendingStartStage
}
export interface Temperature {
current: number
target?: number
}
export interface SnapshotNozzle {
extruder: number
diameterMm: number
flow?: string
}
export interface SnapshotTray {
/**
 * AMS 编号；外挂料 = -1
 */
unit: number
slot: number
label?: string
material?: string
subType?: string
/**
 * #RRGGBB
 */
colour?: string
/**
 * RFID 卷的唯一号，非 RFID 卷省略；面板拿它判断是否换过料
 */
rfidUid?: string
/**
 * 打印机自己估的余量，照传但面板不用来算
 */
remainingPercent?: number
/**
 * 这个料位能供给的挤出机
 */
extruders?: number[]
}
export interface StorageMedium {
/**
 * internal / usb / sdcard 等
 */
medium: string
present: boolean
writable?: boolean
freeBytes?: number
}
export interface CameraCapabilities {
stream: boolean
snapshot: boolean
}
/**
 * 这个 daemon 负责哪些打印机，每次都是完整列表。列表里没有的打印机，daemon 断开它并删掉它的本地状态。
 * 
 * This interface was referenced by `DaemonProtocol`'s JSON-Schema
 * via the `definition` "PrintersAssign".
 */
export interface PrintersAssign {
printers: AssignedPrinter[]
}
/**
 * HTTP 令牌到期前面板换新的。
 * 
 * This interface was referenced by `DaemonProtocol`'s JSON-Schema
 * via the `definition` "TokenRenew".
 */
export interface TokenRenew {
httpToken: string
httpTokenExpiresAt: Timestamp
}
/**
 * daemon 的协议版本太老，面板发完这条就断开。
 * 
 * This interface was referenced by `DaemonProtocol`'s JSON-Schema
 * via the `definition` "UpgradeRequired".
 */
export interface UpgradeRequired {
minProtocolVersion: string
/**
 * 给人执行的升级命令；daemon 只记进日志，不自动升级
 */
upgradeCommand: string
}
/**
 * 认证通过。daemon 用 serverTime 算出和面板的时钟差，之后按面板的时间判断命令是否过期。
 * 
 * This interface was referenced by `DaemonProtocol`'s JSON-Schema
 * via the `definition` "Welcome".
 */
export interface Welcome {
sessionId: Uuid
protocolVersion: string
serverTime?: Timestamp
heartbeatSeconds: number
/**
 * 调 HTTP 接口用的令牌，和这条连接同生共死
 */
httpToken: string
httpTokenExpiresAt: Timestamp
printers: AssignedPrinter[]
config: DaemonConfig
}

/** 消息类型到消息体的对应。 */
export interface DaemonMessageBodies {
  "hello": Hello;
  "challenge": Challenge;
  "auth": Auth;
  "welcome": Welcome;
  "ack": Ack;
  "ping": Ping;
  "pong": Pong;
  "printer.snapshot": PrinterSnapshot;
  "printer.event": PrinterEvent;
  "command.result": CommandResult;
  "discovery.report": DiscoveryReport;
  "printers.assign": PrintersAssign;
  "command": Command;
  "config.update": ConfigUpdate;
  "token.renew": TokenRenew;
  "upgrade_required": UpgradeRequired;
}

export type DaemonMessageType = keyof DaemonMessageBodies;
