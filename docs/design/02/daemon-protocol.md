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
| MSG-AUTH-05 | 失败时面板用关闭码断开：`4401` 签名不对、`4403` daemon 已吊销、`4409` 同一个 daemon 有了更新的连接（新的顶掉旧的）、`4426` 协议版本不兼容。 |
| MSG-AUTH-06 | daemon 断线后按指数退避重连：1 秒起，翻倍，最长 60 秒，加 ±20% 随机抖动（Q175）。收到 `4403` 不再重连。 |

## 4. 版本协商（MSG-VER）

| 编号 | 约定 |
| --- | --- |
| MSG-VER-01 | 协议版本是 `主.次`，从 `1.0` 开始。次版本只加东西：加可选字段、加消息类型、加命令类型。双方都忽略不认识的字段和消息类型（会回 `ack`，不报错）。 |
| MSG-VER-02 | 面板支持当前主版本和上一个主版本（F-DMN-05）。更老的 daemon 连上来，面板回 `upgrade_required { minProtocolVersion, upgradeCommand }` 后用 `4426` 断开，并给它名下的打印机挂 `DAEMON_UPGRADE` 标记（S-FLG-UPGRADE）。 |
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
| MSG-HB-02 | 面板 3 个周期（45 秒）没收到任何消息，就认为 daemon 断了：它名下空闲的打印机进离线，其他状态（包括待清板、维护中）保持原状态并挂失联（F-DMN-04、S-FLG-LOST、Q208）。 |
| MSG-HB-03 | daemon 连得上面板、但连不上某台打印机，用 `printer.event { kind: "connection.down" }` 报，面板按同样的规则处理那一台（S-PRN-T02、S-FLG-LOST）。 |

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
    "name": "pr-0192f3c1.gcode.3mf",
    "percent": 37,
    "remainingSeconds": 3120,
    "layer": 58, "totalLayers": 210,
    "skippedParts": [3]
  },
  "temps": { "nozzle1": { "current": 220, "target": 220 }, "bed": { "current": 55, "target": 55 }, "chamber": { "current": 31 } },
  "nozzles": [{ "extruder": 1, "diameterMm": 0.4, "flow": "standard" }],
  "trays": [{ "unit": 0, "slot": 0, "label": "AMS 1 · 1", "material": "PLA", "subType": "PLA Basic", "colour": "#FFFFFF", "remainingPercent": 80, "extruders": [1] }],
  "bedType": "textured_pei",
  "storage": [{ "medium": "internal", "present": true, "writable": true, "freeBytes": 1234567890 }],
  "activeErrors": [],
  "controls": { "light": "on", "speedLevel": 2 },
  "camera": { "stream": true, "snapshot": true }
}
```

- `state` 用适配器的标准状态（IF-ADP-03），不是面板的打印机状态；换算规则在面板（IF-ADP-04）。
- `job.jobRef` 是这次的打印任务 ID（E-JOB）；`external: true` 表示不是系统下发的（MSG-JOBREF）。
- 拿不到的字段省略，不填假值。

### MSG-EVT `printer.event`

离散事件。面板靠事件推进状态，用快照对账（Q142）。

```json
{ "printerId": "…", "bootId": "…", "seq": 1043, "kind": "job.started", "jobRef": "0192…", "data": {} }
```

| `kind` | `data` | 面板做什么 |
| --- | --- | --- |
| `connection.up` | | S-PRN-T01 / 去掉失联后对账 |
| `connection.down` | `{ reason }` | S-PRN-T02 / 挂失联 |
| `job.staged` | | 文件已经放到打印机上 |
| `job.started` | | S-ORD-T11、S-PRN-T04 |
| `job.paused` | `{ reason: "USER" \| "ERROR" \| "RUNOUT" }` | S-PRN-T06，R-PRT-03 |
| `job.resumed` | | S-PRN-T07 |
| `job.finished` | | S-ORD-T12、S-PRN-T08 |
| `job.failed` | `{ reason, beforeStart }` | 开打前：S-ORD-T09；开打后：S-ORD-T13 |
| `job.cancelled` | `{ commandId?, beforeStart }` | 带面板停止命令的 ID = 停止被确认（S-FLG-STOPPING 去掉）；没有 = 有人在打印机屏幕上停的。订单去向只看 `beforeStart`：开打前停下 → S-ORD-T09，开打后 → S-ORD-T13 |
| `job.parts_skipped` | `{ partIds }` | 记一条"跳过零件"记录 |
| `external.started` | `{ name }` | S-PRN-T09，R-PRT-11 |
| `external.ended` | `{ result }` | S-PRN-T10 |
| `error.raised` | `{ error: ActiveError }` | 记 E-PERR，挂等待处理（R-PRT-03） |
| `error.cleared` | `{ errorId, clearedBy: "PANEL" \| "DEVICE" \| "UNKNOWN" }` | 更新 E-PERR |
| `storage.low` / `storage.ok` | `{ freeBytes, neededBytes }` | 挂 / 去掉存储不足（F-PRT-11） |
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
                 "accessCodeCipher": "base64…", "keyFingerprint": "…" }] }
```

- 访问码是浏览器用 daemon 公钥加密的密文，面板解不开，只是转交（INV-07）。daemon 在内存里解密，不落盘、不进日志。
- 列表里没有的打印机，daemon 断开它、删掉它的本地状态。
- 公钥指纹对不上（daemon 换过密钥），daemon 回 `printer.event { kind: "connection.down", data: { reason: "access_code_key_mismatch" } }`，面板提示重填访问码。

### MSG-CMD `command`

```json
{ "commandId": "…", "printerId": "…", "kind": "job.start", "expiresAt": "2026-11-04T12:01:00Z", "params": {} }
```

| `kind` | `params` | 有效期（送达） | 类 | 什么上报算"状态变化"，提前解锁（MSG-CMD-LOCK） | 对应 |
| --- | --- | --- | --- | --- | --- |
| `job.start` | `{ jobRef, file: { fileId, sha256, sizeBytes }, plateIndex, bedType, mapping: [{ sliceSlot, extruder, unit, slot }], timelapse }` | 60 秒 | 控制 | 打印机进入准备中、开始打印或报开打前失败；传文件见 MSG-CMD-START | S-ORD-T08 |
| `job.stop` | `{ jobRef }` | 60 秒 | 控制（不受锁限制） | 打印机上报这个 `jobRef` 的任务结束（`job.cancelled`、`job.failed`、`job.finished`）。准备中和打印中都用它；没有单独的撤回命令（Q203、Q207） | R-PRT-04、R-PRT-05 |
| `job.skip_parts` | `{ jobRef, partIds }` | 60 秒 | 控制 | 打印机上报的已跳过列表变了 | F-SUB-07 |
| `error.resolve` | `{ errorId, action }` | 60 秒 | 控制；动作是"停止"时按 `job.stop` 处理，不受锁限制 | 这条报错从上报里消失，或打印机状态变了 | R-PRT-14 |
| `control` | `{ action, args }`，`action` 必须在这台打印机的静态命令清单里（IF-ADP-02） | 30 秒 | 按动作的 `category`：`light` `temperature` `fan` `speed` 是设定值，其余（`pause` `resume` `filament` `dry` `motion`）是控制 | 控制：打印机上报的状态变了；设定值不锁，界面显示上报的值（R-CMD-06） | R-PRT-15 |
| `refresh` | `{}` | 10 秒 | 只读 | — | R-PRT-12（拓竹 = 一次 `pushall`，只读） |
| `camera.open` | H.264 机型：`{ srtUrl, rtspsUrl, publishToken, latencyMs, expiresAt }`；JPEG 帧机型：`{ framesUrl }` | 30 秒 | 只读 | — | MSG-MEDIA、R-CAM-06 |
| `camera.close` | `{}` | 30 秒 | 只读 | — | R-CAM-06 |
| `snapshot.mode` | `{ watched: bool }`：这台打印机现在有没有人在看 | 30 秒 | 只读 | — | R-CAM-08 |
| `snapshot.now` | `{ reason: "FIRST_VIEWER" \| "ERROR" }` | 30 秒 | 只读 | — | R-CAM-08、R-CAM-10 |
| `timelapse.collect` | `{ jobRef }` | 1 小时 | 只读 | — | R-CAM-04 |

**MSG-CMD-TTL**（Q143）：

- 有效期指"必须在这之前开始执行"。`job.start` 下载文件的时间不算在内，开始下载就算开始执行。
- daemon 按 `welcome.serverTime` 算出和面板的时钟差，用面板的时间判断过期。收到时已经过期的，回 `expired`，不执行。这样断线很久之后，积压的旧"开打"不会突然被执行。
- daemon 回 `expired` 是事实（它保证过期的命令永远不再执行）：`job.start` = 下发失败，订单回原位（R-DSP-08）；`job.stop` = 停止未生效，去掉停止请求中（R-CMD-05）。
- 面板自己算出过了 `expiresAt` 但没收到回复，**不算事实**：daemon 可能在过期前已经执行、只是回复还在它的发件箱里（MSG-ENV-03）。这时只把 `status` 记成 `EXPIRED` 方便排查，订单和打印机状态等打印机上报。

**MSG-CMD-LOCK**（R-CMD-01–03、Q205、Q215）：

- 面板只追踪命令送达（`status`），不判断命令"执行了没有"。订单和打印机状态只跟着打印机上报的事件走（P-01）。
- 控制命令发出后锁住这台打印机的其他控制命令（停止和设定值除外）。`unlock_at` = 到达打印机的时间 + CFG-CMD-01（默认 10 秒）。"到达"= daemon 回 `accepted`，也就是命令已经发给了打印机。还没收到任何回复时，`unlock_at` = `expiresAt` + CFG-CMD-01：到了 `expiresAt`，daemon 要么已经开始执行，要么保证永远不执行，所以这个时间之前不会解锁。
- `job.start` 分两段：传文件期间按传输进度锁住，不计时，到 `job.staged` 或 `command.result failed` 为止（上限由 MSG-CMD-START 的重试次数、CFG-CMD-02 和送达期限决定）；`job.staged`（开打指令已发出）之后，`unlock_at` = `job.staged` + CFG-CMD-03（默认 30 秒，估计值，开发驱动时实测）。
- 提前解锁：收到上表"状态变化"那一栏的上报，或 daemon 回 `rejected`、`expired`、`failed`。
- 按时间解锁时界面提示"上一条命令已发出 N 秒，请先看摄像头确认"，要不要再发由人决定，再发是新命令、新 `commandId`（R-CMD-02）。`job.start` 到期还没进准备中，走 R-CMD-04。
- 设定值命令（R-CMD-06）不进锁：`params` 一律是目标值，不用切换或加减；连发以最后一条为准。
- 面板永远不为了"解锁"而发反向命令或再发（INV-16）。同一 `commandId` 从发件箱补投不算再发（MSG-ENV-04）。

**MSG-CMD-START**（传文件，Q205）：

- daemon 收到 `job.start` 开始下载就回 `accepted`；文件放到打印机上、开打指令已发出后发 `job.staged`。
- 下载（MSG-HTTP-02）和 FTPS 上传各自最多试 3 次，间隔 5 秒、15 秒、45 秒；每次尝试的超时是 CFG-CMD-02（默认 3 分钟，经 MSG-CFG 下发）。每次重试覆盖上一次没传完的文件（它在 daemon 的清单里，INV-15），传完核对大小和 SHA-256，对不上也算一次失败。
- 重试都在同一条 `job.start` 里，不产生新命令；**开打指令发出之后不再重试任何一步**。
- 发开打指令之前，daemon 先确认打印机上报的是空闲；在准备中、打印中或别的非空闲状态时回 `rejected`（`code: printer_busy`），什么都不发，按下发失败处理。这样判为没到（R-CMD-04）后重新派单，也不会让同一台打印机打两次。
- 重试用完回 `failed`，按下发失败处理（R-DSP-08）。每次尝试记在 `command.result.data.attempts`：`[{ step: "download" | "upload", error, at }]`。

**MSG-CMD-WL**（INV-14）：daemon 只执行上表里的命令类型，`control` 只执行适配器静态清单里的动作。别的一律 `rejected`。

### MSG-CFG `config.update`

面板设置变了且和 daemon 有关时下发：`{ snapshot: { watchedPrintingSeconds, watchedOtherSeconds, unwatchedSeconds, staggerSeconds, uploadKbps }, transferTimeoutSeconds, discoveryEnabled }`。对应 CFG-CAM-02、03、07、08、09 和 CFG-CMD-02。

### 其他

`ack { id }`、`ping`、`pong`、`token.renew { httpToken, httpTokenExpiresAt }`、`upgrade_required { minProtocolVersion, upgradeCommand }`。

## 9. 任务标识与对账（MSG-JOBREF、MSG-RECON）

| 编号 | 约定 |
| --- | --- |
| MSG-JOBREF-01 | 打印任务的 ID（E-JOB）就是 `jobRef`，一次派单一个。daemon 放到打印机上的文件名带上它：`pr-<jobRef 后 12 位十六进制>.gcode.3mf`。用后 12 位是因为 UUIDv7 的前 8 位是时间戳，大约 65 秒才变一次，一分钟内派的单会撞名；后 12 位是随机部分（Q219）。daemon 清单里仍记完整的 `jobRef`。拓竹的任务名也用这个。 |
| MSG-JOBREF-02 | daemon 在本机留一份清单，记它放进打印机或从打印机下载过的每个文件和对应的 `jobRef`（F-PRT-11）。打印机上正在打的任务对得上清单 = 系统任务；对不上 = 外部任务（`external: true`，F-PRT-08）。 |
| MSG-JOBREF-03 | daemon 只删清单里的文件（INV-15）：任务结束后删它下发的 3mf；延时摄影上传并核对成功后删原文件（F-PRT-10）。 |
| MSG-RECON-01 | 重连后，daemon 先给每台打印机发一份快照，面板拿快照和自己的记录对（R-PRT-07）。 |
| MSG-RECON-02 | 对账表： |

| 面板记录 | 打印机快照 | 处理 |
| --- | --- | --- |
| 已派单 | 在打这个 `jobRef` | 补一条"开始打印"，S-ORD-T11 |
| 已派单 / 打印中 | 空闲，daemon 清单里有这个 `jobRef` 的结束记录 | 按结束记录补事件（打完或失败） |
| 已派单，开打从没见过准备中 | 空闲，而且找不到这个 `jobRef` 的任何痕迹（最后任务名、`pr-<jobRef 后 12 位>` 文件、打完 / 失败 / 已取消状态） | 开打未生效，订单回原位（R-PRT-16、R-DSP-08） |
| 已派单 / 打印中 | 空闲，找不到结束记录，但有痕迹或开打见过准备中 | 挂等待处理，原因"对账不一致"，现场人员判（R-PRT-08） |
| 打印中 | 还在打这个 `jobRef` | 去掉失联，继续 |
| 空闲 | 在打一个对不上的任务 | 外部占用（R-PRT-11） |
| 停止请求中 | 已经停了 | 按停止确认处理 |

daemon 在本机记下每个任务的结束事件（直到面板 `ack`），所以"断线期间打完了"大多数时候能对上；只有 daemon 自己也重启丢了状态时才需要人判。

## 10. HTTP 接口（MSG-HTTP）

都在 `/daemon/v1/` 下，用 `Authorization: Bearer <httpToken>`（MSG-AUTH-04）。

| 编号 | 接口 | 用途 |
| --- | --- | --- |
| MSG-HTTP-01 | `POST /daemon/v1/enroll` | 注册（MSG-ENR），用一次性令牌，不用 `httpToken` |
| MSG-HTTP-02 | `GET /daemon/v1/files/{fileId}?jobRef=` | 下载要打印的文件。只有派给这个 daemon 的打印机、还没结束的任务能下载。daemon 下完核对 SHA-256 |
| MSG-HTTP-03 | `PUT /daemon/v1/snapshots/{printerId}` | 上传最新一张抓拍（`image/jpeg`），请求头 `X-Captured-At`。频率和错峰见 MSG-SNAP。面板只留内存里最新一张（R-CAM-03） |
| MSG-HTTP-04 | `PUT /daemon/v1/timelapses/{jobRef}/{part}` | 上传延时摄影。请求头带 `X-Content-SHA256`；面板写进对象存储、核对大小和哈希，成功才返回 `201`，daemon 收到 `201` 才删打印机里的原文件（F-PRT-10） |
| MSG-HTTP-05 | `PUT /daemon/v1/end-photos/{jobRef}` | 上传结束照片（`image/jpeg`，请求头 `X-Captured-At`）。daemon 在发 `job.finished`、`job.failed`、`job.cancelled` 时自己立刻拍，不等面板命令（R-CAM-11）；不走抓拍的替换队列，失败按退避重试，直到面板返回 `201` |

## 11. 媒体通道（MSG-MEDIA）

实时优先于分辨率（F-PRT-09）：不转码、不攒缓冲，网络差时丢帧。

| 编号 | 约定 |
| --- | --- |
| MSG-MEDIA-01 | 媒体服务用 mediamtx（MIT），在官方 docker compose 里单独一个容器，由面板管理：配置由面板生成，健康状态显示在系统设置·运维，管理接口不对外，WHEP 和 LL-HLS 地址经面板的域名反代（Q172）。对外开放 UDP + TCP 8189（WebRTC）和 UDP 8890（SRT）。v1 不上 CDN（Q171）。 |
| MSG-MEDIA-02 | **H.264 机型**（X1、X2D、H2 等，打印机本身出 RTSP）：面板发 `camera.open`，带一次性的推流地址和令牌；daemon 从打印机拉 RTSP，**原样**（不解码、不转码）推到媒体服务（Q163）。默认用 SRT（UDP，延迟上限 `latencyMs` = CFG-CAM-10，超时的包直接丢）；连不上 SRT 时自动退到 RTSPS（TCP），并在 `command.result.data.transport` 里报实际用的是哪种，界面上标出来（Q170）。仍然是 daemon 往外连（NG-08）。 |
| MSG-MEDIA-03 | **JPEG 帧机型**（P1、A1，打印机只给一帧帧 JPEG）：daemon 开一条 `wss://<面板>/daemon/v1/frames/{printerId}`，每个二进制帧是一张 JPEG，原样转发；面板再用 WebSocket 发给浏览器。帧率本来就低，带宽不是问题。 |
| MSG-MEDIA-04 | 推流令牌由面板签发，只对这台打印机、这一次推流有效，到期或 `camera.close` 后作废。媒体服务向面板校验令牌（HTTP 鉴权回调），浏览器拉流用的令牌同理。 |
| MSG-MEDIA-05 | 按需（R-CAM-06）：第一个观众点播放时面板发 `camera.open`；面板从媒体服务查观众数，最后一个离开超过 CFG-CAM-04 后发 `camera.close`。 |
| MSG-MEDIA-06 | 上限（R-CAM-07）：面板在发 `camera.open` 之前检查 CFG-CAM-05（这台的观众数）和 CFG-CAM-06（场地同时推流的打印机数），到了上限就不开流，让这个观众看抓拍。 |
| MSG-MEDIA-07 | 打印机不支持实况、拉流失败时，daemon 回 `command.result { status: "failed", code: "stream_unavailable" }`，面板让观众改看抓拍（R-CAM-02）。 |
| MSG-MEDIA-08 | 看实况和抓拍都只读摄像头，不发任何控制命令（F-PRT-09）。 |

## 11a. 抓拍（MSG-SNAP）

| 编号 | 约定 |
| --- | --- |
| MSG-SNAP-01 | 频率（R-CAM-08）：面板用 `snapshot.mode` 告诉 daemon 每台打印机现在有没有人在看（有人开着概况页或这台的详情，靠 SSE 的订阅知道）。有人看：打印中按 `watchedPrintingSeconds`，其他状态按 `watchedOtherSeconds`；没人看：按 `unwatchedSeconds`。 |
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
