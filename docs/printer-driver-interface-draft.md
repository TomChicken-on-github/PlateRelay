# 打印机 Driver 抽象层 · 接口草稿 v0.5

> 除标 **【已定】** 的条目外，设计内容均为 **【建议】**，尚未经用户确认。§1–§8 的类型用 TypeScript 风格表述，仅作示意；实现语言已定为 Python，见 §9。
>
> **v0.5 改动**：①【已定】存储按机型声明，新增能力 `storage` 和遥测 `StorageStatus`（来自 X2D 只读探测）；②【已定】摄像头画面对选手公开，改写 §10.1；③ §11 加一条存储实测项。
>
> **v0.4 改动**：①【已定】多喷嘴机器要支持（撤回 v0.3 的"不考虑"）；②【已定】一个订单一盘，多盘文件自动拆单，`start` 命令要能指定板号；③【已定】延时摄影要保存并绑定订单，查看要有权限节点（新增 §10.4）。
>
> **v0.3 改动**：①【已定】每个品牌的 driver 做成独立模块，用 Python 实现（新增 §9）；②【已定】摄像头抓拍和视频流都要（新增 §10）。
>
> **v0.2 改动**：①原始状态映射改为对照来源核实；②标准设备状态从 6 个扩到 13 个，并加 `substage` 细分；③新增"报错处理"模型，面板可按报错展示若干处理选项。
>
> **来源可信度标注**
> - **【官方】** 厂商 / 项目官方文档或官方源码
> - **【社区】** 社区逆向整理
> - **【推断】** 我根据来源推出来的，**需在真机上实测**

---

## 0. 关于来源（先说清楚）

- **拓竹没有公开的官方 MQTT 协议文档。** 我能找到的最接近"官方"的依据，是拓竹自己开源的 **Bambu Studio 源码**（`DeviceManager.cpp`、`DeviceErrorDialog.cpp/.hpp`、`HMS.cpp`），它就是官方客户端跟打印机通信的实现。其次是社区整理：Home Assistant 的 ha-bambulab 集成（`pybambu/const.py`）、OpenBambuAPI（内容较少，大部分标着 TODO）。
- **Klipper / Moonraker 有官方文档**，下面的状态值都直接来自官方文档。
- 源码看的是 Bambu Studio `master` 分支的当前版本。**P1 系列固件是否支持其中每一条命令，源码看不出来**，务必实测。

---

## 1. 设计原则（同 v0）

1. driver 只描述设备现实，不知道订单、用户、清板、取件。
2. 能力声明，而不是最小公分母；上层按能力降级。
3. 事件向上、命令向下；命令被受理不等于状态已变化，以后续事件为准。
4. 状态归一成自己的枚举，同时保留原始数据。
5. 命令幂等（`commandId`），事件可排序、可重放（`seq`、`ts`）。
6. 设备凭据只在 daemon 一侧。

---

## 2. 设备信息与能力清单

```ts
interface DeviceInfo {
  printerId: string;
  brand: string;              // "bambu" / "klipper" / ...
  model: string;              // 用于切片产物的兼容性匹配
  nozzles: { index: number; diameterMm: number; material?: string }[];  // 【已定】要支持多喷嘴
  bedSizeMm?: { x: number; y: number; z: number };
  supportedMaterials?: string[];
}

interface Capabilities {
  remoteStart: boolean;
  pause: boolean;
  resume: boolean;
  cancel: boolean;
  emergencyStop: boolean;
  firmwareRestart: boolean;

  fileUpload: boolean;
  acceptedFileFormats: string[];   // 如 ["gcode.3mf"]
  fileBoundToModel: boolean;

  telemetry: { progress: boolean; remainingTime: boolean; temperatures: boolean; layer: boolean };
  substageDetail: boolean;         // 能否给出准备阶段的细分（拓竹 stg_cur 可以）
  detectsExternalJobs: boolean;
  camera: {
    snapshot: "native" | "from-stream" | "none";   // from-stream = 从视频流里截一帧
    stream: "none" | "rtsp" | "mjpeg" | "jpeg-frames" | "other";
    maxConcurrentStreams?: number;                 // 设备允许同时拉几路流（见 §10）
    timelapse: "none" | "on-device" | "assembled-by-daemon";
    // on-device = 打印机自己录、存在本机存储里，事后取回（拓竹）
    // assembled-by-daemon = 设备不录，由 daemon 定时抓拍后自己合成
  };
  materialSystem: "none" | "single" | "multi-slot";

  // 【已定】存储按机型声明（X2D 只读探测：X2D 有内置存储 + U 盘；P1 无内置存储，只有 SD 卡）
  storage: {
    internal: boolean;                       // X2D: true；P1: false
    removable: ("sd" | "usb")[];             // X2D: ["usb"]；P1: ["sd"]
    requiredForJobs: boolean;                // 没有可写介质时能否接任务（P1: 必须有卡）
    requiredForTimelapse: boolean;           // 延时摄影是否必须写到介质上
  };

  // 报错处理
  errorActions: "none" | "generic" | "per-error";
  // generic: 只有通用的 继续/停止/确认
  // per-error: 每种报错有自己的可选项（拓竹）

  requirements: string[];          // 如 ["lan-only", "developer-mode"]
}

canAccept(jobMeta: JobMeta): { ok: boolean; reasons: string[] }
// reasons 里要包含存储原因，如 "no-writable-storage"（P1 没插卡）
```

存储的实时状态【建议】：能力清单只说"这台机型有哪些存储"，介质**当前在不在、能不能写、还剩多少空间**要放进遥测里随状态上报：

```ts
interface StorageStatus {
  medium: "internal" | "sd" | "usb";
  present: boolean;
  writable: boolean;          // 只读、写保护或异常时为 false
  freeBytes?: number;         // 拿得到才报
}
```

---

## 3. 标准设备状态（扩展版）

### 3.1 主状态

```ts
type NormalizedState =
  | "OFFLINE"        // 连不上
  | "NOT_READY"      // 连上了但设备没就绪（启动中、固件升级中等）
  | "IDLE"           // 空闲，可接任务
  | "BUSY"           // 非打印类占用：手动校准、进退料、维护操作
  | "PREPARING"      // 任务已开始，但还没正式打印：加热、调平、回零、校准……
  | "PRINTING"       // 正在打印（含打印中换料）
  | "PAUSED"         // 正常暂停：人工暂停、G-code 里写的暂停
  | "ERROR_PAUSED"   // 因报错暂停，任务还活着，等人决定怎么处理
  | "FINISHED"       // 上一个任务成功完成
  | "FAILED"         // 上一个任务失败（拓竹里人工停止也会落到这里，见 §5.1）
  | "CANCELLED"      // 上一个任务被取消（仅能区分的品牌会报）
  | "FAULT"          // 机器级故障，任务已丢，需要重启或现场处理
  | "UNKNOWN";
```

**和 v0 的差别**
- `PAUSED_ERROR` 拆成 `PAUSED`（正常暂停）和 `ERROR_PAUSED`（报错暂停）：前者谁暂停谁继续即可，后者要走 §6 的报错处理流程。
- 新增 `FINISHED / FAILED / CANCELLED`：拓竹和 Klipper 的打印机在任务结束后，**都会停在"已完成/已失败"这类状态，直到下一个任务开始**（Klipper 官方文档写的是"上一个任务……"；拓竹【推断】，需实测）。所以 driver 如实报这些终态，比 v0 里"回到 IDLE 再发事件"更贴近现实。
- 新增 `NOT_READY / BUSY / FAULT`，让调度器知道"连得上但不能派单"的几种情况。

### 3.2 子阶段 `substage`

```ts
interface DeviceStatus {
  state: NormalizedState;
  substage?: Substage;     // 归一后的子阶段
  rawSubstage?: string;    // 厂商原始值，例如拓竹的 stg_cur 数字
  raw: unknown;
}

type Substage =
  | "heating_bed" | "heating_nozzle" | "heating_chamber" | "cooling"
  | "homing" | "leveling" | "calibrating" | "cleaning_nozzle"
  | "inspecting_first_layer" | "identifying_plate"
  | "changing_filament" | "loading_filament" | "unloading_filament"
  | "other";
```

子阶段只用于展示（"正在调平"）和时长估算，**调度器只看主状态**。

### 3.3 和业务层的关系

| driver 主状态 | 业务层处理 |
|---|---|
| `FINISHED` / `FAILED` / `CANCELLED` | 设备立刻进入 `CLEARING_REQUIRED`；**人工确认清板才能放行**，不能因为设备自己离开终态就放行 |
| `ERROR_PAUSED` | 进入报错处理流程（§6），通知运维 |
| `FAULT` | 标记故障；当前订单进入 `FAILED`，归因默认"机器故障" |
| `PREPARING` / `PRINTING` 但任务标识对不上 | 判定 `UNMANAGED_PRINTING` |
| `OFFLINE` / `NOT_READY` / `BUSY` | 不可派单 |

`CLEARING_REQUIRED`、`UNMANAGED_PRINTING`、`MAINTENANCE/DISABLED` 仍然只属于业务层。

---

## 4. 原始状态映射

### 4.1 拓竹

拓竹的状态主要看两个字段：任务状态 `gcode_state`（字符串），和当前阶段 `stg_cur`（数字）。另有报错字段 `print_error`、`hms`，见 §6。

**`gcode_state` 的取值**
- Bambu Studio 源码里直接比较的值：`IDLE`、`PREPARE`、`SLICING`、`RUNNING`、`PAUSE`、`FINISH`、`FAILED`。其中 `PAUSE / RUNNING / SLICING / PREPARE` 被视为"正在打印中"，`FINISH / FAILED` 被视为结束态。【官方源码】
- ha-bambulab 另外列了 `INIT`、`OFFLINE`、`UNKNOWN`。【社区】（`OFFLINE`、`UNKNOWN` 看起来是集成自己补的状态，不一定是打印机发的。）

**`stg_cur` 的取值**（来自 ha-bambulab 的 `CURRENT_STAGE_IDS`，共 80 项左右）【社区】
- 空闲：X1 发 `-1`，P1 发 `255`；`0` 是正在打印。
- 本文只把与调度相关的分组列出来，完整列表见 `pybambu/const.py`。

**映射表**【推断，需实测】

| `gcode_state` | `stg_cur` 条件 | → 主状态 | → substage |
|---|---|---|---|
| `IDLE` | — | `IDLE` | — |
| `INIT` | — | `NOT_READY` | — |
| `PREPARE` / `SLICING` | — | `PREPARING` | 按 `stg_cur` |
| `RUNNING` | `0` | `PRINTING` | — |
| `RUNNING` | 4 / 22 / 24（换料、退料、进料） | `PRINTING` | `changing_filament` 等 |
| `RUNNING` | 其他准备类阶段（见下表） | `PREPARING` | 按下表 |
| `PAUSE` | 16 / 30 / 5（人工暂停、G-code 暂停、M400 暂停） | `PAUSED` | — |
| `PAUSE` | 报错类阶段（见下表），或 `print_error ≠ 0` | `ERROR_PAUSED` | — |
| `FINISH` | — | `FINISHED` | — |
| `FAILED` | — | `FAILED` | — |
| 连接断开 / 心跳超时 | — | `OFFLINE` | — |
| 无法识别 | — | `UNKNOWN` | 保留原值 |

> `RUNNING` 时 `stg_cur` 还在报加热、调平，说明是"任务已开始、还没正式挤出"——这是我根据阶段名推的，**需实测确认**。

**`stg_cur` 分组**【社区数据 + 推断的分组】

| 分组 | 代表值（编号: 名称） | 归一 |
|---|---|---|
| 报错暂停 | 6 断料、17 前盖掉落、20 喷嘴温度异常、21 热床温度异常、23 丢步、26 AMS 丢失、27 热端散热风扇转速低、28 腔温控制异常、32 喷嘴被耗材包裹、33 切刀异常、34 首层异常、35 喷嘴堵塞 | `ERROR_PAUSED` |
| 正常暂停 | 5 M400 暂停、16 用户暂停、30 用户 G-code 暂停 | `PAUSED` |
| 加热 / 冷却 | 2 热床预热、7 热端加热、29 腔体冷却、49 腔体加热、50 热床冷却、54 等待热床温度、69 喷嘴冷却 | `heating_*` / `cooling` |
| 调平 / 回零 | 1 自动调平、13 工具头回零、40 高温调平、47/48 调平阶段 1/2 | `leveling` / `homing` |
| 校准 | 3 振动补偿、8 挤出校准、12/18 激光雷达校准、19 流量校准、25 电机噪声校准等 | `calibrating` |
| 检查 | 9 扫描床面、10 首层检测、11 识别打印板类型、14 清洁喷嘴 | 对应 substage |
| 换料 | 4 换料、22 退料、24 进料 | `*_filament` |

新机型的阶段编号一直在增加（列表里到 77 了，有些属于 H2D、激光模组等新硬件）。**未知编号一律归 `other`，不要因此报错。**

### 4.2 Klipper / Moonraker【官方】

Klipper 的状态分三层：

1. **`webhooks.state`**（Klippy 主机状态）：取值为 `ready`、`startup`、`shutdown`、`error`。
2. **`print_stats.state`**（任务状态）：`standby`（等待任务开始）、`printing`、`paused`、`complete`（上一个任务成功完成）、`error`（上一个任务以错误退出）、`cancelled`（上一个任务被用户取消）。
3. **`idle_timeout.state`**（忙闲）：取值为 `Idle`、`Printing`、`Ready`，其中 `Printing` 表示打印机正忙。

另外，`pause_resume.is_paused` 在执行过 `PAUSE` 但没有对应 `RESUME` 时为真；断料传感器 `filament_switch_sensor` 有 `enabled` 和 `filament_detected` 两个字段。

**映射表**

| 条件 | → 主状态 |
|---|---|
| 连不上 Moonraker | `OFFLINE` |
| `webhooks.state = startup` | `NOT_READY` |
| `webhooks.state = shutdown` 或 `error` | `FAULT` |
| `ready` 且 `print_stats = standby`，`idle_timeout ≠ Printing` | `IDLE` |
| `ready` 且 `print_stats = standby`，`idle_timeout = Printing` | `BUSY`（在跑非打印的宏或手动操作）【推断】 |
| `print_stats = printing` | `PRINTING`（Klipper 原生不区分准备阶段，见下） |
| `print_stats = paused`，断料传感器启用且未检测到耗材 | `ERROR_PAUSED`【推断】 |
| `print_stats = paused`，其他 | `PAUSED` |
| `print_stats = complete` | `FINISHED` |
| `print_stats = cancelled` | `CANCELLED` |
| `print_stats = error` | `FAILED` |

> Klipper 的加热、调平都写在开始打印的 G-code 宏里，`print_stats` 一律报 `printing`。要识别 `PREPARING`，只能用"目标温度未达到"或"尚未打印第一层"之类的启发式【推断】。所以 Klipper driver 的 `substageDetail` 应声明为 `false`，上层不要依赖。

---

## 5. 标准事件与命令

### 5.1 事件（driver → daemon）

```ts
type DriverEvent =
  | { type: "connection"; state: "connected" | "disconnected"; reason?: string }
  | { type: "status"; status: DeviceStatus }
  | { type: "progress"; percent?: number; remainingSec?: number; layer?: number;
      temps?: Record<string, number> }
  | { type: "job"; phase: "started" | "finished" | "failed" | "cancelled";
      jobRef: string; reason?: string }
  | { type: "error_raised"; error: ActiveError }     // 见 §6
  | { type: "error_cleared"; errorId: string;
      clearedBy: "panel" | "device" | "unknown" }     // device = 有人在打印机屏幕上点掉了
  | { type: "alert"; severity: "info" | "warn"; code: string; message: string };
// 每个事件都带 printerId、seq（单台设备内单调递增）、ts
```

**拓竹"取消"的问题**：拓竹的任务被停止后落到 `FAILED`，打印机侧本身不区分"失败"和"被人停止"【推断，需实测】。所以拓竹 driver 应该记下自己下发过的 `stop` 命令，在停止后的 `FAILED` 上补报 `job.cancelled`。由打印机屏幕上直接停止的，就区分不了，只能报 `failed`。

### 5.2 命令（daemon → driver）

```ts
interface PrinterDriver {
  info(): DeviceInfo;
  capabilities(): Capabilities;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  snapshot(): Promise<DeviceSnapshot>;          // 对账用：状态 + 当前活动报错

  stage(file: FileRef, opts?: StageOptions): Promise<StagedFile>;
  start(cmd: { commandId: string; staged: StagedFile; jobRef: string;
               plateIndex: number;          // 【已定】一单一盘：多盘文件拆成多张独立订单，每张只打自己那一盘
               materialMapping?: unknown;
               timelapse: boolean }): Promise<CommandResult>;
  pause(commandId: string): Promise<CommandResult>;
  resume(commandId: string): Promise<CommandResult>;
  cancel(commandId: string): Promise<CommandResult>;

  // 延时摄影（见 §10.4）
  listTimelapses?(): Promise<TimelapseFile[]>;            // 列出设备存储里的延时摄影文件
  fetchTimelapse?(file: TimelapseFile): Promise<LocalPath>;
  deleteTimelapse?(file: TimelapseFile): Promise<CommandResult>;

  emergencyStop?(commandId: string): Promise<CommandResult>;
  firmwareRestart?(commandId: string): Promise<CommandResult>;

  resolveError(cmd: { commandId: string; errorId: string;
                      action: StandardErrorAction }): Promise<CommandResult>;   // 见 §6

  cameraSnapshot?(): Promise<ImageData>;          // 见 §10
  openCameraStream?(): Promise<CameraStream>;     // 见 §10，返回原始流句柄，由 daemon 的媒体层接管
  subscribe(handler: (e: DriverEvent) => void): Unsubscribe;
}
```

---

## 6. 报错处理（新增）

### 6.1 思路

打印机报错时，**driver 把"当前报错 + 这条报错允许的处理选项"一起报上来**，面板把选项渲染成按钮，运维点哪个，面板就调 `resolveError`。这是照着拓竹官方客户端的做法来的：Bambu Studio 的报错弹窗，会根据每个报错码去查一份"报错 → 可选按钮"的对照表，只显示对应的按钮。

### 6.2 数据结构

```ts
interface ActiveError {
  errorId: string;            // 本次报错的唯一 ID（driver 生成）
  vendorCode: string;         // 厂商原始码，如拓竹 print_error 的 8 位十六进制
  channel: string;            // "print_error" | "hms" | "klippy" | ...
  severity: "fatal" | "error" | "warning" | "info";
  module?: string;            // 如 "ams" / "toolhead" / "mainboard"
  message?: string;           // 有本地化文案就带上
  helpUrl?: string;           // 厂商的报错说明页
  blocksJob: boolean;         // 是否卡住了当前任务
  actions: ErrorActionOption[];
  raisedAt: number;
}

interface ErrorActionOption {
  action: StandardErrorAction;
  vendorActionId?: string | number;   // 厂商原始按钮 ID，排查用
  label: string;
  requiresOnSite: boolean;    // 必须有人在机器旁处理过才能点（如"问题已解决，继续"）
  destructive: boolean;       // 会终止任务（如停止打印）
}

type StandardErrorAction =
  | "RESUME"                  // 继续打印
  | "RESUME_ACCEPT_DEFECTS"   // 接受瑕疵，继续
  | "RESUME_PROBLEM_SOLVED"   // 现场已处理，继续
  | "RETRY"                   // 重试刚才失败的动作（如进料）
  | "CONFIRM_DONE"            // 确认某个动作已完成（如"耗材已挤出，继续"）
  | "IGNORE"                  // 忽略本次并继续
  | "IGNORE_PERMANENTLY"      // 以后不再提醒这类报错
  | "ACKNOWLEDGE"             // 确认 / 关闭提示，不改变任务
  | "STOP"                    // 停止打印
  | "ABORT_OPERATION"         // 中止当前的子操作（如 AMS 操作），不一定停打印
  | "SILENCE_ALARM"           // 关蜂鸣器 / 火警提示
  | "RECHECK"                 // 让设备重新检测
  | "FIRMWARE_RESTART"        // 机器级故障后重启固件
  | "EMERGENCY_STOP";         // 急停
```

### 6.3 拓竹的选项与命令对照【官方源码】

Bambu Studio 的报错弹窗里定义了一组按钮，每个按钮对应一条 MQTT 命令。下面是**与面板处理相关**的部分（省略了"查看帮助""查看直播画面"这类纯界面按钮）：

| Studio 按钮（ID） | 界面文案 | 发出的命令 | → 标准动作 |
|---|---|---|---|
| 2 / 3 / 4 | Resume Printing / Resume (defects acceptable) / Resume (problem solved) | `print.command = "resume"`，带 `err`、`job_id`、`param: "reserve"` | `RESUME` / `RESUME_ACCEPT_DEFECTS` / `RESUME_PROBLEM_SOLVED` |
| 12、28 | Filament Loaded, Resume / Problem Solved and Resume | 同上 `resume` | `RESUME_PROBLEM_SOLVED` |
| 5 | Stop Printing | `print.command = "stop"`，带 `err`、`job_id` | `STOP` |
| 7 | Filament Extruded, Continue | `ams_control`，`param: "done"` | `CONFIRM_DONE` |
| 8、9、34 | Not Extruded Yet, Retry / Finished, Continue / Retry (problem solved) | `ams_control`，`param: "resume"` | `RETRY` |
| 51 | Abort | `ams_control`，`param: "abort"` | `ABORT_OPERATION` |
| 27 | Ignore this and Resume | `print.command = "ignore"`，带 `err`、`job_id` | `IGNORE` |
| 25 | Ignore. Don't Remind Next Time | 同上 `ignore` | `IGNORE_PERMANENTLY` |
| 23 | No Reminder Next Time | `print.command = "idle_ignore"`，带 `err`、`type` | `IGNORE_PERMANENTLY` |
| 11 | OK | `print.command = "clean_print_error"`，带 `subtask_id`、`print_error` | `ACKNOWLEDGE` |
| 29 | Got it, Turn off the Fire Alarm | `print.command = "buzzer_ctrl"`，`mode: 0` | `SILENCE_ALARM` |
| 24 | Recheck | 刷新喷嘴信息的命令 | `RECHECK` |

`ams_control` 的合法参数，源码里限定为 `resume`、`reset`、`pause`、`done`、`abort` 五种。

**拓竹的几个要点**
- **两条报错通道**：`print_error` 是"当前卡住任务、会弹窗"的那一条（一个整数）；`hms` 是一组持续存在的健康告警（每项有 `attr` 和 `code`）。driver 两者都要报，但通常只有 `print_error` 需要人决策。
- **报错级别**：Bambu Studio 从报错码的第 13–16 位取级别，`0x4` 是错误、`0x8` 是警告、`0xC` 是提示。【官方源码】HMS 的严重程度，社区整理为 1 致命、2 严重、3 普通、4 提示。【社区】
- **"每个报错有哪些按钮"不在打印机里**，而在拓竹服务器上的一份对照文件里：Bambu Studio 按机型下载 `hms_action_<机型>.json`，里面每条记录是"报错码 → 按钮 ID 列表"。【官方源码】
  - **对你的影响**：场地如果断外网、打印机走纯局域网，这份文件要**活动前提前下载好，随 daemon 一起分发**；
  - 查不到某个报错码时，**兜底选项建议只给 `ACKNOWLEDGE` 和 `STOP`**，`gcode_state = PAUSE` 时再加 `RESUME`。宁可少给，不要给出机器不支持的按钮。
- **P1 系列的兼容性未知**：`ignore`、`idle_ignore` 这些命令在源码里存在，但哪些固件、哪些机型支持，源码看不出来。**列为第一批实测项。**

### 6.4 Klipper 的选项【官方】

Klipper 没有逐报错的选项表，按状态给通用选项（`errorActions: "generic"`）。对应的 Moonraker 接口：

| 场景 | 可选动作 | Moonraker 接口 |
|---|---|---|
| `paused`（含断料） | `RESUME` / `STOP` | `POST /printer/print/resume`、`POST /printer/print/cancel` |
| `print_stats = error` | `ACKNOWLEDGE` | 无需命令，业务层记录即可（下一个任务开始时状态会刷新） |
| `webhooks = shutdown / error` | `FIRMWARE_RESTART` | `POST /printer/firmware_restart`（或 `POST /printer/restart` 重启主机程序） |
| 任意时刻 | `EMERGENCY_STOP` | `POST /printer/emergency_stop` |

### 6.5 面板侧的处理规则【建议】

1. **按钮受权限控制**：每个标准动作对应一个权限节点，如 `printer:error:resume`、`printer:error:stop`。例如志愿者能 `ACKNOWLEDGE`、`RESUME`，只有 Builder 能 `STOP`、`IGNORE_PERMANENTLY`。
2. **`requiresOnSite` 的按钮要二次确认**："我已在现场处理"，并记录是谁。远程直接点"问题已解决，继续"，在喷嘴堵塞、热床温度异常这类报错上是危险的。
3. **`destructive` 的按钮**：要求选择**失败归因**（机器故障 / 模型问题 / 切片问题），直接写入订单的 `FAILED` 原因，对上订单状态机。
4. **并发**：同一条报错只接受第一个处理动作（`errorId` + `commandId` 去重），其余人看到"已由某某处理"。
5. **确认生效**：命令发出后，以 `error_cleared` 事件为准；超时未清除，界面显示"未生效"，允许重试或换选项。
6. **现场直接处理**：有人在打印机屏幕上点掉报错时，driver 报 `clearedBy: "device"`，面板记"在设备端处理"，审计里能看到。
7. **附上画面**：报错时自动调 `cameraSnapshot()`，跟按钮一起展示，方便判断能不能继续。
8. **全部进审计日志**：报错码、展示了哪些选项、谁点了哪个、结果如何。

---

## 7. 错误分类（同 v0，补一行）

| class | 含义 | 上层处理 |
|---|---|---|
| `transient` | 暂时性，可重试 | 退避重试；持续失败则 `OFFLINE` |
| `needs-human` | 需要现场处理 | `ERROR_PAUSED`，走 §6 |
| `fatal-config` | 配置错误，重试没用 | 标 `DISABLED`，告警（如未开启拓竹开发者模式） |
| `unsupported` | 能力缺失 | 降级或拒绝 |
| `machine-fault` | 机器级故障 | `FAULT`，订单 `FAILED` 默认归因"机器故障" |

> 注意区分：这里的"错误分类"是 **driver 调用失败** 的分类；§6 的 `ActiveError` 是 **打印机自己报的错**。两者不要混用。

---

## 8. 模拟 driver 与一致性测试

Fake driver 至少覆盖：正常完成、人工暂停与继续、报错暂停（每种标准动作都要能触发）、报错在设备端被处理、断料、预热超时、拉取文件失败、中途断线并重连、外部任务（插卡直印）、机器级故障、固件或模式不兼容、未知 `stg_cur` 编号、未知报错码（走兜底选项）。

一致性测试新增：`resolveError` 幂等；报错清除必须有 `error_cleared` 事件；`actions` 里只出现 driver 真能执行的动作。

---

## 9. Python 实现约定

【已定】每个品牌的 driver 是一个独立模块，用 Python 写。以下是实现方式的【建议】。

### 9.1 包的拆分

| 包 | 内容 |
|---|---|
| `driver-api` | 只放接口：基类、数据模型（状态、事件、报错、能力清单）、错误类型、**一致性测试套件** |
| `driver-bambu` | 拓竹 driver |
| `driver-klipper` | Klipper / Moonraker driver |
| `driver-fake` | 模拟 driver，测试和演示用 |

包名前缀待定（比如用项目名）。每个 driver 包**只依赖 `driver-api`**，不依赖 daemon，也不互相依赖。这样一个品牌的协议变了，只动一个包。

### 9.2 发现与加载

- 用 Python 标准的 **entry points** 机制注册 driver：每个 driver 包在 `pyproject.toml` 里声明一个入口，daemon 启动时通过 `importlib.metadata.entry_points()` 找到所有已安装的 driver。装上就能用，卸载就消失，daemon 里不写死品牌列表。
- 每个 driver 声明自己支持的 `driver-api` 版本，daemon 发现版本不兼容就拒绝加载并告警，不会运行到一半才崩。

### 9.3 编写约定

- **全异步**（asyncio）：MQTT、WebSocket、视频流都是长连接，同步写法会互相阻塞。
- **基类用抽象类**：必选方法（`connect`、`snapshot`、`start` 等）是抽象方法；可选方法（`emergency_stop`、`open_camera_stream` 等）基类默认返回 `unsupported`，并且要与能力清单一致（一致性测试会检查）。
- **数据模型**：用 pydantic 或 dataclass 定义事件和状态。daemon 和面板之间的消息格式，建议从这些模型导出 JSON Schema，面板那边按 schema 生成类型，避免两边手写各自漂移。
- **故障隔离**：每个打印机实例跑在自己的 asyncio 任务里，由 daemon 的监督器管理。driver 抛异常只影响那一台：记录、退避、重连，不拖垮整个 daemon。真需要更强的隔离（比如某个 driver 有内存泄漏），以后再改成子进程，接口不变。
- **一致性测试**：`driver-api` 自带一套 pytest 测试，每个 driver 包在自己的 CI 里对 fake 环境或录制的流量跑一遍。社区以后贡献新品牌 driver，也是过这套测试才能合并。

### 9.4 依赖候选（未核实，选型前需查维护状态）

- MQTT：基于 paho 的异步封装（如 aiomqtt）。
- FTPS：拓竹走的是**隐式 TLS**（端口 990，前面查到的资料里也是这个端口）。Python 标准库的 `ftplib.FTP_TLS` 默认是显式 TLS，需要自己包一层才能用，这是个常见的坑。
- HTTP / WebSocket（Moonraker）：aiohttp 或 httpx。

---

## 10. 摄像头：抓拍与视频流

【已定】抓拍和视频流都要。以下是【建议】。

### 10.1 两者的用途不同

| | 抓拍 | 视频流 |
|---|---|---|
| 用途 | 打印完成的成型图、报错时附图、定时存档、给选手看自己那单的进度 | 运维远程判断"能不能点继续"、远程盯着打印 |
| 存储 | 存下来，挂到订单和报错记录上 | 不存，只实时转发 |
| 给谁看 | 【已定】概览页对所有角色公开，选手也能看画面（见项目简报 §0.9） | 【已定】选手可见；后期用权限节点 `printer:camera:stream` 配置 |

> 【已定】原先"选手不开放视频流"的建议已被推翻：概览页上选手能看到打印机画面。画面里可能拍到在场的人，活动前要在场地告示里说明。观看人数因此变多，§10.2 的"单路拉流、多路分发"是必需的；【建议】概览卡片默认显示定时刷新的抓拍图，点开单台再拉实时流。

### 10.2 架构：视频不走控制通道

- **控制通道**（daemon ↔ 面板的长连接）只传状态、事件、命令和抓拍图片，视频流**不走这条路**，免得大流量把控制消息堵住。
- daemon 里加一个**媒体层**：driver 的 `open_camera_stream()` 只负责把设备的原始流交出来，媒体层负责：
  - **单路拉流、多路分发**：每台打印机最多只从设备拉一路流，再分给所有观众。打印机自己能承受的并发连接很可能很少（【推断】，见实测清单），多人同时看不能各自去连打印机；
  - **按需开启**：有人看才拉流，最后一个观众离开一段时间后断开，节省打印机和 daemon 的资源；
  - **格式统一**：把各品牌的原始格式转成浏览器能直接播的一种格式。起步可以先用 MJPEG（实现最简单，延迟可以接受），以后需要更低带宽再换成 WebRTC 或 HLS，可以考虑用现成的转流服务来做，不用自己写编解码。
- **抓拍可以从流里截帧**：设备没有原生抓拍接口时，driver 声明 `snapshot: "from-stream"`，由媒体层临时拉流截一帧。

### 10.3 各品牌的情况（需核实）

- **拓竹**：前面查到的 bambu-rs 文档里提到 A1/P1 有一种"腔内图像流"，说明 P1 系列给的是一帧一帧的 JPEG，而不是标准视频流【已查到出处】。X1 系列据我所知用的是 RTSP 视频流，具体端口和认证方式我没有核实。P1 的画面帧率很低，用来看现场情况够用，别指望流畅。
- **Klipper**：摄像头不归 Klipper 管，通常由单独的摄像头服务（如 crowsnest 一类）提供 MJPEG 流和抓拍地址，Moonraker 能登记这些地址供客户端查询。具体接口我没有核实。

### 10.4 延时摄影

【已定】延时摄影要保存并绑定到订单，查看要有权限节点。下面是查到的情况和【建议】。

**拓竹在局域网模式下能不能存、能不能取**
- **能存在打印机里。** Bambu Studio 源码里，开启延时摄影的前提条件是：打印机支持延时摄影，并且有内部存储，或者插了状态正常、非只读的 SD 卡（或装了延时摄影套件）。【官方源码】所以 **P1 系列要插 SD 卡**，这条在活动前要检查。
- **开关命令**：通过 MQTT 的 `camera` 命令 `ipcam_timelapse`，参数 `control` 为 `enable` 或 `disable`。【官方源码】源码里还有查询存储空间是否够用（`ipcam_get_media_info` 加 `is_timelapse_storage_enough`）和删除最旧的延时摄影（`ipcam_delete_oldest_timelapse`）这两条命令。【官方源码】P1 是否都支持，**需实测**。
- **能直接取。** 社区用户的报告是，用打印机 IP、用户名 `bblp`、局域网访问码当密码、端口 990 连上去，里面有个叫 **Timelapse** 的文件夹，可以下载和删除文件。【社区，单个用户在 A1 mini 上验证，P1 需实测】这跟 driver 下发文件用的是同一条 FTPS 通道。
- **文件格式**：社区报告 P1P、P1S、A1 录出来是 AVI，X1C 是 MP4；一次打印有时会分成好几个文件；还有人遇到过录出空白 AVI 的情况。【社区】

**和订单绑定**【建议】
- 设备上的文件名里没有你的订单号，**只能按时间窗口匹配**：取任务开始到结束这段时间里生成的文件，挂到对应的订单上。分成多个文件的，按时间顺序拼接。
- **取回时机**：任务结束后、清板确认前的这段时间（`CLEARING_REQUIRED`）最合适，那时打印机空闲。下载完、校验无误后**从 SD 卡上删掉**，免得卡被写满导致下一单录不了。
- **转码**：浏览器一般播不了 AVI，daemon 或面板侧的后台任务要用 ffmpeg 转成浏览器能播的 MP4（H.264），顺便压低码率，延时摄影本来就不需要高码率。
- **空白文件**：转码前检查时长和画面，空白或损坏的标记为"延时摄影失败"，不要静默挂到订单上。
- **Klipper**：Klipper 本身不录延时摄影，常用的是社区插件 moonraker-timelapse，生成的视频默认存到 `~/timelapse/`，用 H.264 编码。【社区】没装插件的机器，就由 daemon 定时抓拍自己合成（`assembled-by-daemon`）。

**防止对象存储被刷**【建议】：光有查看权限还不够，因为一个合法用户也可以反复下载把流量刷爆。
- **权限节点**：至少分 `order:timelapse:view-own`（看自己订单的）、`order:timelapse:view-any`（看所有订单的，给运维）、`order:timelapse:download`（下载原文件，默认只给 Builder）。选手默认只能在线看自己的，不能下载原文件。
- **存储桶不公开**，只通过面板签发的**短时效签名链接**访问，链接绑定用户，几分钟就过期，转发出去也很快失效。
- **按用户限流**：每人每天的观看次数或流量设上限，超了就要等，所有访问都记审计日志。
- **只放压缩版**：对外只提供转码后的低码率版本，原文件放在不对外的位置或干脆不存。
- **生命周期**：活动结束后一段时间自动删除，或者转到便宜的归档存储。
- **防盗链**：存储或 CDN 上开 Referer 校验，只允许面板域名。
- **可以先不上云**：如果活动期间主要在场地内看，延时摄影先放在场地内网的存储里，就根本不会产生公网流量费用。

---

## 11. 第一批真机实测清单（拓竹）

1. P1 系列在仅局域网 + 开发者模式下，`gcode_state` 实际会出现哪些值，`INIT` 是否会出现。
2. `RUNNING` 期间 `stg_cur` 是否真的会报加热、调平等准备阶段。
3. 任务结束后是否一直停在 `FINISH / FAILED`，直到下一个任务开始。
4. 人工停止后落到 `FAILED` 还是别的状态。
5. `resume / stop / ignore / idle_ignore / clean_print_error / ams_control / buzzer_ctrl` 在 P1 上分别是否生效。
6. 拿到 `hms_action_<机型>.json` 的方式，以及离线使用是否可行。
7. 报错在打印机屏幕上被处理后，`print_error` 是否归零（用于判定 `clearedBy: "device"`）。
8. P1 摄像头流的实际格式、帧率、分辨率，以及最多允许几路同时连接。
9. 打印中拉摄像头流，是否影响 MQTT 状态上报或文件传输。
10. P1 在仅局域网模式下，FTPS 能否列出并下载 `Timelapse` 文件夹；文件名格式、一次打印会分成几个文件。
11. `ipcam_timelapse`、`ipcam_get_media_info`、`ipcam_delete_oldest_timelapse` 在 P1 上是否生效；下发打印任务时能否直接带上"开启延时摄影"的参数。
12. 下发多盘 `.gcode.3mf` 时，如何指定只打其中某一盘（命令里的参数格式）。
13. 各机型上报里，存储介质是否在位、可写、剩余空间分别由哪些字段表达（X2D：内置存储 + U 盘；P1：SD 卡）；P1 拔卡后下发任务会怎样。

---

## 12. 待定

1. ~~实现语言与 driver 加载方式~~ → 【已定】Python，每个品牌一个模块；加载方式见 §9.2【建议】。
2. `snapshot()` 对账的触发时机与频率。
3. 切片产物暂存位置与清理策略。
4. ~~多喷嘴 / 多板机型的表达~~ → 【已定】多喷嘴要支持；一个订单一盘，多盘文件自动拆成多张独立订单，不做父子订单（见项目简报 §5.3）。待定的是多喷嘴文件和设备之间怎么做喷嘴映射。
5. ~~摄像头只做抓拍，还是也做流~~ → 【已定】都要，见 §10。
6. 事件 `seq` 的持久化与重放协议。
7. 各标准动作对应的权限节点与默认角色分配。
8. 视频流转成浏览器格式用哪种方案（MJPEG 起步，还是直接上 WebRTC）。
9. Python 版本下限和包名前缀。

---

## 参考来源

- [Bambu Studio（拓竹官方开源客户端）](https://github.com/bambulab/BambuStudio)：`src/slic3r/GUI/DeviceManager.cpp`、`DeviceErrorDialog.cpp/.hpp`、`HMS.cpp`
- [ha-bambulab](https://github.com/greghesp/ha-bambulab)：`custom_components/bambu_lab/pybambu/const.py`（社区）
- [OpenBambuAPI](https://github.com/Doridian/OpenBambuAPI/blob/main/mqtt.md)（社区，内容较少）
- [Moonraker 文档：Printer Objects](https://moonraker.readthedocs.io/en/latest/printer_objects/)
- [Moonraker 文档：Printer 接口](https://moonraker.readthedocs.io/en/latest/external_api/printer/)
- [Klipper 文档：Status Reference](https://www.klipper3d.org/Status_Reference.html)
- [拓竹论坛：通过 FTP 访问 P1/A1 的文件（含 Timelapse 文件夹）](https://forum.bambulab.com/t/we-can-now-connect-to-ftp-on-the-p1-and-a1-series/6464/102)（社区）
- [拓竹论坛：延时摄影 AVI 与 MP4 格式](https://forum.bambulab.com/t/change-the-timelapse-file-format-from-avi-to-mp4/62678)（社区）
- [moonraker-timelapse 配置文档](https://github.com/webino/moonraker-timelapse/blob/main/docs/configuration.md)（社区插件）
