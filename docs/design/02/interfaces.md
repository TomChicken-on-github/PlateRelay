# 2.4 · 可插拔接口

> 属于 [文档 2](README.md)。编号 `IF-`。打印机适配器在 daemon 里，用 Python 写；其余在面板里，用 TypeScript 写（Q144）。这里只写接口签名和能力声明，不贴实现。

| 编号 | 接口 | 在哪 | 有几种实现 |
| --- | --- | --- | --- |
| IF-ADP | 打印机适配器 | daemon（Python） | v1 只有拓竹（F-PRT-01）+ 测试用的模拟适配器 |
| IF-STO | 对象存储 | 面板 | 只有 S3 兼容一种（F-OPS-01） |
| IF-PARSE | 文件解析与安全校验 | 面板 worker | `.gcode.3mf` 一种（NG-01） |
| IF-CAP | 人机验证 | 面板 | 默认内置图形验证码（F-ACC-02） |
| IF-SMS | 短信 | 面板 | 只发验证码：注册、找回密码（F-NTF-01） |
| IF-NTF | 通知渠道 | 面板 | 邮件、飞书；站内通知不走插件，必有 |
| IF-OIDC | 外部登录 | 面板 | 通用 OIDC |
| IF-POL | 排队与派单策略 | 面板 | 每个策略一个默认实现（NG-06） |

## 1. 打印机适配器（IF-ADP）

### IF-ADP-01 结构

- 每个品牌一个目录：`platerelay_daemon/adapters/<brand>/`，接口和类型在 `platerelay_daemon/adapter_api/`。适配器跟 daemon 一起安装、一起定版本，v1 不用 entry point（Q251、DAE-ADP-01）。`adapters` 只能 import `adapter_api`，CI 用 import-linter 检查。
- 品牌库的类型（比如 pybambu 的对象）不越过适配器边界（F-PRT-01）：适配器对外只用本节定义的类型。
- 适配器只报"这台打印机现在是什么样"，不认识 `jobRef`；系统任务 / 外部任务的判断、`job.*` 事件的合成、`beforeStart` 都在 daemon 核心（Q258、DAE-ADP-02、DAE-ADP-03）。
- 适配器有"只读模式"：打开时拒绝一切会改变打印机状态的调用，抛 `ControlNotAllowed`。开发和调试默认打开（项目开发规则：除非用户在开发驱动时明确同意，否则不发控制命令）。

### IF-ADP-02 静态描述

适配器按机型声明它能做什么。这份描述是**静态**的：同一个机型、同一个适配器版本，结果不变；不按打印机当前状态变化（文档 0 F-PRT-04）。

```python
class Adapter(Protocol):
    brand: ClassVar[str]                                # "bambu"
    version: ClassVar[str]

    @classmethod
    def describe(cls, model_id: str) -> ModelDescription: ...

@dataclass(frozen=True)
class ModelDescription:
    model_id: str
    model_name: str
    capabilities: Capabilities                           # 驱动草稿 §2
    controls: list[ControlSpec]                          # 设备控制的静态命令清单
    limits: SafetyLimits                                 # 给 IF-PARSE 用的限值（INV-11）

@dataclass(frozen=True)
class ControlSpec:
    action: str                                          # "light.set" / "fan.set" / "temp.set" / "speed.set" /
                                                         # "filament.load" / "filament.unload" / "dry.start" /
                                                         # "dry.stop" / "job.pause" / "job.resume" / "axis.move" / "axis.home"
    category: ControlCategory                            # 面板按类别套通用状态规则（IF-ADP-05）
    args: dict                                           # 参数的 JSON Schema（范围受 limits 约束）
    destructive: bool                                    # 界面上要二次确认

@dataclass(frozen=True)
class SafetyLimits:
    max_nozzle_temp_c: int
    max_bed_temp_c: int
    max_chamber_temp_c: int | None
    build_volume_mm: tuple[float, float, float]
    forbidden_gcodes: list[str]                          # 危险指令，固定拒收（R-SUB-03）
```

能力字段沿用[驱动接口草稿 §2](../../printer-driver-interface-draft.md)，并加上 v1 用到的：`refresh`（能不能主动要一次完整状态）、`discovery`（能不能被动发现）、`skip_parts`、`camera.stream`、`camera.snapshot`、`timelapse`、`bed_type_reported`。

### IF-ADP-03 运行时接口

```python
class PrinterSession(Protocol):
    """一台打印机的一次连接。daemon 为每台分配到的打印机建一个。"""

    async def connect(self, host: str, serial: str, access_code: SecretStr) -> None: ...
    async def close(self) -> None: ...

    def events(self) -> AsyncIterator[DriverEvent]: ...  # 只有设备层面的变化（连接、状态、报错、存储）；
                                                          # job.* 由 daemon 核心比较快照合成（Q258）
    async def snapshot(self) -> DeviceSnapshot: ...       # 合并后的完整状态；daemon 转成 MSG-SNAPSHOT
    async def refresh(self) -> None: ...                  # 只读，拓竹 = pushall（R-PRT-12）

    async def upload(self, local_file: Path, remote_name: str) -> RemoteFile: ...  # FTPS 等；重试由核心管（MSG-CMD-START）
    async def start(self, job: StartJob) -> CommandResult: ...      # 只发开打指令，文件已在打印机上
    async def stop(self) -> CommandResult: ...                      # 停当前任务；核心先确认当前任务就是那个 jobRef（Q258）。
                                                                    # 准备中和打印中都用它；没有单独的撤回（Q203、Q207）
    async def skip_parts(self, part_ids: list[int]) -> CommandResult: ...
    async def resolve_error(self, error_id: str, action: StandardErrorAction) -> CommandResult: ...
    async def control(self, action: str, args: dict) -> CommandResult: ...   # action 必须在 ControlSpec 里

    async def camera_snapshot(self) -> bytes | None: ...  # JPEG
    async def stream_source(self) -> StreamSource | None: ...  # H.264：打印机的 RTSP 地址（daemon 原样转推）；
                                                               # JPEG 帧：一个产出 JPEG 的异步迭代器；不支持：None
    async def storage_status(self) -> list[StorageStatus]: ...

    async def list_files(self) -> list[RemoteFile]: ...   # 存储里的文件；对清单是核心的事（MSG-JOBREF-02）
    async def list_timelapses(self) -> list[RemoteFile]: ...
    async def fetch(self, file: RemoteFile) -> Path: ...
    async def delete(self, file: RemoteFile) -> CommandResult: ...  # 只能删 daemon 清单里的（INV-15）

class Discovery(Protocol):
    """被动监听局域网广播，只听不发（F-PRT-12）。"""
    def listen(self) -> AsyncIterator[DiscoveredPrinter]: ...
```

`StartJob = { remote_file, task_name, plate_index, bed_type, mapping, timelapse }`，`remote_file` 和 `task_name` 由核心按 MSG-JOBREF-01 起名（`pr-<jobRef 后 12 位>`），适配器不认识 `jobRef`（Q258）。适配器负责把 `mapping` 翻译成品牌自己的格式（拓竹是 `ams_mapping`），不改切片里定好的挤出机分配（R-DSP-11）。

### IF-ADP-04 标准状态到面板状态

适配器报标准状态（驱动草稿 §3.1），面板换算成打印机状态（文档 1 §4）。换算只在面板做，适配器不知道面板状态。

| 标准状态 | 面板 |
| --- | --- |
| `OFFLINE` | 挂异常原因 `OFFLINE`，不论原来在什么状态（Q399） |
| `NOT_READY`、`BUSY` | 不改状态，显示原因"打印机忙"；可用时派单拒绝（Q184、P-05） |
| `IDLE` | 不改状态；工作（外部）时 → 待清板（S-PRN-T21） |
| `PREPARING`、`PRINTING` | 我们的任务：任务阶段准备中 / 打印中（§4A），打印机仍是工作。别人的：外部任务（R-PRT-11） |
| `PAUSED` | 任务阶段暂停中，原因 `USER`；打印机仍是工作 |
| `ERROR_PAUSED` | 任务阶段暂停中，原因 `ERROR` 或 `RUNOUT`；挂异常原因 `ERROR` |
| `FINISHED`、`FAILED`、`CANCELLED` | 只在**进入**这个状态时（上一次报的不是它）结束任务 → 待清板（INV-01），订单按事件走。拓竹打完后一直停在 FINISH，清完板也不变，所以停留在这个状态不算新事件；清板后不会被它拉回待清板 |
| `FAULT` | 挂异常原因 `ERROR`；订单不自动判失败（P-03），等打印机确认或人判 |
| `UNKNOWN` | 不改状态，记日志 |

准备中、打印中、暂停中、子阶段都只是任务进度，第二稿不再是打印机状态（文档 1 §4，Q396）。

### IF-ADP-05 设备控制的通用状态规则

面板只按控制的**类别**和打印机**当前状态**决定按钮能不能点；适配器只说"这个机型有哪些命令"（F-PRT-04）。固件拒绝时把原话显示出来（R-PRT-15）。

下表的"状态"都是打印机**上报的**状态（IF-ADP-04 左列），不是面板的四个状态。系统任务和外部任务一样，面板的状态是工作还是异常也一样（Q377、Q396）。

| 类别 | 允许的上报状态（Q185） |
| --- | --- |
| `light` | 联系得上就行 |
| `temperature`、`fan` | 联系得上就行（R-ARB-08：有任务时也能调温度） |
| `speed` | 打印中、暂停中 |
| `stop` | 准备中、打印中、暂停中（要二次确认，F-PRT-05）；外部任务不带任务 ID（Q326） |
| `pause` | 打印中；准备中（打印机报了准备中之后，传文件期间不行，Q310） |
| `resume` | 暂停中且原因是 `USER`（准备阶段的暂停也算，Q240、Q310）；恢复后准备阶段回准备中，不提前算开打；报错和断料的继续走"处理报错"（R-PRT-14） |
| `filament`、`dry` | 没在跑任务（空闲、停在打完 / 失败 / 已取消） |
| `motion`（移轴、回零） | 没在跑任务（R-ARB-07） |
| `auto_refill`（自动续料开关，设定值命令） | 联系得上就行（待 Q404–Q408 定，驱动实测后再写字段） |

联系不上时所有命令都发不出去，全部置灰。按钮只看打印机**上报的**状态，不看"预计会变成"的状态，也没有命令锁（INV-16，Q243）：这张表就是所有机型共用的那一张。点完按钮转圈，直到上报状态变了或最多 10 秒（前端常量，R-CMD-01）。

### IF-ADP-06 对照 Moonraker（F-PRT-02）

| 接口 | Moonraker 对应 | 结论 |
| --- | --- | --- |
| `connect` / `events` / `snapshot` | WebSocket `printer.objects.subscribe` | 必需 |
| `refresh` | `printer.objects.query` | 必需 |
| `start` | `server.files.upload` + `printer.print.start` | 必需 |
| `stop` | `printer.print.cancel` | 必需 |
| `skip_parts` | `EXCLUDE_OBJECT` 宏（需要 `[exclude_object]`） | 可选能力 |
| `resolve_error` | 只有通用选项（驱动草稿 §6.4） | `errorActions: "generic"` |
| `control` | `printer.gcode.script`（限白名单内的 G-code） | 可选，命令清单按机器配置声明 |
| `camera_*` | 摄像头不归 Klipper 管，读 `server.webcams.list` 拿地址 | 可选能力 |
| `list/fetch/delete` 延时摄影 | moonraker-timelapse 插件 | 可选能力 |
| `Discovery` | 没有统一的广播，可用 mDNS | 可选能力；不支持就只能手填 IP |
| 料位（`trays`） | 没有统一的多色系统 | `materialSystem: "single"` 或插件 |

结论：接口里没有只适用于拓竹的必需方法。拓竹特有的（AMS、HMS、`pushall`）都在能力声明或适配器内部（P-07）。

### IF-ADP-07 错误分类

适配器调用失败时抛的异常，沿用驱动草稿 §7 的五类：`transient`、`needs_human`、`fatal_config`、`unsupported`、`machine_fault`。daemon 把它们翻成 `command.result` 的 `failed` / `rejected` 和 `code`。

### IF-ADP-08 测试

- `adapters/fake` 是一台带完整状态机的模拟打印机，能注入报错、断料、断线、重启、固件拒绝、传输中断，用来测控制类流程（DAE-TST-01，Q260）。
- 品牌适配器另用录下来的真机消息回放，测状态换算（MSG-SCH-04、DAE-TST-02）。
- 一致性测试套件对所有适配器跑同一组用例：状态换算、事件顺序、白名单拒绝、只读模式拒绝、文件清单只删自己的。

## 2. 对象存储（IF-STO）

```ts
interface ObjectStore {
  put(key: string, body: Readable, opts: { contentType: string; sizeBytes: number; sha256: string }): Promise<void>;
  head(key: string): Promise<{ sizeBytes: number; sha256?: string } | null>;
  get(key: string): Promise<Readable>;
  signedGetUrl(key: string, opts: { ttlSeconds: number; downloadName?: string }): Promise<string>;
  delete(key: string): Promise<void>;
}
```

- `put` 时核对大小和 SHA-256，对不上就删掉并报错（F-PRT-10 的核对靠它）。
- 对象键的布局：

| 前缀 | 内容 | 什么时候删 |
| --- | --- | --- |
| `files/{fileId}` | 上传的 `.gcode.3mf` | R-SUB-10、R-FIL-01 |
| `previews/{versionId}/` | 缩略图、零件图 | 永久（R-FIL-01） |
| `store-photos/{orderId}/` | 入库照片 | 永久保留（Q183） |
| `end-photos/{jobId}.jpg` | 结束照片（R-CAM-11） | 永久保留（Q217） |
| `timelapses/{jobId}/{part}` | 延时摄影 | CFG-FIL-02 |
| `avatars/{userId}` | 头像 | 换头像时 |
| `exports/{archiveId}.zip` | 归档导出 | 管理员手动删 |

## 3. 文件解析与安全校验（IF-PARSE）

```ts
interface FileParser {
  readonly version: string;                                     // 写进 E-CHK.parser_version
  parse(file: Readable): Promise<ParsedUpload>;                 // 解出每一盘的元数据和零件
}

interface SafetyCheck {
  readonly id: "structure" | "consistency" | "bounds" | "dangerous";   // F-SUB-02 的四项
  readonly configurable: boolean;                                // structure、dangerous 为 false（R-SUB-03）
  run(upload: ParsedUpload, limits: SafetyLimits): Promise<Finding[]>;
}

type Finding = { check: SafetyCheck["id"]; code: string; plate?: number; detail: Record<string, unknown> };
```

- 跑在 worker 线程池里，不阻塞请求（F-SUB-02）。
- 限值 = 适配器的 `SafetyLimits`，再用系统设置收紧（只能更严，F-SUB-03）。一个文件对应多个开放机型时，按文件里写的机型取限值。
- 每条 `Finding` 的严重程度按 CFG-SUB-01 算：拒收 / 警告 / 忽略。`structure`、`dangerous` 固定拒收。
- 派单时用同一套检查、按当前限值对这台打印机再跑一次（R-DSP-04）。
- 解析加固（Q327）：
  - 流式读压缩包，不解压到磁盘。
  - 条目路径白名单：只认 `Metadata/`、`3D/`、`[Content_Types].xml`、`_rels/` 等已知位置，含 `..`、绝对路径、符号链接的条目算结构损坏。
  - 设上限：单个条目和解压总量的大小、压缩比（防压缩炸弹），超了算结构损坏。上限是代码常量，不做参数。
  - G-code 先规范化再检查：指令转大写、去掉行内注释（`;` 之后）、去前导零（`M0104` → `M104`）、合并空白。
  - 危险指令仍用适配器给的黑名单（`forbidden_gcodes`），匹配在规范化之后做。不改白名单：拓竹 G-code 里大量专有 M 码，白名单会让几乎每个文件都报警。

## 4. 人机验证（IF-CAP）

```ts
interface CaptchaProvider {
  readonly id: string;                                          // "builtin-image"
  issue(): Promise<{ challengeId: string; payload: unknown }>;  // 内置：返回 PNG 的 base64
  verify(challengeId: string, answer: string, ctx: { ip: string }): Promise<boolean>;
}
```

一次挑战只能验一次，5 分钟过期。发短信或邮件验证码之前必须先过（R-ACC-02）。

## 5. 短信（IF-SMS）

```ts
interface SmsProvider {
  readonly id: string;
  send(phoneE164: string, code: string, purpose: "REGISTER" | "RESET_PASSWORD", locale: string): Promise<void>;
}
```

只发验证码（注册、找回密码），不发通知（F-NTF-01）。服务商的密钥从环境变量读（INV-07）。

## 6. 通知渠道（IF-NTF）

```ts
interface NotificationChannel {
  readonly id: "EMAIL" | "FEISHU";
  configured(): boolean;                                        // 没配置（如没填 SMTP）就不出现在个人设置里
  send(to: Recipient, event: NotificationEvent, data: object, locale: string): Promise<void>;
}
```

- 站内通知不走这个接口，直接写 E-NTF，一定发（R-NTF-01）。
- 发送失败记在 E-NDLV，退避重试；渠道失败不影响业务事务（通知在事务提交后发）。
- 文案按事件和语言查模板，模板在代码里，和 i18n 一起维护。

## 7. 外部登录（IF-OIDC）

只做通用 OIDC（授权码 + PKCE）。每个提供方的配置：`id`、`displayName`、`issuer`、`clientId`、`clientSecret`（环境变量）、`scopes`、是否允许用它注册新账户。按 `issuer + subject` 绑定账户（E-EXTID），不按邮箱自动合并。

## 8. 排队与派单策略（IF-POL）

规则只是参数 + 策略接口，不做规则引擎（NG-06）。每个策略都是**纯函数**：同样的输入一定得到同样的输出（R-DSP-10），不读数据库、不读时钟，方便按规则编号写表格测试。

```ts
interface RevisionPolicy {
  /** R-VER-07、R-VER-10：新版本相对上一个通过的版本要后退几位；-1 = 排到队尾，0 = 不动。 */
  placesBack(input: { prevApprovedSeconds: number; newSeconds: number; modelSwitch: boolean;
                      cfg: RevisionSettings }): number;
}

interface QueueMover {
  /** R-VER-12：从当前位置往后数 N 个有排序值的订单（冻结的也算），返回新的排序值。 */
  moveBack(queue: QueueEntry[], orderId: string, places: number): bigint;
}

interface DispatchSuggester {
  /** R-DSP-01：可用最久的打印机先挑，一台一单。 */
  suggest(input: { queue: QueueEntry[]; printers: PrinterAvailability[] }): Suggestion[];
}

interface MappingSuggester {
  /** R-DSP-05、R-DSP-06、R-DSP-07、R-DSP-10–R-DSP-12。 */
  suggest(input: { filaments: SliceFilament[]; trays: Tray[]; nozzles: Nozzle[];
                   colourPref: ColourPref; cfg: MappingSettings }): MappingProposal;
  /** 人工改过之后重新校验，返回每一项的检查结果。 */
  validate(input: { mapping: MappingEntry[]; filaments: SliceFilament[]; trays: Tray[];
                    nozzles: Nozzle[]; colourPref: ColourPref; cfg: MappingSettings }): MappingCheck[];
}

interface WaitEstimator {
  /** R-QUE-04：只给区间。 */
  estimate(input: { position: number; queue: QueueEntry[]; printers: PrinterAvailability[] }): { minSeconds: number; maxSeconds: number } | null;
}
```

- 颜色比较用 CIEDE2000（CFG-MAP-03、CFG-MAP-04）。
- 每个策略的测试用例按文档 1 的规则编号命名，比如 `R-VER-07: 变短不前进`。
