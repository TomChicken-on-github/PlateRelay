# 2.1 · 实体与字段

> 属于 [文档 2](README.md)。实体编号 `E-`。业务含义看文档 1，这里只定存什么、怎么约束。

## 1. 通用约定

| 编号 | 约定 |
| --- | --- |
| E-GEN-01 | 主键一律 UUIDv7（Q140），列名 `id`。按时间有序，可以直接按主键排序。 |
| E-GEN-02 | 时间一律 `timestamptz`，存 UTC（F-OPS-07）。显示和按天统计用"组织时区"（系统设置·通用）。列名以 `_at` 结尾。 |
| E-GEN-03 | 时长用整数秒，列名以 `_seconds` 结尾；暂停累计这类需要精度的用毫秒，以 `_ms` 结尾。 |
| E-GEN-04 | 可编辑的实体（打印机、设置分区、申请表单、耗材目录行、用户）带 `version integer`，每次保存加 1。保存时必须带上读到的版本号，不一致返回 409（Q139，API-CONC-01）。 |
| E-GEN-05 | 订单和打印机的状态转换不用 `version`，用行锁 + "预期的当前状态"（Q138，API-CONC-02）。 |
| E-GEN-06 | 不做软删除列。会被引用的东西（用户、打印机、daemon）用"停用 / 吊销"表示不再使用，不真删；只有从没被引用过的才能真删（Q158）。 |
| E-GEN-07 | 枚举用 PostgreSQL enum，值用英文大写（F-UI-02），和文档 1 的 `S-` 编号一一对应（§2）。 |
| E-GEN-08 | 凭据（访问码、令牌、私钥、验证码）只存哈希或密文，不存明文；任何接口都不返回（INV-07）。 |
| E-GEN-09 | 文件内容放对象存储（F-OPS-01），表里只存对象键，列名以 `_key` 结尾。 |
| E-GEN-10 | 只追加的表（审计日志、订单记录）用数据库触发器拒绝 UPDATE 和 DELETE（INV-06）。 |

## 2. 枚举

### 2.1 订单状态 `order_status`

| 值 | 文档 1 |
| --- | --- |
| `PENDING_REVIEW` | S-ORD-PENDING |
| `REJECTED` | S-ORD-REJECTED |
| `QUEUED` | S-ORD-QUEUED |
| `DISPATCHED` | S-ORD-DISPATCHED |
| `PRINTING` | S-ORD-PRINTING |
| `FAILED` | S-ORD-FAILED |
| `PRINTED` | S-ORD-PRINTED |
| `READY` | S-ORD-READY |
| `COMPLETED` | S-ORD-COMPLETED |
| `CANCELLED` | S-ORD-CANCELLED |
| `DISPOSED` | S-ORD-DISPOSED |

### 2.2 打印机状态 `printer_state` 和标记 `printer_flag`

| 状态值 | 文档 1 | | 标记值 | 文档 1 |
| --- | --- | --- | --- | --- |
| `OFFLINE` | S-PRN-OFFLINE | | `ATTENTION` | S-FLG-ATTENTION |
| `IDLE` | S-PRN-IDLE | | `STOPPING` | S-FLG-STOPPING |
| `PREPARING` | S-PRN-PREPARING | | `LOST` | S-FLG-LOST |
| `PRINTING` | S-PRN-PRINTING | | `STORAGE_LOW` | S-FLG-STORAGE |
| `PAUSED` | S-PRN-PAUSED | | `DAEMON_UPGRADE` | S-FLG-UPGRADE |
| `CLEARING_REQUIRED` | S-PRN-CLEARING | | | |
| `EXTERNAL` | S-PRN-EXTERNAL | | | |
| `MAINTENANCE` | S-PRN-MAINT | | | |

### 2.3 其他枚举

| 枚举 | 值 | 用在 |
| --- | --- | --- |
| `role` | `APPLICANT` `STAFF` `ADMIN` | E-USER（Q95；访客不是角色，是没登录） |
| `pause_reason` | `USER` `ERROR` `RUNOUT` | E-PRN（R-PRT-03） |
| `attention_reason` | `ERROR` `RUNOUT` `START_FAILED` `RECONCILE_MISMATCH` `LATE_START` `UNCLEARED_START` | E-PFLAG（S-FLG-ATTENTION） |
| `version_kind` | `SUBMIT` `REPLACE` `REVISION` `RESTORE` | E-VER（R-VER-01、02、06） |
| `version_state` | `PENDING` `APPROVED` `REJECTED` `WITHDRAWN` `REPLACED` | E-VER |
| `colour_pref` | `EXACT` `SIMILAR` `ANY` | E-ORD（一致 / 相近 / 无所谓） |
| `process_node` | `SUBMIT` `REVIEW` `QUEUE` `PRINT` `STORE` `PICKUP` | E-REC（Q146） |
| `job_phase` | `TRANSFERRING` `PREPARING` `PRINTING` `PAUSED` `ENDED` | E-JOB（文档 1 §4A，S-JOB-*） |
| `job_outcome` | `SEND_FAILED` `START_FAILED` `STOPPED_BEFORE_START` `FAILED` `FINISHED` | E-JOB |
| `command_status` | `QUEUED` `SENT` `ACCEPTED` `REJECTED` `EXPIRED` `FAILED` `DONE` | E-CMD（投递进度） |
| `command_class` | `CONTROL` `SETPOINT` `READ` | E-CMD（R-CMD 控制命令 / 设定值命令 / 只读命令） |
| `actor_type` | `USER` `SYSTEM` `DAEMON` `PRINTER` | E-REC、E-AUD |

## 3. 实体总表

| 编号 | 表 | 一句话 |
| --- | --- | --- |
| E-USER | `users` | 本地账户，一个角色 |
| E-EXTID | `external_identities` | 外部登录（OIDC）绑定 |
| E-SESS | `sessions` | 浏览器会话 |
| E-INV | `invite_codes` | 邀请码 |
| E-OTP | `verification_codes` | 短信 / 邮件验证码 |
| E-DMN | `daemons` | 一个 daemon 和它的公钥 |
| E-ENR | `daemon_enrollments` | 一次性注册令牌 |
| E-PRN | `printers` | 一台打印机的配置和业务状态 |
| E-PFLAG | `printer_flags` | 打印机身上的标记 |
| E-PLIVE | `printer_live` | 最新一份状态快照 |
| E-PERR | `printer_errors` | 打印机报过的错和处理结果 |
| E-FILE | `files` | 上传的 `.gcode.3mf` |
| E-CHK | `file_checks` | 文件解析和安全校验结果 |
| E-ORD | `orders` | 订单（一盘） |
| E-VER | `order_versions` | 订单的不可变文件版本 |
| E-JOB | `print_jobs` | 打印任务：一次派单产生的一次打印尝试（含映射） |
| E-CMD | `daemon_commands` | 发给 daemon 的命令 |
| E-PCK | `pickup_codes` | 取件码 |
| E-REC | `order_records` | 订单时间线记录 |
| E-AUD | `audit_log` | 审计日志 |
| E-SET | `settings` | 系统设置，每个分区一行 |
| E-FORM | `form_versions` | 申请表单的版本 |
| E-CAT | `filament_catalog` | 耗材目录的库存行和自动行设置 |
| E-NTF | `notifications` | 站内通知 |
| E-NDLV | `notification_deliveries` | 邮件、飞书的投递记录 |
| E-NPREF | `notification_prefs` | 个人通知设置 |
| E-TL | `timelapses` | 延时摄影 |
| E-IDEM | `idempotency_keys` | 幂等记录 |
| E-ARC | `archives` | 归档本期的记录 |

不建表的东西：

- **待办**：从订单状态、打印机状态和标记实时算出来，不存。
- **自动发现到的打印机**：daemon 每次上报完整列表，面板只放内存（F-PRT-12）。
- **定时抓拍**：每台打印机只留内存里最新一张，不长期保存（R-CAM-03）。
- **权限矩阵**：写在代码里，以文档 1 §2.2 为准（Q81、Q95）。

## 4. 账户

### E-USER `users`

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid | |
| `username` | text | 登录名，大小写不敏感唯一 |
| `display_name` | text | |
| `email` | text? | 大小写不敏感唯一；验证过才写 `email_verified_at` |
| `email_verified_at` | timestamptz? | F-ACC-02 |
| `phone` | text? | E.164 格式，唯一 |
| `password_hash` | text? | argon2id；只用外部登录的账户为空 |
| `role` | role | 默认 `APPLICANT` |
| `avatar_key` | text? | |
| `locale` | text | `zh-CN` / `en`，默认跟系统设置 |
| `disabled_at` | timestamptz? | 停用后会话全部作废 |
| `version` | int | E-GEN-04 |
| `created_at` | timestamptz | |

- 最后一个没停用的 `ADMIN` 不能改角色、不能停用（INV-13）：在同一个事务里锁住所有管理员行再检查。

### E-EXTID `external_identities`

`id`、`user_id`、`issuer`、`subject`、`created_at`。按 `issuer + subject` 唯一，不按邮箱匹配。

### E-SESS `sessions`

`token_hash`（主键，SHA-256）、`user_id`、`created_at`、`expires_at`、`last_seen_at`、`ip`、`user_agent`。Cookie 里是原始令牌，库里只有哈希（E-GEN-08）。

### E-INV `invite_codes`

`id`、`code_hash`、`label`、`max_uses`（0 = 不限）、`used_count`、`expires_at?`、`created_by`、`created_at`、`revoked_at?`。邀请码只注册为 `APPLICANT`（Q178），要别的角色由管理员事后改。

### E-OTP `verification_codes`

`id`、`channel`（`SMS` / `EMAIL`）、`target_hash`、`purpose`（`REGISTER` / `VERIFY_EMAIL` / `RESET_PASSWORD`）、`code_hash`、`expires_at`、`attempts`、`consumed_at?`、`created_at`、`ip`。限频按 CFG-ACC-02 查这张表计数。

## 5. daemon 与打印机

### E-DMN `daemons`

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid | |
| `name` | text | 管理员起的名字 |
| `public_key` | text | RSA-3072 公钥，SPKI DER 的 base64（F-DMN-02） |
| `key_fingerprint` | text | 公钥 SHA-256，唯一 |
| `protocol_version` | text | 最近一次握手报的协议版本（F-DMN-05） |
| `daemon_version` | text | |
| `platform` | text | `linux` / `windows` / `docker`（F-DMN-06） |
| `last_seen_at` | timestamptz? | |
| `revoked_at` | timestamptz? | 吊销后拒绝连接；它名下的打印机挂失联 |
| `key_alert_at` | timestamptz? | 疑似私钥泄露告警的时间（R-OPS-02，Q238）：10 分钟内被不同 IP 顶掉 3 次及以上时记下；管理员确认或吊销后清空。被顶掉的记录（时间、新旧 IP）写审计 |
| `created_by` | uuid | |
| `created_at` | timestamptz | |
| `version` | int | |

"在线"不存，看内存里有没有它的连接。

### E-ENR `daemon_enrollments`

`id`、`token_hash`、`expires_at`（签发后 15 分钟）、`used_at?`、`daemon_id?`（用掉后填）、`created_by`、`created_at`。用过即作废（F-DMN-01）。

### E-PRN `printers`

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid | 驱动之外只认它（INV-08） |
| `brand` | text | `bambu` |
| `serial` | text | `brand + serial` 唯一（INV-08） |
| `name` | text | 唯一 |
| `daemon_id` | uuid | 唯一认领它的 daemon（INV-09） |
| `host` | text | IP 或主机名；同序列号换了 IP 自动更新并记审计（F-PRT-12） |
| `model_id` | text? | 打印机上报，不手填 |
| `model_name` | text? | 打印机上报 |
| `capabilities` | jsonb | 适配器的能力声明和静态命令清单（IF-ADP-02），连上时更新 |
| `open_to_applicants` | bool | 开放给选手，新加的默认关 |
| `state` | printer_state | 准备中、打印中、暂停中、待清板，以及任务结束回到空闲，只能经打印任务映射表改（文档 1 §4A） |
| `state_since` | timestamptz | |
| `pause_reason` | pause_reason? | 只在 `PAUSED` 时有值 |
| `maintenance_reason` | text? | 只在 `MAINTENANCE` 时有值（Q148） |
| `current_job_id` | uuid? | 正在占用它的打印任务；`CLEARING_REQUIRED` 时指向刚结束的那个 |
| `bed_type` | text? | 打印机报的板型；报不了时为空（R-DSP-09） |
| `access_code_cipher` | text? | 浏览器用 daemon 公钥加密的访问码（RSA-OAEP），面板解不开 |
| `access_code_key_fingerprint` | text? | 用哪把公钥加密的；和 daemon 公钥对不上时要重填 |
| `access_code_set_at` | timestamptz? | |
| `starred` | bool | 概况页置顶 |
| `disabled_at` | timestamptz? | 停用时间（R-PRT-20，Q229）。有值时概况页、派单都不显示，不在 MSG-ASSIGN 列表里；记录都保留，清空即重新启用 |
| `version` | int | E-GEN-04；只管配置字段，状态字段走 E-GEN-05 |
| `created_at` | timestamptz | |

约束：

- `state = 'PAUSED'` ⇔ `pause_reason` 不为空；`state = 'MAINTENANCE'` ⇔ `maintenance_reason` 不为空。
- 移到别的 daemon 只能由管理员显式操作（INV-09、F-PRT-12）。

### E-PFLAG `printer_flags`

`printer_id`、`flag`、`since`、`reason`（`attention_reason`，只给 `ATTENTION`）、`data jsonb`、`by?`。主键 `(printer_id, flag)`，同一种标记同时只挂一个。

`data` 的内容：

| 标记 | `data` |
| --- | --- |
| `STOPPING` | `{ commandId, requestedBy, reasonText }` |
| `ATTENTION` | `{ jobId?, errorId? }`，对账不一致时 `{ lastKnown, reported }`。`jobId` 是挂上它时的当前任务（迟到的开打是那个迟到的任务）；任务结束时按它去掉 `ERROR`、`RUNOUT`，`LATE_START` 在迟到的任务结束时去掉（文档 1 §4A，Q226） |
| `STORAGE_LOW` | `{ freeBytes, neededBytes }` |
| `DAEMON_UPGRADE` | `{ daemonVersion, protocolVersion }` |

### E-PLIVE `printer_live`

`printer_id`（主键）、`snapshot jsonb`（MSG-SNAPSHOT 的 `body`）、`seq`、`reported_at`。每次快照覆盖，不留历史，不记审计。面板重启后用来先显示最后已知的状态。

### E-PERR `printer_errors`

| 列 | 说明 |
| --- | --- |
| `id` | |
| `printer_id`、`job_id?` | 报错时在打哪个任务 |
| `error_id` | 驱动生成的本次报错 ID；`(printer_id, error_id)` 唯一 |
| `channel`、`vendor_code`、`severity`、`module?`、`message?`、`help_url?` | 驱动草稿 §6.2 |
| `actions` | jsonb，可选的标准动作（R-PRT-14） |
| `raised_at`、`cleared_at?` | |
| `cleared_by` | `PANEL` / `DEVICE` / `UNKNOWN` |
| `resolved_action?`、`resolved_by?`、`command_id?` | 面板上谁点了哪个选项 |

## 6. 文件与订单

### E-FILE `files`

`id`、`sha256`、`object_key`、`file_name`、`size_bytes`、`uploaded_by`、`uploaded_at`、`submitted_at?`、`purged_at?`。

- 过了 CFG-SUB-07（默认 2 小时）没提交的删掉（R-SUB-10，`submitted_at` 为空且超时）；用户被停用时他没提交的立刻删（R-ACC-05）。
- 上传前数这个人没提交、而且校验没被拒的文件，到了 CFG-SUB-08 − 1 个就要人机验证（R-SUB-13，Q236）。
- 订单进终态后过了保留期删文件，写 `purged_at`；预览图和元数据留着（R-FIL-01）。
- 同一个用户上传同一个哈希时复用已有行；不同用户之间不共用，免得能推断出别人传过什么（Q179）。

### E-CHK `file_checks`

| 列 | 说明 |
| --- | --- |
| `file_id` | 主键 |
| `status` | `QUEUED` / `RUNNING` / `DONE` / `ERROR` |
| `parser_version` | 解析器版本，解析逻辑变了能看出来 |
| `plates` | jsonb，每盘的元数据：盘号、名字、机型、喷嘴、耗材、时长、克数、零件、预览图键（IF-PARSE） |
| `findings` | jsonb，校验发现：`{ check, severity, code, detail }[]`；`check` 是四项之一（F-SUB-02） |
| `verdict` | `PASS` / `WARN` / `REJECT` |
| `limits` | jsonb，校验时用的限值（适配器限值收紧后） |
| `finished_at` | |

### E-ORD `orders`

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid | Q140 |
| `number` | bigint | 给人看的编号，全局递增，`#1234`；归档也不重置，不复用 |
| `owner_id` | uuid | |
| `status` | order_status | 存在订单上，不在读取时推算；已派单、打印中、失败、待入库只能经打印任务映射表改（文档 1 §4A） |
| `sort_key` | bigint? | 排序值（INV-10）。第一次审核通过时分配（R-REV-01）；离开队列也保留，重打、开打前停止、下发失败都用它回原位 |
| `active_version_id` | uuid | 会被打印的版本 |
| `pending_version_id` | uuid? | 等重审的版本；只在 `PENDING_REVIEW` 且 `sort_key` 不为空时有值 |
| `colour_pref` | colour_pref | |
| `bed_type` | text? | 申请者自选的板型（CFG-QUE-09）；空 = 按切片 |
| `form_version_id` | uuid | 提交时的表单版本 |
| `answers` | jsonb | 表单答案快照：`{ fieldId, label, type, value }[]` |
| `revision_count` | int | 已用修改次数（R-VER-09） |
| `model_switch_count` | int | 已用换机型次数（R-VER-10） |
| `printer_id` | uuid? | 当前所在的打印机（已派单到待入库期间） |
| `current_job_id` | uuid? | 当前的打印任务 |
| `bypassed_since` | timestamptz? | 第一次被后面的单越过的时间（R-QUE-03）；派单时清空 |
| `storage_slot` | text? | 入库暂存位（R-PCK-01） |
| `store_photo_key` | text? | 入库照片 |
| `submitted_at` | timestamptz | |
| `closed_at` | timestamptz? | 进终态或进失败的时间；文件保留期从这里算（R-FIL-01、R-FIL-02）。重打时清空 |
| `archived_at` | timestamptz? | 归档本期时留在失败的订单记下归档时间；有值就不能重打（R-ARC-02、R-PRT-09） |
| `reprint_declined_at`、`reprint_declined_by`、`reprint_declined_reason` | timestamptz?、uuid?、text? | 现场人员点了"不重打，请选手重新提交"（R-PRT-18，Q224）。有值时不能重打、不进现场人员待办；管理员撤销时三列一起清空（R-PRT-19）。只在失败时有值 |
| `files_purged_at` | timestamptz? | 文件已删除；之后不能重打（R-PRT-10） |

约束：

- 冻结 = `status = 'PENDING_REVIEW' and sort_key is not null`，不另存一列。
- `pending_version_id` 不为空 ⇒ `status = 'PENDING_REVIEW'`。
- 两个版本指针都只能指向本订单的版本（复合外键 `(version_id, order_id)`）。
- 队列索引：`(status, sort_key)`。

**排序值的分配**（Q159）：用 `bigint`，相邻两单之间留 2^20 的间隔。插到两单之间取中点；没有空隙时在排队锁里把整个队列重新编号，重新编号只改数字、不改先后顺序，记一条审计。拖拽（R-QUE-02）和后退 N 位（R-VER-12）都只改 `sort_key`。

谁在什么时候做了什么（审核人、取消人、核销人……）不放订单表，查 E-REC。

### E-VER `order_versions`

| 列 | 说明 |
| --- | --- |
| `id` | |
| `order_id`、`n` | `n` 从 1 开始；`(order_id, n)` 唯一。界面显示"第 N 版" |
| `kind` | `SUBMIT` / `REPLACE`（第一次审核前替换，R-VER-01）/ `REVISION` / `RESTORE`（R-VER-06） |
| `restored_from_id?` | `RESTORE` 时指向被恢复的版本；只能是曾经 `APPROVED` 的版本（R-VER-06） |
| `state` | `PENDING` / `APPROVED` / `REJECTED` / `WITHDRAWN` / `REPLACED` |
| `file_id`、`plate_index`、`plate_count`、`plate_name` | 一单一盘（INV-03） |
| `model_id`、`model_name`、`nozzles`、`filaments`、`print_seconds`、`weight_grams` | 从 E-CHK 复制过来，之后不再变 |
| `thumbnail_key`、`parts`、`parts_top_key`、`parts_pick_key` | 预览图和跳过零件用的零件信息 |
| `delta_seconds?`、`places_back?` | 提交这个版本时算好的时长差和后退位数（R-VER-07）；`places_back = -1` 表示排到队尾 |
| `counted` | 是否计入修改次数；撤回修改时退回（R-VER-05） |
| `model_switch` | 是否算一次换机型（R-VER-10） |
| `created_at` | |
| `decided_by?`、`decided_at?`、`reason?` | 审核结果；只能写一次 |

- 不可变（INV-04）：触发器只允许把 `state` 从 `PENDING` 改成别的值一次，并同时写 `decided_*`、`reason`；不允许删除。
- 版本里的文件被删（E-FILE `purged_at`）不影响版本行。

### E-JOB `print_jobs`

派单是动作，打印任务是它产生的东西（Q218）：一次派单新建一个任务 = 把某个版本发到某台打印机的一次尝试。重打、开打前停止或下发失败后再派，都是新的一行，旧的留着。打印机事件先落到当前任务上，任务的阶段变化按文档 1 §4A.2 的映射表在同一个事务里推动订单和打印机；订单和打印机的那几个状态不能绕过映射表直接写。

| 列 | 说明 |
| --- | --- |
| `id` | 也是发给 daemon 的任务标识 `jobRef`（MSG-CMD-START） |
| `attempt` | 这个订单的第几次打印，从 1 开始；订单详情的"打印记录"显示"第 N 次" |
| `phase` | `job_phase`（文档 1 §4A.1） |
| `phase_since` | |
| `order_id`、`version_id`、`printer_id` | |
| `dispatched_by`、`dispatched_at` | |
| `suggested` | 是不是系统建议的那一单（R-DSP-02） |
| `bypassed_order_ids` | uuid[]，这次越过的排队中订单（R-DSP-02） |
| `bed_type` | 这次确认的板型（R-DSP-09） |
| `mapping` | jsonb，见下 |
| `mapping_settings_version` | 当时"映射"分区的设置版本（R-DSP-13） |
| `safety_limits` | jsonb，复核时用的限值（R-DSP-04） |
| `start_command_id` | E-CMD |
| `prepared_at?` | 打印机自己第一次报这个 jobRef 准备中的时间（`job.staged` 不算）。不是阶段，只给 R-CMD-04 和对账（R-PRT-16、MSG-RECON）判断"开打到没到"用（Q223） |
| `started_at?`、`ended_at?` | 打印机报的开始和结束 |
| `outcome?` | `job_outcome`，`phase = ENDED` 时有值。这个任务上有停止命令且打印机报告没开打就停下 → `STOPPED_BEFORE_START`，优先于开打失败的原因（Q214）。"开打可能没到"时现场人员发的停止、传文件时被停（daemon 回 `beforeStart: true`）也走这条（R-CMD-04、MSG-CMD-START）。R-PRT-16 自动判的 → `SEND_FAILED`。结束后不再改，打印机迟到的开打不挂回（R-PRT-17） |
| `paused_ms` | 暂停累计 |
| `skipped_parts` | int[]，已跳过的零件 ID，以打印机上报为准（R-SKP-04）；重打是新任务，从空开始（R-SKP-07） |
| `end_photo_key?`、`end_photo_at?` | 结束照片（R-CAM-11）：打完、失败或停止时拍的一张，永久保留 |
| `fail_reason?` | 失败原因：停止时选的原因，或打印机报的原因 |

约束：`phase = 'ENDED'` ⇔ `outcome` 不为空。

索引：`(printer_id, dispatched_at desc, id desc)`，给打印机详情的"打印记录"翻页用（Q221）。

`mapping` 的结构：

```json
{
  "entries": [
    {
      "sliceSlot": 1,
      "extruder": 1,
      "tray": { "unit": 0, "slot": 2 },
      "suggested": { "unit": 0, "slot": 2 },
      "checks": [{ "rule": "COLOUR", "result": "WARN", "deltaE": 7.4 }],
      "mismatchReason": "相近色可接受",
      "reasonVisibleToApplicant": true
    }
  ]
}
```

约束：

- 一台打印机同一时间最多一个没结束的打印任务：`unique (printer_id) where phase <> 'ENDED'`（INV-02）。
- 一个订单同一时间最多一个没结束的打印任务：`unique (order_id) where phase <> 'ENDED'`。

### E-CMD `daemon_commands`

| 列 | 说明 |
| --- | --- |
| `id` | 命令 ID，也是协议里的 `commandId`（Q143） |
| `daemon_id`、`printer_id?`、`job_id?` | 和任务有关的命令（开打、停止、跳过零件、处理报错）挂在任务上；锁也按任务记（Q218） |
| `kind` | MSG-CMD 的类型，如 `job.start` |
| `class` | `CONTROL` / `SETPOINT` / `READ`，由 `kind` 决定；`control` 按动作的 `category` 决定（MSG-CMD 表） |
| `payload` | jsonb，不含任何凭据 |
| `requested_by?` | 用户；系统发起的为空 |
| `created_at`、`expires_at` | 有效期见 MSG-CMD-TTL |
| `status` | `QUEUED` → `SENT` → `ACCEPTED` / `REJECTED` / `EXPIRED` / `FAILED` → `DONE`：投递进度，daemon 回什么记什么 |
| `unlock_at?` | 控制命令的解锁时间（R-CMD-02，MSG-CMD-LOCK）：到达打印机 + CFG-CMD-01；还没收到回复时 = `expires_at` + CFG-CMD-01。`job.start` 传文件期间为空（按进度锁住），`job.staged` 后 = 那一刻 + CFG-CMD-03 |
| `unlocked_at?`、`unlocked_by?` | 实际解锁的时间和原因：`printer_report`（打印机上报了状态变化）、`timeout`、`daemon_result`（回了 `rejected` / `expired` / `failed`） |
| `result` | jsonb，daemon 回报的原样结果（含固件拒绝原因，R-PRT-15） |
| `finished_at?` | |

`ACCEPTED` 只表示打印机收下了命令；业务状态只跟着打印机上报的事件走（P-01）。

- 一台打印机同一时间最多一条锁着的控制命令，停止除外（R-CMD-03、INV-16）：`unique (printer_id) where class = 'CONTROL' and kind <> 'job.stop' and unlocked_at is null`。到了 `unlock_at` 由面板的定时任务写 `unlocked_at`。发停止不受这条约束，也不解除别的命令的锁。
- 不记命令"执行了没有"（Q215）：订单和打印机状态只跟着打印机上报的事件走（P-01）。

### E-PCK `pickup_codes`

`id`、`order_id`、`code_hash`、`issued_at`、`expires_at`、`revoked_at?`、`redeemed_at?`、`redeemed_by?`。

- 取件码只在签发时返回一次明文；要再看就重新签发，新码作废旧码（R-PCK-04）。
- 同一订单同时最多一个没作废、没核销的码：签发时在同一个事务里作废旧码。
- 码的格式（Q180）：前缀 `PR1-` + 8 位 Crockford Base32（去掉易混字符），按 `PR1-XXXX-XXXX` 显示，二维码里是同一个字符串。

### E-REC `order_records`

订单时间线（R-NTE-01）。只追加（E-GEN-10）。

| 列 | 说明 |
| --- | --- |
| `id` | |
| `order_id`、`at` | |
| `node` | process_node，按文档 1 §5.8 的归属表 |
| `kind` | 记录类型，英文点分，如 `order.approved`、`version.withdrawn`、`dispatch.stopped_before_start`、`print.stopped_on_device`、`note.added`、`reprint.declined`、`reprint.decline_revoked`、`parts.skipped`（`data: { partIds }`，actor 是现场人员时对申请者只显示角色）；完整清单在代码里，和 i18n 文案一一对应，CI 检查每个 `kind` 都有中英文案（R-NTE-02） |
| `actor_type`、`actor_id?` | |
| `from_status?`、`to_status?` | 状态变化时有 |
| `version_n?`、`job_id?` | |
| `note?` | 备注 |
| `note_visible` | 选手可见（R-NTE-03，默认值按动作） |
| `data` | jsonb，显示文案要用的参数（后退几位、跳过哪些零件……） |

### E-TL `timelapses`

`id`、`job_id`、`object_key`、`size_bytes`、`sha256`、`content_type`、`part`（一次打印可能分成几个文件）、`created_at`。随订单文件一起过期，保留天数 CFG-FIL-02（R-CAM-04）。

## 7. 配置

### E-SET `settings`

| 列 | 说明 |
| --- | --- |
| `section` | 主键，文档 1 §9.1 的分区：`general` `ui` `camera` `submit` `queue` `revision` `mapping` `printing` `pickup` `files` `accounts` `notifications` `ops` |
| `values` | jsonb，这个分区的全部参数，键名是 CFG 编号的英文名（如 `revision.maxCount`） |
| `version` | 按分区保存，每次加 1（Q139） |
| `updated_by`、`updated_at` | |

- 参数的类型、默认值、范围、互相校验写在一份代码里的参数定义表中，和文档 1 §6 一一对应；读取时缺的键用默认值。
- 每次保存记审计，`before` / `after` 是改动的键（F-OPS-06）。
- SMTP 密码、飞书密钥这类凭据不进 `values`，从环境变量或密钥文件读（INV-07）。

### E-FORM `form_versions`

`id`、`fields jsonb`、`created_by`、`created_at`。每次保存新增一行，当前表单 = 最新一行；订单记住提交时的版本。保存时带上读到的最新版本 ID，不是最新的返回 409（Q139）。

字段结构：`{ id, label, type: "text" | "textarea" | "single" | "multi" | "number", required, options? }`。

### E-CAT `filament_catalog`

| 列 | 说明 |
| --- | --- |
| `id` | |
| `source` | `STOCK`（库存行）/ `AUTO`（对自动行的设置） |
| `auto_key?` | `AUTO` 行对应哪种自动行：`model_id + material + colour`，唯一 |
| `model_ids` | text[]，库存行适用的机型；空 = 全部 |
| `material`、`sub_type?`、`colour`（#RRGGBB）、`colour_name?` | 库存行的内容 |
| `hidden`、`sort`、`note?` | 两种行都能设 |
| `version` | E-GEN-04 |

自动行本身不存：每次从开放给选手的打印机当前料位算出来（Q116），再套上这里的 `AUTO` 设置。

## 8. 通知、审计、幂等、归档

### E-NTF `notifications`

`id`、`user_id`、`event`（文档 1 §5.10 的事件，英文名）、`order_id?`、`printer_id?`、`data jsonb`、`created_at`、`read_at?`。站内通知必发（R-NTF-01）。

### E-NDLV `notification_deliveries`

`id`、`notification_id`、`channel`（`EMAIL` / `FEISHU`）、`status`（`PENDING` / `SENT` / `FAILED`）、`attempts`、`last_error?`、`sent_at?`。失败按退避重试，最多 5 次（Q181）。

### E-NPREF `notification_prefs`

`user_id`、`event`、`channel`、`enabled`，主键 `(user_id, event, channel)`。没有行时用系统默认（CFG-NTF-01）；"驳回"和"可取件"的站内通知不能关（R-NTF-02），写入时校验。

### E-AUD `audit_log`

| 列 | 说明 |
| --- | --- |
| `id` | bigint 自增（审计按插入顺序读，不用 UUID） |
| `at` | |
| `actor_type`、`actor_id?` | |
| `action` | 英文点分，如 `printer.control`、`settings.update` |
| `target_type?`、`target_id?` | |
| `before?`、`after?` | jsonb，不含凭据 |
| `reason?` | |
| `result` | `OK` / `FAILED` / `DENIED` |
| `request_id?`、`ip?`、`user_agent?` | |

只追加、永久保留（INV-06）。拖拽排序只记在这里，不进订单时间线（R-QUE-02）。

### E-IDEM `idempotency_keys`

`principal`（`user:<id>` 或 `daemon:<id>`）、`method`、`route`（路由模板）、`key`、`request_hash`、`status_code`、`response jsonb`、`created_at`、`expires_at`（24 小时）。主键 `(principal, method, route, key)`。规则见 API-IDEM。

### E-ARC `archives`

`id`、`by`、`at`、`cancelled_count`、`disposed_count`、`export_key?`。归档本期本身只改订单状态（R-ARC-02），这张表只记做过几次、导出文件在哪。

## 9. 数据库迁移

| 编号 | 约定 |
| --- | --- |
| E-MIG-01 | 用 drizzle 生成的 SQL 迁移文件，提交进仓库；不在启动时自动推断 schema（Q145）。 |
| E-MIG-02 | 每个迁移文件第一行注明 `-- phase: expand` 或 `-- phase: contract`（F-OPS-05）。 |
| E-MIG-03 | expand 只加东西：新表、新的可空列或带默认值的列、新索引（`CONCURRENTLY`）、新枚举值。上一版代码在新 schema 上照常能跑。 |
| E-MIG-04 | contract 只删东西或收紧约束，必须和引入它的 expand 至少隔一个已发布版本，并且确认代码里已经没有地方在读写旧列。 |
| E-MIG-05 | 改名 = expand 新列 + 双写 + 回填 + 下一版 contract 旧列；不直接 `RENAME`。 |
| E-MIG-06 | 迁移前自动备份数据库，备份成功才迁移（F-OPS-03）。回滚 = 装回上一版程序；因为只有 expand，上一版能直接在新 schema 上跑，不需要反向迁移。 |
| E-MIG-07 | 触发器、检查约束、部分唯一索引（INV-02、INV-04、INV-06）写在迁移里，CI 用真 PostgreSQL 跑迁移和这些约束的测试。 |
| E-MIG-08 | 恢复备份用命令行（F-OPS-03）。恢复完、面板启动前，同一个命令里：所有打印机挂失联；所有没做完的 E-CMD（`QUEUED` `SENT` `ACCEPTED`）改为 `EXPIRED`，永不重发；记下"恢复到的时间"，管理员看到横幅；对象存储里没有 E-FILE 记录的文件交给没提交上传的清理（CFG-SUB-07）（R-OPS-01，Q237）。 |
