# @platerelay/server

面板后端（NestJS + PostgreSQL）。设计依据是 [项目简报](../../docs/project-brief.md)。

## 运行

```sh
pnpm install
pnpm dev:server          # 在仓库根执行，监听 :3000，前端 vite 把 /api 代理到这里
```

不设 `DATABASE_URL` 时用内嵌的 PGlite（数据在仓库根目录的 `.platerelay-data/pglite`），只用于开发。正式部署用 PostgreSQL：

| 环境变量 | 说明 |
| --- | --- |
| `DATABASE_URL` | `postgresql://…`。不设则用内嵌 PGlite |
| `PLATERELAY_SECRET` | 签名链接用的密钥。不设则每次启动随机生成，重启后旧链接失效 |
| `PLATERELAY_DATA_DIR` | 本地存储和内嵌数据库的目录，默认是仓库根目录下的 `.platerelay-data`（已被 git 忽略）。放在 `apps/server` 里面的话，Windows 上 dev 模式会因数据库写盘不停重启 |
| `PLATERELAY_SECURE_COOKIES` | 设为 `1` 时会话 cookie 带 `Secure`（HTTPS 部署时打开） |
| `PLATERELAY_TRUST_PROXY` | 在反向代理后面时设置，审计日志才记得到真实 IP |
| `PORT` | 默认 3000 |
| `PLATERELAY_STORAGE` | `local`（默认，存在 `PLATERELAY_DATA_DIR/storage`）或 `oss`（阿里云 OSS 等 S3 兼容存储） |
| `OSS_ENDPOINT`、`OSS_BUCKET`、`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET` | `PLATERELAY_STORAGE=oss` 时必填。桶保持私有，浏览器只拿到短时效签名链接 |
| `OSS_PUBLIC_ENDPOINT`、`OSS_REGION`、`OSS_PATH_STYLE` | 可选：签名链接用的对外地址、签名区域（默认取 endpoint 的第一段，如 `oss-cn-beijing`）、路径式寻址（MinIO 用 `1`） |

`dev`、`start`、`user:create` 会读取 `apps/server/.env`（已被 git 忽略），模板见 `.env.example`。凭据只放在环境变量或 `.env` 里，不进仓库。

接上 OSS 后可以跑一次 `pnpm --filter @platerelay/server storage:check`：上传一个小文件、用签名链接读回、再删掉，一共 5 个请求。测试始终用本地磁盘，不访问 OSS。

启动时自动执行 `drizzle/` 里的迁移。改了 `src/db/schema.ts` 后用 `pnpm --filter @platerelay/server db:generate` 生成新迁移。

第一个管理员账户用脚本创建，密码从标准输入读，不走命令行参数：

```sh
pnpm --filter @platerelay/server user:create -- --username admin --name 管理员 --role coreteam
```

之后选手可以在登录页自行注册（得到 User 角色）；角色修改接口要求 `user:manage`。前端默认用原型数据；`VITE_API=http` 构建时各页面走这里的接口。系统设置里的「通知」还没有后端，页面上会注明。

## 测试

```sh
pnpm --filter @platerelay/server test
```

默认跑在内存 PGlite 上。设 `PLATERELAY_TEST_DATABASE_URL` 指向一个空的 PostgreSQL 数据库，可以对真实数据库再跑一遍。

测试文件串行运行，避免多个内存 PGlite 实例同时编译 WASM 导致内存峰值过高；设备命令由 FakeCommands 替代，不连接打印机。

## 结构

| 目录 | 内容 |
| --- | --- |
| `src/db` | 表结构（drizzle）和数据库连接 |
| `src/auth` | 会话 cookie 登录、权限节点守卫、预置角色同步 |
| `src/audit` | 只追加的审计日志（数据库触发器拒绝改和删） |
| `src/storage` | 对象存储接口，本地磁盘和 S3 兼容（阿里云 OSS）两个实现 |
| `src/orders` | 订单状态机、审核、排队、取消、失败归因、铲件入库、取件码 |
| `src/printers` | 打印机管理、报错处理、调度（FIFO + 兼容性过滤），以及给 daemon 用的状态上报入口 |
| `src/rules` | 打印规则：参数在系统设置里（`queue.rules`、`resources`），排队和修改文件的决定都经过 `QueuePolicy` 接口（现在只有按参数运行的 `ParamPolicy`），本场可用资源与上传校验 |
| `src/forms`、`src/users`、`src/daemons`、`src/settings` | 申请表单（带版本）、用户与角色、daemon 令牌、系统设置 |

权限只按节点检查（`packages/shared/src/auth/permissions.ts`），四个角色是预置的节点组合，每次启动按 `PRESET_ROLES` 重写。

## 接口一览

所有路径带 `/api` 前缀，出错时统一返回 `{code, message, ...}`。

| 页面 | 接口 |
| --- | --- |
| 登录 | `POST /auth/register`、`POST /auth/login`、`POST /auth/logout`、`GET /auth/me` |
| 概况 / 打印机详情 | `GET /overview`（排队、待审核、等待兼容打印机的数量）、`GET /printers`、`GET /printers/:id` |
| 提交订单 | `GET /form`、`GET /rules`、`GET /resources`（本场可用资源，`resource:view`；预计等待只给区间，另需 `queue:wait:view`）、`POST /orders/preview`（multipart `file`：解析结果、每盘有没有兼容的打印机、按可用资源的校验 `check`、队列长度，不存任何东西；没有 `queue:wait:view` 时 `queue` 为 `null`）、`POST /orders`（multipart：`file` + `answers` JSON，可选 `plates` JSON 数组只提交其中几盘，`colour` 颜色要求 exact/similar/any，默认 similar，`bedType` 仅在允许自选板时可传；校验不过返回 422 `plate-blocked`） |
| 我的订单 | `GET /orders/mine`、`GET /orders/:id`（含 `storePhotoUrl` 入库照片签名链接，仅本人和 `order:view:any`）、`POST /orders/:id/cancel`、`POST /orders/:id/pickup-code`、`POST /orders/:id/revise`（multipart `file`，可选 `plate`：提交后修改文件） |
| 待办 | `GET /todo`（含跳单提醒 `skipped`）、`POST /orders/:id/store`（multipart：`photo`、`slot`、`bedCleared=true`）、`POST /printers/:id/resolve`、`POST /printers/:id/stop`、`POST /printers/:id/clear-bed` |
| 扫码取件 | `GET /pickup/:code`、`POST /pickup/:code/redeem`、`GET /pickup/redemptions?since=` |
| 审核队列 | `GET /review`、`POST /orders/:id/approve`、`POST /orders/:id/reject` |
| 订单管理 | `GET /orders?status=&q=&limit=&offset=`、`GET /orders/:id/file`、`POST /orders/:id/attribute`、`POST /queue/reorder` |
| 打印机管理 | `GET /daemon-keys`（可选的 daemon 及其公钥）、`POST /printers`、`PATCH /printers/:id`（`accessCode: {keyId, ciphertext}` 为浏览器加密后的访问码，`null` 清除）、`DELETE /printers/:id`、`POST /printers/:id/maintenance`、`POST /printers/:id/star`、`POST /printers/:id/open`（开放给选手；新加的打印机默认关闭，只有开放的接选手的单） |
| 系统设置 | `GET/PUT /form`、`GET /users`、`GET /roles`、`PUT /users/:id/role`、`PUT /users/:id/disabled`、`GET/POST /daemons`、`PATCH/DELETE /daemons/:id`、`GET /settings`、`PUT /settings/registration`、`PUT /settings/rules`（文件与排队）、`GET/PUT /settings/resources`（可用资源，`resource:configure`）、`GET /audit` |

### 打印规则

参数和默认值见 `packages/shared/src/rules/rules.ts`，对应《通用打印规则》里标了已定的条目。

- 提交后修改文件：默认重新审核，审核期间订单冻结在原位（仍占队列位置，派单跳过它），审核队列里排在最前，带上一版的时长、克数、耗材供对比。通过后按时长规则后移：比较基准默认是第一版（参数，文档里还没定），多出不超过阈值不动，之后每多一个步长后移若干位，也可以设成不变、固定后移或排到队尾。驳回修改版和驳回普通订单一样，订单结束。
- 已派单但还没开始打的：撤回这次打印（`PrinterCommands.recall`，daemon 连上之前只记审计），打印机回到空闲，订单冻结等重审，通过后在时长规则之外再额外后移 1 位（参数）；也可以设成不允许修改。已经开打的不能改，只能取消。选手自己也能取消已派单但还没开打的订单，打印机同样撤回这次打印。
- 「轻微修改自动审核」默认关：打开后机型、耗材不变且时长变化在阈值内的修改直接回到原位。
- 换机型：按原提交时间排位（同一个全局队列，保留原来的排队序号），次数有上限，计入修改次数；双头改单头不计入修改次数，但算一次换机型。
- 跳单提醒：排在前面的单被后面的单越过时记下时间，超过设定分钟数出现在待办里。
- 可用资源：只统计开放给选手的打印机。机型或喷嘴不在表里的盘不能提交；材质只在已经知道有哪些耗材（打印机上报或手动添加库存）时检查；颜色要求「一致」而本场没有这个颜色时，默认可以提交、审核队列里列出缺的颜色，也可以设成拦下。
- 每次按规则后移都写审计 `queue.revision-penalty`，记录策略、参数和前后位置；修改文件本身记 `order.revise`。
- 跳过零件：按打印机、订单的顺序加锁，锁内重新检查已跳过集合并发送命令，防止并发请求跳过全部零件。仅命令调用成功后记录集合、时间线与成功审计；数据库与设备命令仍不具备原子提交保证。
- 修改文件：事务提交后的召回、响应签名或预览审计失败，不删除已被版本引用的源文件和预览对象。
- 迁移 `0009_withdraw_cancelled_versions` 修复旧取消单遗留的 pending 版本；有已审核版本可回退时恢复 active 指针，再将 pending 版本置为 withdrawn。不改写已执行的 `0007/0008`。

### 审计日志

前端默认保留原型模式；设置 `VITE_API=http` 后，`/settings/audit` 读取真实后端。此页面要求 `audit:view`，不要求用户管理权限；只有该权限的账号从 `/settings` 进入时直接落到审计页。原型模式明确标注模拟数据，其他模拟设置操作不会写入真实审计库。

设置内容在工作区内居中，沿用 840px 卡片与 MD3 主题 token。审计筛选默认折叠，展开后按操作人姓名、中文操作类别、涉及内容、结果、来源、订单编号和时间筛选；应用后自动收起，已应用条件显示为可单独移除的标签。公共 `Field` 的 `labelPlacement="outline"` 仅在审计筛选中启用，其余表单保留既有标签布局。列表展示业务名称和可读操作，详情将已知业务变更呈现为中文字段及前后对照，不直接回显动作代码、内部 UUID 或 JSON；未识别的动作显示“其他操作”，未知载荷字段不直接展示。桌面使用对话框，手机使用底部面板。

`GET /api/audit` 返回显式投影的 `AuditLogView[]`（契约在 `packages/shared/src/audit/api.ts`），不直接展开数据库行，也不使用分页包装。`target.name` 批量解析为设备、账户、守护进程名称或订单编号与文件名，无需额外访问用户管理接口；对象已不存在时可使用审计记录中的名称，否则明确显示名称未记录。可选筛选为 `actorId`（UUID）、`actorName`（当前账户显示名的大小写不敏感字面子串，去除首尾空白、最长 80 字，`%`、`_`、反斜杠不作通配符）、`actorType`、`action`（精确匹配）、`targetType`、`targetId`、`result`、`from`、`to`。所有条件 AND，时间上下界包含；非法参数返回 400。按 ID 降序，`beforeId` 为严格小于的正安全整数游标；`limit` 默认 100、最大 500，页面每次取 50 条。

读取成功后、返回前追加 `audit.view`，不会混入本次响应。姓名搜索只记录 `actorNameFiltered: true`，不将搜索姓名写入审计。操作者姓名、对象名称和“当前角色”来自查询时的账户或业务资料，不宣称是历史快照；已删除账户沿用提示。详情使用当前行，来源信息默认折叠；`device` 在协议中仍为 User-Agent，页面只提取浏览器与系统名称，不宣称识别了真实设备。未记录的值为 null。

账户登录/登出、打印机收藏以及设备开始/完成事实，与其审计写入同事务；写入失败会回滚数据库业务变更。下载他人源文件和签发他人模型预览链接属于敏感读取：签名成功后才记成功，审计失败不会向调用者返回链接。预览事件 `order.preview.view` 只表示已签发访问链接，不表示浏览器已经下载图片。

派单决定 `order.dispatch`、发送失败补偿 `order.dispatch.failed`、停止业务决定 `printer.stop` / `order.cancel`、命令调用结果 `printer.stop.command`、设备上报 `printer.started` / `printer.finished` 分开记录。调用成功不代表物理设备已经执行；命令失败保留已有 best-effort 行为，不添加重试或 outbox。数据库与设备调用不能原子提交。

审计表只追加，触发器拒绝 UPDATE、DELETE、TRUNCATE。不记录密码、会话/完整 daemon token、取件码、签名 URL 或原始请求/响应；daemon 的既有 tokenTail 例外保留。普通参数错误、未登录、普通不存在及业务冲突不泛化为对象审计事件。没有新增数据库迁移。

## 还没做

- 打印机访问码（简报 §0.9 第 10 条）：面板只存浏览器用 daemon 公钥加密的密文，接口只返回 `accessCode: {setAt, delivered, current}`，不返回密文；审计只记"已设置/已清除"。给 daemon 用的三步已写好但还没接到连接上：`DaemonsService.setPublicKey`（上报公钥）、`PrintersService.accessCodesFor`（拉取能解开的密文）、`PrintersService.markAccessCodeDelivered`（回报送达）。迁移 `0003_access_code_keys` 加了对应的列。
- 打印机上报的已装耗材（`printers.trays`）和当前热床板（`printers.bed_type`）：列已加，daemon 连上后填。自选板只记录选手的选择，派单还不看热床板（关闭自选板时怎么处理还没定）。
- daemon 连接（WebSocket）。现在 `PrinterCommands` 的实现是"连不上任何打印机"，所以不会派单，也不会向真实打印机发任何命令；打印机状态上报的入口（`PrintersService.onStarted` 等）已写好，只在测试里调用。
- 实时推送（SSE）、通知（邮件 / 飞书）、OIDC 登录、头像。
