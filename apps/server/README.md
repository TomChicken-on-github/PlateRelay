# @platerelay/server

面板后端（NestJS + PostgreSQL）。设计依据是 [项目简报](../../docs/project-brief.md)。

## 运行

```sh
pnpm install
pnpm dev:server          # 在仓库根执行，监听 :3000，前端 vite 把 /api 代理到这里
```

不设 `DATABASE_URL` 时用内嵌的 PGlite（数据在 `apps/server/var/pglite`），只用于开发。正式部署用 PostgreSQL：

| 环境变量 | 说明 |
| --- | --- |
| `DATABASE_URL` | `postgresql://…`。不设则用内嵌 PGlite |
| `PLATERELAY_SECRET` | 签名链接用的密钥。不设则每次启动随机生成，重启后旧链接失效 |
| `PLATERELAY_DATA_DIR` | 本地存储和内嵌数据库的目录，默认 `var` |
| `PLATERELAY_SECURE_COOKIES` | 设为 `1` 时会话 cookie 带 `Secure`（HTTPS 部署时打开） |
| `PLATERELAY_TRUST_PROXY` | 在反向代理后面时设置，审计日志才记得到真实 IP |
| `PORT` | 默认 3000 |

启动时自动执行 `drizzle/` 里的迁移。改了 `src/db/schema.ts` 后用 `pnpm --filter @platerelay/server db:generate` 生成新迁移。

第一个管理员账户用脚本创建，密码从标准输入读，不走命令行参数：

```sh
pnpm --filter @platerelay/server user:create -- --username admin --name 管理员 --role coreteam
```

之后选手可以在登录页自行注册（得到 User 角色），由有 `user:manage` 的人在系统设置里改角色。

## 测试

```sh
pnpm --filter @platerelay/server test
```

默认跑在内存 PGlite 上。设 `PLATERELAY_TEST_DATABASE_URL` 指向一个空的 PostgreSQL 数据库，可以对真实数据库再跑一遍。

## 结构

| 目录 | 内容 |
| --- | --- |
| `src/db` | 表结构（drizzle）和数据库连接 |
| `src/auth` | 会话 cookie 登录、权限节点守卫、预置角色同步 |
| `src/audit` | 只追加的审计日志（数据库触发器拒绝改和删） |
| `src/storage` | 对象存储接口 + 本地磁盘实现；S3 / OSS 实现以后按同一接口加 |
| `src/orders` | 订单状态机、审核、排队、取消、失败归因、铲件入库、取件码 |
| `src/printers` | 打印机管理、报错处理、调度（FIFO + 兼容性过滤），以及给 daemon 用的状态上报入口 |
| `src/forms`、`src/users`、`src/daemons`、`src/settings` | 申请表单（带版本）、用户与角色、daemon 令牌、系统设置 |

权限只按节点检查（`packages/shared/src/auth/permissions.ts`），四个角色是预置的节点组合，每次启动按 `PRESET_ROLES` 重写。

## 接口一览

所有路径带 `/api` 前缀，出错时统一返回 `{code, message, ...}`。

| 页面 | 接口 |
| --- | --- |
| 登录 | `POST /auth/register`、`POST /auth/login`、`POST /auth/logout`、`GET /auth/me` |
| 概况 / 打印机详情 | `GET /printers`、`GET /printers/:id` |
| 提交订单 | `GET /form`、`POST /gcode3mf/parse`（预览）、`POST /orders`（multipart：`file` + `answers` JSON） |
| 我的订单 | `GET /orders/mine`、`GET /orders/:id`、`POST /orders/:id/cancel`、`POST /orders/:id/pickup-code` |
| 待办 | `GET /todo`、`POST /orders/:id/store`（multipart：`photo`、`slot`、`bedCleared=true`）、`POST /printers/:id/resolve`、`POST /printers/:id/stop`、`POST /printers/:id/clear-bed` |
| 扫码取件 | `GET /pickup/:code`、`POST /pickup/:code/redeem`、`GET /pickup/redemptions?since=` |
| 审核队列 | `GET /review`、`POST /orders/:id/approve`、`POST /orders/:id/reject` |
| 订单管理 | `GET /orders?status=&q=&limit=&offset=`、`GET /orders/:id/file`、`POST /orders/:id/attribute`、`POST /queue/reorder` |
| 打印机管理 | `POST /printers`、`PATCH /printers/:id`、`DELETE /printers/:id`、`POST /printers/:id/maintenance`、`POST /printers/:id/star` |
| 系统设置 | `GET/PUT /form`、`GET /users`、`GET /roles`、`PUT /users/:id/role`、`PUT /users/:id/disabled`、`GET/POST /daemons`、`PATCH/DELETE /daemons/:id`、`GET /settings`、`PUT /settings/registration`、`GET /audit` |

## 还没做

- daemon 连接（WebSocket）。现在 `PrinterCommands` 的实现是"连不上任何打印机"，所以不会派单，也不会向真实打印机发任何命令；打印机状态上报的入口（`PrintersService.onStarted` 等）已写好，只在测试里调用。
- 实时推送（SSE）、通知（邮件 / 飞书）、OIDC 登录、头像、S3 / OSS 存储实现。
