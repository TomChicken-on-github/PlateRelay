# 2.2 · HTTP 接口约定

> 属于 [文档 2](README.md)。编号 `API-`。每个接口的具体定义在 [openapi.yaml](openapi.yaml)（Q150），本文只写所有接口共同遵守的约定。

## 1. 基本

| 编号 | 约定 |
| --- | --- |
| API-BASE-01 | 前缀 `/api/v1`。前端用的接口就是公开接口，没有"内部接口"（F-API-01）。 |
| API-BASE-02 | 请求和响应都是 JSON（UTF-8），字段名 camelCase。上传文件用 `multipart/form-data`。 |
| API-BASE-03 | 时间是 RFC 3339 的 UTC 字符串，带 `Z`（F-OPS-07）。时长是整数秒，字段名以 `Seconds` 结尾。 |
| API-BASE-04 | ID 是 UUIDv7 字符串。订单另有 `number`（整数），只用来显示和搜索（Q140）。 |
| API-BASE-05 | 枚举值和 [entities.md §2](entities.md#2-枚举) 一致。客户端必须能处理不认识的枚举值（按"未知"显示），这样加新值不算破坏兼容（API-COMPAT-01）。 |
| API-BASE-06 | 服务端只返回用户自己填写的文字（备注、原因、名字），不返回界面文案。界面文案、错误提示都由前端按 `code` 查 i18n（F-UI-02）。 |
| API-BASE-07 | 每个响应带 `X-Request-Id`；请求里带了就沿用，没带就生成。审计日志记下它。 |

## 2. 认证

| 编号 | 约定 |
| --- | --- |
| API-AUTH-01 | 浏览器用会话 Cookie：`pr_session`，`HttpOnly`、`Secure`、`SameSite=Lax`、`Path=/`。库里只存哈希（E-SESS）。 |
| API-AUTH-02 | 防 CSRF（Q153）：所有写请求检查 `Origin`（缺了就看 `Sec-Fetch-Site`），不是本站来源一律 403；再加上 `SameSite=Lax`。不另发 CSRF 令牌。 |
| API-AUTH-03 | 没登录 = 访客。访客只能调声明为 `guest` 的接口，并且要看开关（概况页 CFG-UI-01、实况 CFG-CAM-01）。 |
| API-AUTH-04 | 用户被停用或改了角色，他的会话立刻按新状态生效：停用 = 全部会话作废，改角色 = 下一个请求就用新权限。两种情况服务端都立刻断开这个用户所有的 SSE 连接（API-RT-04）和实况会话（API-CAM-01，WHEP / LL-HLS / WebSocket 令牌作废），让他按新状态重连（Q235）。 |
| API-AUTH-05 | v1 没有个人访问令牌（文档 0 §7）。daemon 不走这套接口，走 [daemon 协议](daemon-protocol.md)。 |
| API-AUTH-06 | 设备令牌（Q182）：第一次成功登录后，服务器给这个浏览器发一个签名的长期 Cookie `pr_device`（`HttpOnly`、`Secure`，1 年），只用来区分设备、放宽 IP 兜底限频，不能用来登录。不收集浏览器指纹。 |

## 3. 权限声明

| 编号 | 约定 |
| --- | --- |
| API-PERM-01 | openapi.yaml 里每个操作都有 `x-permission`，值是文档 1 §2.2 的一个权限节点，或者下面三个特殊值之一。CI 遍历代码里的路由，没有声明的、和 openapi.yaml 不一致的都失败（F-API-02）。 |
| API-PERM-02 | 特殊值：`public` = 谁都能调（登录、注册、初始化向导）；`guest` = 访客也能调，但受开关约束（API-AUTH-03）；`authenticated` = 登录就行（个人设置、自己的通知）。 |
| API-PERM-03 | 一个操作要求"自己的或者有某权限"时写成 `x-permission: [order:cancel:own, order:cancel:any]`，表示满足任意一个即可；`:own` 由服务端按订单所有者判断。 |
| API-PERM-04 | 字段按权限裁剪：schema 里标了 `x-requires: <权限节点>` 的字段，没有这个权限的人收到的响应里**没有这个字段**（不是 `null`）。比如订单的文件名对没有 `order:view:any` 的人隐藏（R-VIS-02）。 |
| API-PERM-05 | 看不到的东西返回 404，不返回 403，免得暴露"它存在"。比如申请者查别人的订单。只有"看得到但不能做"才返回 403。 |
| API-PERM-06 | 被拒绝的写请求也记审计，`result = DENIED`。 |

## 4. 错误

### 4.1 格式

错误一律用 RFC 9457 `application/problem+json`：

```json
{
  "type": "https://platerelay.dev/errors/state_conflict",
  "title": "state_conflict",
  "status": 409,
  "code": "state_conflict",
  "detail": "order is QUEUED, expected PENDING_REVIEW",
  "rule": "S-ORD-T02",
  "params": { "current": "QUEUED" },
  "requestId": "0192f3c1-…"
}
```

- `code`：英文错误码，前端靠它查文案。
- `rule`：违反的是哪条规则，填文档 1 的编号（如 `R-VER-09`）；和具体规则无关时不带。
- `params`：显示文案要用的参数。
- `detail`：给开发者看的英文说明，前端不显示。
- 参数校验失败时多一个 `errors: [{ path, code, params }]`。

### 4.2 错误码

| HTTP | `code` | 什么时候 |
| --- | --- | --- |
| 400 | `bad_request` | 请求格式不对、JSON 解析失败 |
| 401 | `unauthenticated` | 需要登录 |
| 403 | `forbidden` | 看得到但没权限做（API-PERM-05） |
| 403 | `origin_rejected` | CSRF 检查没过（API-AUTH-02） |
| 404 | `not_found` | 不存在或看不到 |
| 409 | `state_conflict` | 预期状态对不上（API-CONC-02），`params.current` 是当前状态 |
| 409 | `version_conflict` | 版本号对不上（API-CONC-01），`params.currentVersion` |
| 409 | `idempotency_key_reused` | 同一个幂等键带了不同的请求体（API-IDEM-04） |
| 409 | `idempotency_in_progress` | 同一个幂等键的上一个请求还没处理完 |
| 409 | `printer_unreachable` | 打印机的 daemon 不在线，命令发不出去 |
| 409 | `printer_flagged` | 打印机挂了阻止派单的标记、在维护中或已停用，不能派单（R-DSP-15，Q233），`params.flags`（如 `["ATTENTION"]`，维护中为 `MAINTENANCE`，停用为 `DISABLED`） |
| 410 | `file_expired` | 文件已过保留期被删（R-PRT-10、R-FIL-01） |
| 413 | `payload_too_large` | 上传超过上限 |
| 415 | `unsupported_file` | 不是 `.gcode.3mf`（R-SUB-01） |
| 422 | `validation_failed` | 参数校验失败，带 `errors` |
| 422 | `captcha_required` | 这次请求需要先过人机验证（R-ACC-02–04；上传见 R-SUB-13） |
| 422 | `rule_violation` | 违反业务规则，带 `rule`（如超过修改次数 `R-VER-09`、超过排队上限 `R-SUB-08`） |
| 428 | `idempotency_key_required` | 写请求没带幂等键 |
| 429 | `rate_limited` | 限频，带 `Retry-After` |
| 500 | `internal` | 服务端错误，只带 `requestId` |
| 503 | `maintenance` | 正在升级迁移 |

新增错误码不算破坏兼容；改已有错误码的含义算。

## 5. 幂等（Q138）

| 编号 | 约定 |
| --- | --- |
| API-IDEM-01 | 所有 `POST`、`PUT`、`PATCH`、`DELETE` 都必须带 `Idempotency-Key` 请求头，没带返回 428。例外：`/auth/login`、`/auth/logout`、`/stream`。 |
| API-IDEM-02 | 键由客户端生成（UUID），一次用户意图一个键；网络重试、用户连点都用同一个键。8–128 个字符。 |
| API-IDEM-03 | 服务端按"调用者 + 方法 + 路由模板 + 键"记下第一次的状态码和响应体，保存 24 小时（E-IDEM）。24 小时内同一个键再来，直接返回原结果，响应头带 `Idempotent-Replayed: true`。 |
| API-IDEM-04 | 同一个键带了不同的请求体（按规范化 JSON 的哈希比较），返回 409 `idempotency_key_reused`。 |
| API-IDEM-05 | 第一次请求还在处理时又来一个，返回 409 `idempotency_in_progress`，客户端稍后重试。 |
| API-IDEM-06 | 5xx 和 429 不记，重试时重新执行；其他 4xx 记下来，重试拿到同样的错误。 |
| API-IDEM-07 | 幂等记录和业务写入在同一个事务里提交，不会出现"做了但没记"或"记了但没做"。 |

## 6. 并发

| 编号 | 约定 |
| --- | --- |
| API-CONC-01 | **编辑冲突**（Q139）：可编辑的资源（E-GEN-04）在响应里带 `version`，保存时请求体必须带上读到的 `version`；不一致返回 409 `version_conflict`，响应里带当前版本的完整内容，前端提示"已被别人修改"。 |
| API-CONC-02 | **状态转换**（Q138）：订单和打印机的转换接口，请求体必须带 `expectedStatus`（订单）或 `expectedState`（打印机），就是界面上看到的状态。服务端加行锁后比较，不一致返回 409 `state_conflict`。这样两个人同时点"通过"和"驳回"，后到的那个会失败，而不是覆盖。 |
| API-CONC-03 | 每个转换接口在 openapi.yaml 里用 `x-transitions` 列出它可能触发的文档 1 转换编号（如 `[S-ORD-T02]`），测试按这张表核对。 |
| API-CONC-04 | 队列相关的写操作（审核通过、派单、拖拽、修改后退、重打）在同一把排队锁下执行，保证排序值不打架。 |

## 7. 分页、排序、筛选

| 编号 | 约定 |
| --- | --- |
| API-PAGE-01 | 列表用游标分页：`?limit=50&cursor=…`，响应 `{ items: [...], nextCursor: string \| null }`。`limit` 默认 50，最大 200。 |
| API-PAGE-02 | 每个列表接口的排序是固定的（在 openapi.yaml 里写明），不开放任意排序。游标是不透明字符串。 |
| API-PAGE-03 | 筛选用查询参数，多选用逗号分隔：`?status=QUEUED,DISPATCHED`。 |
| API-PAGE-04 | 队列（`GET /queue`）和概况（`GET /overview`）不分页，一次返回全部，因为它们的大小受打印机和订单数量自然限制。 |

## 8. 打印机命令是异步的

| 编号 | 约定 |
| --- | --- |
| API-ASYNC-01 | 会发命令给打印机的接口（派单、停止、处理报错、设备控制、跳过零件、刷新）只负责"记下请求并发出命令"，返回 `202 Accepted` 和命令 ID（E-CMD）。 |
| API-ASYNC-02 | 返回 202 时，业务状态不变，不进入打印机确认后才能进的状态（P-01）。真正的结果通过实时推送（API-RT）和打印机上报到达。 |
| API-ASYNC-04 | 没有命令锁，接口不因"上一条命令还没结果"拒绝（Q243）。按钮能不能点由前端按打印机上报的状态和 IF-ADP-05 决定，服务端按同一张表校验，不符返回 409 `state_conflict`。点过的按钮转圈是纯前端行为（最多 10 秒，R-CMD-01），不进数据库。daemon 回报失败时推 `command.updated`，前端原样显示固件给的原因（R-PRT-15）。`pendingCommand`、`pendingStop` 已删除（Q243）。 |
| API-ASYNC-03 | 打印机的 daemon 不在线时直接返回 409 `printer_unreachable`，不排队等它上线；命令有效期见 MSG-CMD-TTL。 |

## 9. 实时推送

| 编号 | 约定 |
| --- | --- |
| API-RT-01 | 浏览器用一条 Server-Sent Events 连接：`GET /api/v1/stream`（Q151、Q161）。只需要服务端往下推，SSE 自带断线重连，过代理也简单。 |
| API-RT-02 | 事件类型：`printer.updated`、`order.updated`、`queue.changed`、`todo.changed`、`notification.created`、`command.updated`、`file.checked`、`snapshot.updated`、`resync`。`snapshot.updated` 只带 `{ printerId, capturedAt }`，不带图片。 |
| API-RT-03 | 事件内容是变化后的那个资源的完整视图（和对应 GET 接口返回的一样，按权限裁剪过），不是差量，前端直接替换。`queue.changed` 和 `todo.changed` 只是提示，前端收到后重新拉列表。 |
| API-RT-04 | 服务端按连接者的权限过滤：申请者只收到概况、自己的订单和自己的通知；访客只收到概况里的打印机。权限按连接时算；用户被停用或改角色时服务端立刻断开他的连接（API-AUTH-04，Q235）。 |
| API-RT-05 | 同一台打印机的 `printer.updated` 最多每秒一条（Q142）。 |
| API-RT-06 | 每个事件带递增的 `id`。断线重连时浏览器带 `Last-Event-ID`，服务端补发最近 5 分钟内的，按重连时的权限过滤（不是断线前的，Q235）；超过了发一个 `resync`，前端重新拉全部数据。 |

## 10. 文件和摄像头

| 编号 | 约定 |
| --- | --- |
| API-FILE-01 | 上传：`POST /files`，`multipart/form-data`，单个文件上限默认 200 MB，部署时可以用环境变量改（Q155）。返回文件 ID，解析和安全校验在后台跑（F-SUB-02），完成后推 `file.checked`，也可以轮询 `GET /files/{id}/check`。 |
| API-FILE-02 | 下载（模型文件、预览图、入库照片、延时摄影）：接口返回 `302` 跳到对象存储的短期签名链接，有效 5 分钟（Q154）；对象存储桶不公开。 |
| API-FILE-03 | 看延时摄影每次都记审计（F-PRT-10）。 |
| API-CAM-01 | 实况：`POST /printers/{id}/camera/session` 申请观看。H.264 机型按播放方式（CFG-CAM-11）返回 WebRTC（WHEP）地址、LL-HLS 地址或两者（"自动"时前端先试 WebRTC，不通换 LL-HLS），带一次性令牌；JPEG 帧机型返回一个 WebSocket 地址（Q162、Q173、MSG-MEDIA）。播放器：WHEP 用 mediamtx 自带的读取脚本，LL-HLS 用 hls.js。浏览器关掉播放器或页面时连接断开，面板据此算观众数。用户被停用或改角色时，他手上的观看令牌立刻作废、连接断开（API-AUTH-04，Q235）。 |
| API-CAM-02 | 拿不到实况时返回 409：`stream_unavailable`（机型不支持、断流、访客且开关关）或 `camera_limit`（到了 CFG-CAM-05 / CFG-CAM-06 的上限，R-CAM-07），前端改看抓拍（R-CAM-02）。 |
| API-CAM-03 | 抓拍：`GET /printers/{id}/camera/snapshot`，返回内存里最新一张 JPEG，响应头 `X-Captured-At` 和 `ETag`；带 `If-None-Match` 且没变时返回 304。前端收到 SSE 的 `snapshot.updated` 才去取，不轮询（Q166）。 |

## 11. 限频

| 编号 | 对象 | 限制 |
| --- | --- | --- |
| API-RATE-01 | 登录 | 按用户名：连续错 3 次后要人机验证，再错等待时间翻倍，最长 15 分钟（R-ACC-04）。按 IP 只做兜底：每分钟 300 次；带有效设备令牌的不计入（Q182） |
| API-RATE-02 | 发验证码 | CFG-ACC-02；短信一律先过人机验证（R-ACC-02），邮件按 CFG-ACC-03（R-ACC-03） |
| API-RATE-03 | 刷新打印机状态 | 每台打印机 CFG-PRT-03（R-PRT-12） |
| API-RATE-04 | 上传 | 每人每分钟 10 个 |
| API-RATE-05 | 签发取件码 | 每单每分钟 3 次 |

超限返回 429 和 `Retry-After`。

## 12. 兼容规则

| 编号 | 约定 |
| --- | --- |
| API-COMPAT-01 | `v1` 里只做不破坏兼容的改动：加接口、加可选的请求字段、加响应字段、加枚举值、加错误码。 |
| API-COMPAT-02 | 破坏兼容的改动（删字段、改类型、改含义、把可选改成必填）只能放进 `/api/v2`，并且 `v1` 至少再保留一个大版本。 |
| API-COMPAT-03 | 要废弃的接口在 openapi.yaml 里标 `deprecated: true`，响应带 `Deprecation` 头。 |
| API-COMPAT-04 | CI 拿上一个发布版的 openapi.yaml 和当前的比较，发现破坏兼容的改动就失败。 |

## 13. 资源分组

openapi.yaml 按下面的分组（tag）组织：

| 分组 | 路径 | 对应文档 1 |
| --- | --- | --- |
| auth | `/auth/*`、`/setup` | §2、R-ACC |
| me | `/me/*` | §9.3 |
| files | `/files/*` | R-SUB |
| orders | `/orders/*` | §3、R-SUB、R-REV、R-VER、R-CAN、R-NTE |
| queue | `/queue/*` | R-QUE、R-DSP |
| printers | `/printers/*` | §4、R-PRT、R-CAM |
| pickup | `/pickup/*` | R-PCK |
| overview | `/overview`、`/resources`、`/todo` | F-UI-01、R-SUB-11 |
| catalog | `/catalog/*` | §9.2 耗材目录 |
| admin | `/users/*`、`/invites/*`、`/daemons/*`、`/form`、`/settings/*`、`/audit`、`/archive` | §9 |
| notifications | `/notifications/*` | R-NTF |
| stream | `/stream` | API-RT |
