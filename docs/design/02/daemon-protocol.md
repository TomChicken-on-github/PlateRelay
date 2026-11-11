# 2.3 · daemon 协议

> 属于 [文档 2](README.md)。编号 `MSG-`。重写时，本文的消息定义会落成 `packages/shared/schema/daemon/v1/` 下的 JSON Schema（Q141），TypeScript 和 Python 两边都从 Schema 生成类型；Schema 和本文不一致时，先改本文再改 Schema。

## 1. 总体

```
 打印机 ──局域网── daemon ──wss（控制通道）──▶ 面板
                    │   └─https（文件、抓拍、延时摄影）─▶ 面板
                    └──SRT/UDP（退 RTSPS）或 wss（媒体，按需）─▶ 媒体服务 ──WebRTC / LL-HLS──▶ 浏览器
```

| 编号 | 约定 |
| --- | --- |
| MSG-GEN-01 | 永远是 daemon 主动连面板，面板不连进局域网（NG-08）。 |
| MSG-GEN-02 | 控制通道：一条 WebSocket 长连接 `wss://<面板>/daemon/v1/ws`，只传 JSON 文本帧（F-DMN-03）。 |
| MSG-GEN-03 | 大的东西不走控制通道：模型文件、抓拍、延时摄影走 HTTPS（MSG-HTTP），实况走单独的媒体通道（MSG-MEDIA），免得把控制消息堵住（F-PRT-09）。 |
| MSG-GEN-04 | 只能用 TLS。开发时允许连 `localhost` 的明文 `ws://`，靠一个只在开发构建里存在的开关。 |
| MSG-GEN-05 | 时间是 RFC 3339 UTC 字符串；ID 是 UUIDv7。 |

## 2. 注册（MSG-ENR）

| 步骤 | 内容 |
| --- | --- |
| 1 | 管理员在 daemon 页点"生成安装命令"。面板新建 E-ENR，令牌 15 分钟有效、只能用一次（F-DMN-01）。 |
| 2 | 面板按平台给出**一条**命令（Linux / Windows / Docker，F-DMN-06），令牌用 `--token` 参数传给安装脚本（Q156）。脚本也接受环境变量 `PLATERELAY_ENROLL_TOKEN`，给不想让令牌出现在命令行里的人用。用掉令牌后，脚本尽量把这条命令从 shell 历史里删掉，删不掉不影响安装。 |
| 3 | daemon 在本机生成 RSA-3072 密钥对。私钥只存在本机：Linux 是权限 0600 的文件，Windows 用 DPAPI 加密后存，Docker 放在挂载卷里（F-DMN-02、INV-07）。 |
| 4 | daemon 调 `POST /daemon/v1/enroll`：`{ token, publicKey, name, platform, daemonVersion, protocolVersion }`，`publicKey` 是 SPKI DER 的 base64。 |
| 5 | 面板校验令牌，作废它，新建 E-DMN，返回 `{ daemonId }`。daemon 把面板地址和 `daemonId` 写进自己的配置文件（不含任何秘密）。 |
| 6 | 安装脚本在终端显示公钥指纹（SHA-256，分组显示）；面板 daemon 卡片显示同一个指纹。管理员给这个 daemon 绑打印机（填访问码）之前先核对两边一致，防止令牌被人抢先用掉、骗走访问码。不加"待放行"状态（Q330）。 |

一次性令牌出现在安装命令里，是 F-DMN-01 明确允许的唯一例外：它 15 分钟过期、用一次就作废，daemon 不把它写进配置或日志。真正的保护靠这几点，而不是传法：只能用一次、15 分钟过期、安装成功即作废；注册时如果报"令牌已被使用"，安装脚本明确提示管理员去 daemon 列表里查有没有陌生的注册。

## 3. 连接与认证（MSG-AUTH）

```
daemon                                  面板
  │── hello ───────────────────────────▶│  daemonId、协议版本、daemon 版本、适配器
  │◀─────────────────────── challenge ──│  32 字节随机数、服务器时间
  │── auth ────────────────────────────▶│  RSA-PSS 签名
  │◀───────────────────────── welcome ──│  会话、心跳间隔、打印机分配、参数
  │── printer.snapshot × N ────────────▶│  每台打印机一份，用来对账
```

| 编号 | 约定 |
| --- | --- |
| MSG-AUTH-01 | `hello`：`{ daemonId, protocolVersion, daemonVersion, platform, bootId, adapters: [{ brand, version }] }`。`bootId` 是 daemon 进程每次启动生成的 UUID。 |
| MSG-AUTH-02 | `challenge`：`{ nonce, serverTime }`，`nonce` 是 32 字节随机数的 base64，只能用一次，30 秒内有效。 |
| MSG-AUTH-03 | `auth`：`{ signature }`。签名算法 RSA-PSS（SHA-256，盐长 32），签的内容是 UTF-8 字符串 `"platerelay-daemon-auth/v1\n" + daemonId + "\n" + nonce + "\n" + 面板的 origin`。带上 origin，签名就不能拿到别的面板去用。 |
| MSG-AUTH-04 | `welcome`：`{ sessionId, protocolVersion, heartbeatSeconds, httpToken, httpTokenExpiresAt, printers: [MSG-ASSIGN 的条目], config: MSG-CFG }`。`httpToken` 用来调 MSG-HTTP 的接口，和这条连接同生共死，到期前面板在控制通道上发 `token.renew` 换新的。 |
| MSG-AUTH-05 | 失败时面板用关闭码断开：`4401` 签名不对、`4403` daemon 已吊销、`4409` 同一个 daemon 有了更新的连接（新的顶掉旧的；10 分钟内被不同 IP 顶掉 3 次及以上就告警管理员"疑似私钥泄露"，不自动吊销，R-OPS-02、Q238）、`4426` 协议版本不兼容。 |
| MSG-AUTH-06 | daemon 断线后按指数退避重连：1 秒起，翻倍，最长 60 秒，加 ±20% 随机抖动（Q175）。收到 `4403` 不再重连。 |

## 4. 版本协商（MSG-VER）

| 编号 | 约定 |
| --- | --- |
| MSG-VER-01 | 协议版本是 `主.次`，从 `1.0` 开始。次版本只加东西：加可选字段、加消息类型、加命令类型。双方都忽略不认识的字段和消息类型（会回 `ack`，不报错）。 |
| MSG-VER-02 | 面板支持当前主版本和上一个主版本（F-DMN-05）。更老的 daemon 连上来，面板回 `upgrade_required { minProtocolVersion, upgradeCommand }` 后用 `4426` 断开，并给它名下的打印机挂异常原因 `DAEMON_UPGRADE`（S-RSN-UPGRADE）。 |
| MSG-VER-03 | daemon 不自动升级（NG-10），只把面板给的升级命令记进日志，由人去执行（F-DMN-07）。 |
| MSG-VER-04 | daemon 收到一个它不认识的命令类型，回 `command.result { status: "rejected", code: "unsupported_command" }`，不执行（INV-14）。 |

## 5. 消息信封与可靠投递（MSG-ENV）

```json
{
  "id": "0192f3c1-7b2e-7c4a-9d1e-3f5a6b7c8d9e",
  "type": "printer.event",
  "ts": "2026-11-04T12:00:00.000Z",
  "body": { }
}
```

| 编号 | 约定 |
| --- | --- |
| MSG-ENV-01 | 每条消息都有唯一 `id`（F-DMN-03）。 |
| MSG-ENV-02 | 需要确认的消息：除了 `ack`、`ping`、`pong`、`printer.snapshot` 以外的全部。接收方处理完（面板是提交了数据库事务）才回 `ack { id }`。 |
| MSG-ENV-03 | 发送方把没收到 `ack` 的消息留在发件箱里，重连后按原顺序重发。daemon 的发件箱落盘（重启不丢），最多留 24 小时或 10000 条，超了丢最老的并记日志（Q176）。面板的发件箱就是 E-CMD。 |
| MSG-ENV-04 | 接收方按 `id` 去重：面板记 24 小时内处理过的 ID（E-IDEM 的 daemon 部分）。daemon 收到命令后、**开始执行之前**，先把命令 ID 写进硬盘，留到这条命令的 `expiresAt` 过去为止（之后再来只会回 `expired`），保证同一条命令最多执行一次，daemon 重启也一样（Q206、R-CMD-08）。重复的消息直接回 `ack`，不再处理。 |
| MSG-ENV-05 | `printer.snapshot` 不确认、不重发，因为下一份会覆盖它；断线期间只发最新一份。 |
| MSG-ENV-06 | 同一台打印机的消息带 `bootId` 和 `seq`（这台打印机在这次启动里单调递增）。面板丢掉 `seq` 比已处理的还小的快照；事件按 `seq` 顺序处理，中间有缺口时等重发，等 10 秒还没到就要一份快照对账（Q177）。 |

## 6. 心跳（MSG-HB）

| 编号 | 约定 |
| --- | --- |
| MSG-HB-01 | 双方每 `heartbeatSeconds`（默认 15 秒，Q174）发 `ping`，对方回 `pong`。 |
| MSG-HB-02 | 面板 3 个周期（45 秒）没收到任何消息，就认为 daemon 断了：它名下的每台打印机都挂异常原因 `OFFLINE`（S-RSN-OFFLINE），不论原来在什么状态（Q399）；当前任务和订单状态不动（R-ARB-12）。 |
| MSG-HB-03 | daemon 连得上面板、但连不上某台打印机，用 `printer.event { kind: "connection.down" }` 报，面板按同样的规则处理那一台（S-RSN-OFFLINE）。 |

## 7. daemon → 面板

### MSG-SNAPSHOT `printer.snapshot`

整台打印机的状态，变化时发，同一台最多每秒 1 次（Q142）。是**完整状态**，不是增量：拓竹的增量包由 daemon 合并成完整状态后再发（R-PRT-13）。

```json
{
  "printerId": "…", "bootId": "…", "seq": 1042,
  "connected": true,
  "state": "PRINTING",
  "substage": null,
  "job": {
    "jobRef": "0192…",
    "external": false,
    "name": "pr-a1b2c3d4e5f6.gcode.3mf",
    "percent": 37,
    "remainingSeconds": 3120,
    "layer": 58, "totalLayers": 210,
    "skippedParts": [3]
  },
  "pendingStarts": [{ "jobRef": "0193…", "stage": "DOWNLOADING" }],
  "temps": { "nozzle1": { "current": 220, "target": 220 }, "bed": { "current": 55, "target": 55 }, "chamber": { "current": 31 } },
  "nozzles": [{ "extruder": 1, "diameterMm": 0.4, "flow": "standard" }],
  "trays": [{ "unit": 0, "slot": 0, "label": "AMS 1 · 1", "material": "PLA", "subType": "PLA Basic", "colour": "#FFFFFF", "rfidUid": "…", "remainingPercent": 80, "extruders": [1] }],
  "bedType": "textured_pei",
  "storage": [{ "medium": "internal", "present": true, "writable": true, "freeBytes": 1234567890 }],
  "activeErrors": [],
  "controls": { "light": "on", "speedLevel": 2 },
  "camera": { "stream": true, "snapshot": true },
  "deviceBoot": "…",
  "runSeq": 17
}
```

- `state` 用适配器的标准状态（IF-ADP-03），不是面板的打印机状态；换算规则在面板（IF-ADP-04）。
- `substage` 是标准子阶段（驱动草稿 §3），界面只在准备中显示（R-VIS-11）。
- `pendingStarts` 是 daemon 手里还没发出开打指令的任务（`stage`：`QUEUED`、`DOWNLOADING`、`UPLOADING`），已经停下（持久化了"不再开打"）的不列。对账靠它认出"任务还在进行"（MSG-RECON-02 第 ①，Q308）。
- `job.jobRef` 是这次的打印任务 ID（E-JOB）；`external: true` 表示不是系统下发的（MSG-JOBREF）。
- `deviceBoot` 是适配器给的"打印机这次开机"的标识（如从运行时长推出的开机时刻），拿不到就省略。第二稿起对账不再用它推断（Q394），只显示在打印机详情和事件日志里。
- `runSeq` 是 daemon 给这台打印机记的运行序号，写在硬盘上，只增不减：每看到打印机开始一次运行（系统任务或外部任务，进入准备中或打印中）加一；daemon 有一段时间看不到打印机（局域网断开、daemon 自己重启），回来时证明不了这段时间它没跑过东西的，也加一（适配器能证明没跑过时不加，标准等驱动实测定）。第二稿起只用于 daemon 自己的开打前检查和"开打可能没到"时确认没开打（MSG-CMD-START，Q361、Q363），对账不再用它（Q398）。daemon 丢了本地状态时从一个比面板下发的已知值更大的数重新开始。
- `trays[].rfidUid` 是 RFID 卷的唯一号，非 RFID 卷省略；面板拿它和材质、颜色、有没有料一起判断换料（文档 1 R-DSP-16）。`remainingPercent` 是打印机自己估的余量，照传但面板不用来算（误差太大，Q409）。
- 拿不到的字段省略，不填假值。

### MSG-EVT `printer.event`

离散事件。面板靠事件推进状态，用快照对账（Q142）。

```json
{ "printerId": "…", "bootId": "…", "seq": 1043, "kind": "job.started", "jobRef": "0192…", "data": {} }
```

| `kind` | `data` | 面板做什么 |
| --- | --- | --- |
| `connection.up` | | 记事件日志，然后按 MSG-RECON 对账，对完去掉 `OFFLINE` |
| `connection.down` | `{ reason }` | 挂 `OFFLINE`（S-PRN-T22），记事件日志 |
| `job.staged` | | 文件已经放到打印机上 |
| `job.started` | | S-ORD-T11 |
| `job.paused` | `{ reason: "USER" \| "ERROR" \| "RUNOUT" }` | 任务进暂停中（R-PRT-03）；`ERROR`、`RUNOUT` 挂 `ERROR` 原因；记事件日志 |
| `job.resumed` | | 任务回到暂停前的阶段，去掉这个任务的 `ERROR` 原因（可能 S-PRN-T23）；记事件日志 |
| `job.finished` | | S-ORD-T12、S-PRN-T21 |
| `job.failed` | `{ reason, beforeStart }` | 开打前：任务以 `START_FAILED` 结束，S-ORD-T09（R-PRT-23）；开打后：S-ORD-T13 |
| `job.cancelled` | `{ commandId?, beforeStart }` | 带面板停止命令的 ID = 面板发的停止生效了；没有 = 有人在打印机屏幕上停的。订单去向只看 `beforeStart`：开打前停下 → S-ORD-T09，开打后 → S-ORD-T13 |
| `job.parts_skipped` | `{ partIds }` | 打印机上报的已跳过列表，写进 E-JOB `skipped_parts`，记一条"跳过零件"记录（R-SKP-04、R-SKP-06） |
| `external.started` | `{ name }` | R-PRT-11：可用、待清板进工作（外部，S-PRN-T20、T26）；异常保持异常，只显示进度。一个已结束任务的 jobRef 又跑起来也报成这个（Q393） |
| `external.ended` | `{ result }` | 工作（外部）→ 待清板（S-PRN-T21）；异常时不变，原因去掉后按 T24 进待清板 |
| `error.raised` | `{ error: ActiveError }` | 记 E-PERR 和事件日志；需要人处理的（暂停类）挂 `ERROR` 原因（R-PRT-03）；信息级 HMS（如存储快满）只显示，不挂原因（Q400） |
| `error.cleared` | `{ errorId, clearedBy: "PANEL" \| "DEVICE" \| "UNKNOWN" }` | 更新 E-PERR |
| `filament.refilled` | `{ fromSlot, toSlot }` | 固件自动续料换了槽，只记事件日志，不暂停、不挂原因（R-PRT-28，Q407）。字段等驱动实测（Q408） |
| `timelapse.ready` | `{ files: [{ name, sizeBytes }] }` | 等 daemon 上传（MSG-HTTP-04） |

`ActiveError` 的结构见[驱动接口草稿 §6.2](../../printer-driver-interface-draft.md)，`actions` 只能是标准动作（R-PRT-14）。

### MSG-CMD-RESULT `command.result`

```json
{ "commandId": "…", "status": "accepted", "code": null, "message": null, "data": {} }
```

| `status` | 含义 |
| --- | --- |
| `accepted` | 打印机收下了命令。**不代表做完**，结果看后面的事件（P-01） |
| `done` | 命令本身就是结果（刷新、开关灯、上传完成） |
| `rejected` | daemon 没执行：不在白名单（INV-14）、状态不允许、参数不对。`code` 说明原因 |
| `expired` | 收到时已经过期（MSG-CMD-TTL），没执行 |
| `failed` | 执行了但失败了。`message` 是固件或打印机原样返回的内容（R-PRT-15） |

一条命令可能先回 `accepted` 再回 `done` 或 `failed`；最后一次为准。

### MSG-DISC `discovery.report`

被动监听局域网广播听到的打印机（F-PRT-12），每次是完整列表，有变化时发，最多每 10 秒一次：

`{ printers: [{ brand, serial, host, modelId, name, lastSeenAt }] }`

只听不发。面板放内存，不存表；"添加打印机"时列出来。听到的某台已经分配给这个 daemon、但 IP 变了，面板自动更新 `host` 并记审计。

## 8. 面板 → daemon

### MSG-ASSIGN `printers.assign`

这个 daemon 负责哪些打印机，每次都发**完整列表**（在 `welcome` 里，以及之后有变化时）：

```json
{ "printers": [{ "printerId": "…", "brand": "bambu", "serial": "…", "host": "192.168.0.106",
                 "accessCodeCipher": "base64…", "keyFingerprint": "…",
                 "currentJobRef": "…", "cleanupJobRefs": ["…"] }] }
```

- `currentJobRef` 是面板记的这台打印机的当前任务（没有为 null）；`cleanupJobRefs` 是已结束、但打印机上可能还留着文件（3mf、延时摄影）要收尾的任务。**是不是系统任务以面板为准**（Q228）。
- 停用的打印机（E-PRN `disabled_at`）不在列表里（R-PRT-20）。

- 访问码是浏览器用 daemon 公钥加密的密文，面板解不开，只是转交（INV-07）。daemon 在内存里解密，不落盘、不进日志。
- 列表里没有的打印机，daemon 断开它、删掉它的本地状态。
- 公钥指纹对不上（daemon 换过密钥），daemon 回 `printer.event { kind: "connection.down", data: { reason: "access_code_key_mismatch" } }`，面板提示重填访问码。

### MSG-CMD `command`

```json
{ "commandId": "…", "printerId": "…", "kind": "job.start", "expiresAt": "2026-11-04T12:01:00Z", "params": {} }
```

| `kind` | `params` | 有效期（送达） | 类 | 什么上报算"状态变了"（前端停转圈，R-CMD-01） | 对应 |
| --- | --- | --- | --- | --- | --- |
| `job.start` | `{ jobRef, expectedRunSeq, file: { fileId, sha256, sizeBytes }, plateIndex, bedType, mapping: [{ sliceSlot, extruder, unit, slot }], timelapse }` | 60 秒 | 控制 | 打印机进入准备中、开始打印或报开打前失败；传文件见 MSG-CMD-START | S-ORD-T08 |
| `job.stop` | `{ jobRef }` 或 `{ external: true }` | 60 秒 | 控制 | 打印机上报这个 `jobRef` 的任务结束（`job.cancelled`、`job.failed`、`job.finished`）。`external: true` 是外部任务时的停止，停掉打印机上正在跑的任务，以打印机上报结束为准（Q326）。传文件、准备中和打印中都用它；没有单独的撤回命令（Q203、Q207）。传文件期间收到：见 MSG-CMD-START，daemon 直接回 `job.cancelled { beforeStart: true }`（Q223） | R-PRT-04、R-PRT-05 |
| `job.skip_parts` | `{ jobRef, partIds }` | 60 秒 | 控制 | 打印机上报的已跳过列表变了 | F-SUB-07 |
| `error.resolve` | `{ errorId, action }` | 60 秒 | 控制；动作是"停止"时按 `job.stop` 处理 | 这条报错从上报里消失，或打印机状态变了 | R-PRT-14 |
| `control` | `{ action, args }`，`action` 必须在这台打印机的静态命令清单里（IF-ADP-02） | 30 秒 | 按动作的 `category`：`light` `temperature` `fan` `speed` 是设定值，其余（`pause` `resume` `filament` `dry` `motion`）是控制 | 控制：打印机上报的状态变了；设定值：界面短暂保持刚设的值，之后显示上报的值（R-CMD-06） | R-PRT-15 |
| `refresh` | `{}` | 10 秒 | 只读 | — | R-PRT-12（拓竹 = 一次 `pushall`，只读） |
| `storage.list` | `{}` | 10 秒 | 只读 | — | R-PRT-22、F-PRT-11。回 `done`，`data = { media: [{ medium, present, freeBytes, totalBytes }], files: [{ medium, name, sizeBytes, modifiedAt, system }] }`；`system` 按 MSG-JOBREF-02 判断。只列，不删不下载 |
| `camera.open` | H.264 机型：`{ srtUrl, rtspsUrl, publishToken, latencyMs, expiresAt }`；JPEG 帧机型：`{ framesUrl }` | 30 秒 | 只读 | — | MSG-MEDIA、R-CAM-06 |
| `camera.close` | `{}` | 30 秒 | 只读 | — | R-CAM-06 |
| `snapshot.mode` | `{ watched: bool }`：这台打印机现在有没有人在看 | 30 秒 | 只读 | — | R-CAM-08 |
| `snapshot.now` | `{ reason: "FIRST_VIEWER" \| "ERROR" }` | 30 秒 | 只读 | — | R-CAM-08、R-CAM-10 |
| `timelapse.collect` | `{ jobRef }` | 1 小时 | 只读 | — | R-CAM-04 |

**MSG-CMD-TTL**（Q143）：

- 有效期指"必须在这之前开始执行"。`job.start` 排队和下载文件的时间不算在内，进了下载队列就算开始执行（DAE-XFER-02，Q254）。
- daemon 按 `welcome.serverTime` 算出和面板的时钟差，用面板的时间判断过期。收到时已经过期的，回 `expired`，不执行。这样断线很久之后，积压的旧"开打"不会突然被执行。
- daemon 回 `expired` 是事实（它保证过期的命令永远不再执行）：`job.start` = 下发失败，订单回原位（R-DSP-08）；`job.stop` = 这次停止没执行，停止按钮照常可点（R-CMD-05）。
- 面板自己算出过了 `expiresAt` 但没收到回复，**不算事实**：daemon 可能在过期前已经执行、只是回复还在它的发件箱里（MSG-ENV-03）。这时只把 `status` 记成 `EXPIRED` 方便排查，订单和打印机状态等打印机上报。

**MSG-CMD-STATE**（R-CMD-01–08、Q215、Q243；替代已删除的 MSG-CMD-LOCK）：

- 面板只追踪命令送达（`status`），不判断命令"执行了没有"。订单和打印机状态只跟着打印机上报的事件走（P-01）。
- **没有命令锁**：按钮能不能点只看打印机上报的状态（IF-ADP-05），不看预计状态，也不因上一条命令还没结果而挡住。反向命令只在打印机上报了它要反转的状态之后才出现（INV-16）。
- 两个人同时点会发出两条；打印机已在那个状态时重复的暂停、继续、停止应当被固件忽略，待真机验证（驱动草稿 §11）。
- 设定值命令（R-CMD-06）：`params` 一律是目标值，不用切换或加减；连发以最后一条为准。
- 面板永远不自动发反向命令或再发。同一 `commandId` 从发件箱补投不算再发，daemon 保证最多执行一次（MSG-ENV-04、R-CMD-08）。
- daemon 回 `failed` 或 `rejected` 时，前端把原因原样显示（R-PRT-15）。

**MSG-CMD-START**（传文件，Q205）：

- daemon 收到 `job.start`、进了下载队列就回 `accepted`。同时最多下载 2 个文件（固定值，DAE-XFER-01，Q388），不做本机缓存，每次派单都重新下载；文件放到打印机上、开打指令已发出后发 `job.staged`。
- 下载（MSG-HTTP-02）和 FTPS 上传各自最多试 3 次，间隔 5 秒、15 秒、45 秒；每次尝试的超时是 CFG-CMD-02（默认 3 分钟，经 MSG-CFG 下发），从真正开始传起算，排队时间不算。每次重试覆盖上一次没传完的文件（它在 daemon 的清单里，INV-15），传完核对大小和 SHA-256，对不上也算一次失败。
- 重试都在同一条 `job.start` 里，不产生新命令；**开打指令发出之后不再重试任何一步**。
- 发开打指令之前，daemon 先确认打印机没在跑任务：空闲，或停在上一次的打完 / 失败 / 已取消（`IDLE` `FINISHED` `FAILED` `CANCELLED`）都可以发；只有准备中、打印中、暂停中（`PREPARING` `PRINTING` `PAUSED`）回 `rejected`（`code: printer_busy`）（Q239），什么都不发，按下发失败处理。`job.start` 带着面板派单时见到的 `expectedRunSeq`：发开打指令前 daemon 的 `runSeq` 已经不是这个值（派单后打印机跑过东西，哪怕现在停在打完），或传文件期间 daemon 有一段时间看不到打印机，同样什么都不发，回 `rejected`（`code: printer_used`），按下发失败处理，免得在没清的板子上开打（Q363）。面板结束任务时打印机状态跟最新上报走：在跑外部任务就进工作（外部），否则进待清板（S-PRN-T21），不回可用（Q317、Q370）；`printer_busy` 和 `printer_used` 不挂下发失败原因，其他传输失败挂 `SEND_FAILED`（Q400）。开打前不再另外向面板确认任务还在：压力测试里这一步和面板结束任务时发的 `job.stop` 都去掉也不出错，靠的是上面这条"打印机自派单以来没跑过别的任务"的检查，这条不能删（去掉后单个故障就能让系统任务打在没清板的板上）。`job.stop` 照常发，用来让 daemon 尽早删掉文件。
- 传文件期间（开打指令还没发）收到这个 `jobRef` 的 `job.stop`：daemon 中止下载或上传，删掉自己传了一半的文件（INV-15），把"这个 `jobRef` 不再发开打"和命令 ID 一样先写进硬盘（R-CMD-08），然后回 `job.cancelled { commandId, beforeStart: true }`。面板把任务结束为 `STOPPED_BEFORE_START`，订单回原位。开打指令只有 daemon 发，所以这里以 daemon 为准，不用等打印机（Q223）。
- 开打指令已经发出（`job.staged`）之后收到这个 `jobRef` 的 `job.stop`，而打印机没有在跑它：如果从文件放上打印机起 daemon 一直连着这台打印机，而且 `runSeq` 没变（打印机什么都没跑过），daemon 删掉自己放上去的文件（迟到的开打指令也就打不起来），把"这个 `jobRef` 不再发开打"写进硬盘，回 `job.cancelled { commandId, beforeStart: true }`，同一个 `jobRef` 只回一次。中途断过视线或 `runSeq` 变了的，daemon 不下结论，照常把停止发给打印机，由打印机上报或人判（R-CMD-04、R-PRT-08，Q361）。面板人判没开打时发的 `job.stop`（R-PRT-08）也按这一条记下不再开打。
- 重试用完回 `failed`，按下发失败处理（R-DSP-08）。每次尝试记在 `command.result.data.attempts`：`[{ step: "download" | "upload", error, at }]`。进度用 `command.result.data.step`：`queued` → `download` → `upload`，前端据此显示"排队中"。

**MSG-CMD-WL**（INV-14）：daemon 只执行上表里的命令类型，`control` 只执行适配器静态清单里的动作。别的一律 `rejected`。

### MSG-CFG `config.update`

面板设置变了且和 daemon 有关时下发：`{ snapshot: { watchedSeconds, unwatchedSeconds, staggerSeconds, uploadKbps }, transferTimeoutSeconds, downloadConcurrency, discoveryEnabled }`。对应 CFG-CAM-02、07 和 CFG-CMD-02（CFG-CAM-03 删除，Q416）。`staggerSeconds`（1 秒）、`uploadKbps`（1000）、`downloadConcurrency`（2）是固定值，照样在消息里下发，方便以后改成参数；`fileCacheBytes` 删除（Q388、Q391）。

### 其他

`ack { id }`、`ping`、`pong`、`token.renew { httpToken, httpTokenExpiresAt }`、`upgrade_required { minProtocolVersion, upgradeCommand }`。

## 9. 任务标识与对账（MSG-JOBREF、MSG-RECON）

| 编号 | 约定 |
| --- | --- |
| MSG-JOBREF-01 | 打印任务的 ID（E-JOB）就是 `jobRef`，一次派单一个。daemon 放到打印机上的文件名带上它：`pr-<jobRef 后 12 位十六进制>.gcode.3mf`。用后 12 位是因为 UUIDv7 的前 8 位是时间戳，大约 65 秒才变一次，一分钟内派的单会撞名；后 12 位是随机部分（Q219）。拓竹的任务名也用同一个后缀；daemon 清单里仍记完整的 `jobRef`。 |
| MSG-JOBREF-02 | daemon 在本机留一份清单，记它放进打印机或从打印机下载过的每个文件和对应的 `jobRef`（F-PRT-11）。清单只是缓存，**是不是系统任务以面板为准**（Q228）：打印机上正在打的任务或存储里的 `pr-<后 12 位>` 文件对得上清单，或对得上 MSG-ASSIGN 下发的 `currentJobRef` / `cleanupJobRefs` = 系统任务；都对不上 = 外部任务（`external: true`，F-PRT-08）。对上面板下发的、但清单里没有的（如打印机刚移到新 daemon，或 daemon 重装丢了清单），daemon 把文件收进自己的清单再按系统任务处理。 |
| MSG-JOBREF-03 | daemon 只删清单里的文件（INV-15），按 MSG-JOBREF-02 收进清单的也算：任务结束后删它下发的 3mf；延时摄影上传并核对成功后删原文件（F-PRT-10）。 |
| MSG-RECON-01 | 重连后，daemon 先给每台打印机发一份快照，面板拿快照和自己的记录对（R-PRT-07）。 |
| MSG-RECON-02 | 对账只有三种结果（文档 1 R-PRT-07，Q398），自上而下检查，命中就停： |

| 面板记录 | 快照 | 处理 |
| --- | --- | --- |
| 有当前任务 | ① 同一个任务还在进行：打印机在跑这个 `jobRef`（准备中、打印中、暂停中），或快照 `pendingStarts` 里还有它 | 去掉 `OFFLINE`，按快照经 §4A.2 把任务推进到当前阶段（补记 `prepared_at`、补"开始打印"、暂停和报错挂原因、恢复去掉原因）。打印机期间重启过也一样按事实走（Q394） |
| 有当前任务 | ② 有明确结局：daemon 清单里有这个 `jobRef` 的结束记录（清单丢了按 MSG-JOBREF-02 认领）；或打印机最后一个任务就是它（任务名或文件后缀对得上）并停在打完或失败；或 daemon 回过 `job.cancelled { beforeStart: true }` | 按事实结束任务（§4A.2）。停在失败、但面板从没见过它开打的，分不清是开打前还是开打后失败，不算明确结局，走 ③（Q366） |
| 有当前任务 | ③ 其他一切 | 挂 `JUDGE`，打印机留在异常，由现场人员三选一（R-PRT-08）。不按"找不到痕迹""运行序号""开机标识"去推断（Q392、Q394） |
| 没有当前任务 | 打印机在跑一个任务 | 去掉 `OFFLINE` 后进工作（外部，R-PRT-11）；还有别的原因就留在异常 |
| 没有当前任务 | 打印机没在跑任务 | 去掉 `OFFLINE`；没有别的原因就进待清板（S-PRN-T24）。断线前是可用也一样：夜里有人动过机器也不会漏（Q399） |

一个已结束任务的 `jobRef` 又在打印机上跑起来，在线和对账时都当外部任务（Q393），不挂回原订单。

对完账之后，daemon 发件箱里补发的、`seq` 比这份快照更旧的打印机事件直接丢弃：快照已经是更新的事实，旧的准备中或开打再放一遍会被当成外部任务开始。任务结束记录（`job.finished`、`job.failed`、`job.cancelled`）除外，不论新旧都照常处理（R-PRT-07，Q368）。

v1 的对账表（十几行，含重启、无痕迹、运行序号、迟到的开打几行）已删除（Q392–Q394、Q398）。

daemon 在本机记下每个任务的结束事件（直到面板 `ack`），所以"断线期间打完了"大多数时候能对上；只有 daemon 自己也重启丢了状态时才需要人判。

在线时打印机报了当前任务的结束（`job.finished`、`job.failed`、`job.cancelled`），不管面板把这个任务记在哪个阶段都照常结束，和对账时一样（Q376）。

## 10. HTTP 接口（MSG-HTTP）

都在 `/daemon/v1/` 下，用 `Authorization: Bearer <httpToken>`（MSG-AUTH-04）。

| 编号 | 接口 | 用途 |
| --- | --- | --- |
| MSG-HTTP-01 | `POST /daemon/v1/enroll` | 注册（MSG-ENR），用一次性令牌，不用 `httpToken` |
| MSG-HTTP-02 | `GET /daemon/v1/files/{fileId}?jobRef=` | 下载要打印的文件。只有派给这个 daemon 的打印机、还没结束的任务能下载。daemon 下完核对 SHA-256 |
| MSG-HTTP-03 | `PUT /daemon/v1/snapshots/{printerId}` | 上传最新一张抓拍（`image/jpeg`），请求头 `X-Captured-At`。频率和错峰见 MSG-SNAP。面板只留内存里最新一张（R-CAM-03） |
| MSG-HTTP-04 | `PUT /daemon/v1/timelapses/{jobRef}/{part}` | 上传延时摄影。请求头带 `X-Content-SHA256`；面板写进对象存储、核对大小和哈希，成功才返回 `201`，daemon 收到 `201` 才删打印机里的原文件（F-PRT-10） |
| MSG-HTTP-05 | `PUT /daemon/v1/end-photos/{jobRef}` | 上传结束照片（`image/jpeg`，请求头 `X-Captured-At`）。daemon 在发 `job.finished`、`job.failed`、`job.cancelled` 时自己立刻拍，不等面板命令（R-CAM-11）；不走抓拍的替换队列，失败按退避重试，直到面板返回 `201`。照片和待上传记录跟结束记录一起落盘（DAE-STO-03），收到 `201` 才删；结束事件的 `ack` 不算（Q319） |

## 11. 媒体通道（MSG-MEDIA）

实时优先于分辨率（F-PRT-09）：不转码、不攒缓冲，网络差时丢帧。

| 编号 | 约定 |
| --- | --- |
| MSG-MEDIA-01 | 媒体服务用 mediamtx（MIT），在官方 docker compose 里单独一个容器，由面板管理：配置由面板生成，健康状态显示在系统设置·运维，管理接口不对外，WHEP 和 LL-HLS 地址经面板的域名反代（Q172）。对外开放 UDP + TCP 8189（WebRTC）和 UDP 8890（SRT）。v1 不上 CDN（Q171）。 |
| MSG-MEDIA-02 | **H.264 机型**（X1、X2D、H2 等，打印机本身出 RTSP）：面板发 `camera.open`，带一次性的推流地址和令牌；daemon 从打印机拉 RTSP，**原样**（不解码、不转码）推到媒体服务（Q163）。默认用 SRT（UDP，延迟上限 `latencyMs` = 200 毫秒（固定值，Q391），超时的包直接丢）；连不上 SRT 时自动退到 RTSPS（TCP），并在 `command.result.data.transport` 里报实际用的是哪种，界面上标出来（Q170）。仍然是 daemon 往外连（NG-08）。daemon 只往注册时绑定的那个面板的媒体主机推：`camera.open` 里地址的主机名必须和面板地址配置的媒体主机一致，否则回 `rejected`（Q328）。不拦内网地址：面板和 daemon 常在同一个局域网。 |
| MSG-MEDIA-03 | **JPEG 帧机型**（P1、A1，打印机只给一帧帧 JPEG）：daemon 开一条 `wss://<面板>/daemon/v1/frames/{printerId}`，每个二进制帧是一张 JPEG，原样转发；面板再用 WebSocket 发给浏览器。帧率本来就低，带宽不是问题。 |
| MSG-MEDIA-04 | 推流令牌由面板签发，只对这台打印机、这一次推流有效，到期或 `camera.close` 后作废。媒体服务向面板校验令牌（HTTP 鉴权回调），浏览器拉流用的令牌同理。用户被停用或改角色时，面板作废他的观看令牌，并经媒体服务的管理接口踢掉他正在看的会话（API-AUTH-04，Q235）。 |
| MSG-MEDIA-05 | 按需（R-CAM-06）：第一个观众点播放时面板发 `camera.open`；面板从媒体服务查观众数，最后一个离开超过 30 秒（固定值，Q391）后发 `camera.close`。 |
| MSG-MEDIA-06 | 上限（R-CAM-07）：面板在发 `camera.open` 之前检查 CFG-CAM-05（这台的观众数）和 CFG-CAM-06（场地同时推流的打印机数），到了上限就不开流，让这个观众看抓拍。 |
| MSG-MEDIA-07 | 打印机不支持实况、拉流失败时，daemon 回 `command.result { status: "failed", code: "stream_unavailable" }`，面板让观众改看抓拍（R-CAM-02）。 |
| MSG-MEDIA-08 | 看实况和抓拍都只读摄像头，不发任何控制命令（F-PRT-09）。 |

## 11a. 抓拍（MSG-SNAP）

| 编号 | 约定 |
| --- | --- |
| MSG-SNAP-01 | 频率（R-CAM-08）：面板用 `snapshot.mode` 告诉 daemon 每台打印机现在有没有人在看（有人开着概况页或这台的详情，靠 SSE 的订阅知道）。有人看：按 `watchedSeconds`，不分状态；没人看：按 `unwatchedSeconds`。 |
| MSG-SNAP-02 | 第一个人打开时面板发 `snapshot.now`，daemon 立刻补拍一张；打印机报错时也发一次（R-CAM-10）。任务结束时 daemon 自己拍结束照片，走 MSG-HTTP-05（R-CAM-11）。 |
| MSG-SNAP-03 | 正在推流时，daemon 从流里截帧当抓拍，不另外去拍。 |
| MSG-SNAP-04 | 错峰（R-CAM-09）：daemon 把它名下的打印机按 ID 排序，第 k 台的拍照时间偏移 `k × staggerSeconds`，再加 ±10% 随机抖动；`snapshot.now` 同时来了好几台时，也按这个顺序依次拍。 |
| MSG-SNAP-05 | 上传队列：一个 daemon 只有一个抓拍上传队列，一张传完再传下一张，总速率不超过 `uploadKbps`。同一台打印机还没传出去的旧图被新图替换，不补传旧的。 |
| MSG-SNAP-06 | 抓拍和视频都不走控制通道，不会耽误命令（MSG-GEN-03）。 |

## 12. Schema 与代码生成

| 编号 | 约定 |
| --- | --- |
| MSG-SCH-01 | 每种消息一个 JSON Schema（2020-12）文件，放在 `packages/shared/schema/daemon/v1/`，`$id` 带协议主版本。 |
| MSG-SCH-02 | TypeScript 类型用 `json-schema-to-typescript` 生成，Python 用 `datamodel-code-generator` 生成 pydantic v2 模型（Q157）。生成的文件提交进仓库，CI 检查它们和 Schema 一致。 |
| MSG-SCH-03 | 两边收到消息都先按 Schema 校验，不合格的回 `ack` 并记日志，不处理（不让一条坏消息卡住整个队列）。 |
| MSG-SCH-04 | 协议一致性测试：仓库里放一组录好的消息样本（含拓竹真机录的），两边的生成代码都要能解析。 |
