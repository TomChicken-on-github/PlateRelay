# @platerelay/server

面板后端（NestJS + PostgreSQL）。接口以 [`packages/shared/schema/openapi.yaml`](../../packages/shared/schema/openapi.yaml) 为准，和 daemon 的消息以 [`packages/shared/schema/daemon/v1`](../../packages/shared/schema/daemon/v1) 为准；路由的方法、路径、权限和请求体校验都直接取自这两份契约。

## 运行

```sh
pnpm install
pnpm dev:server          # 在仓库根执行，监听 :3000
```

第一次启动没有任何账户：`GET /api/v1/auth/methods` 返回 `setupRequired: true`，这时调一次 `POST /api/v1/setup` 建第一个管理员（有账户之后这个接口就拒绝）。也可以用命令行建账户，密码从标准输入读，不出现在命令行里：

```sh
pnpm --filter @platerelay/server user:create admin 管理员 ADMIN < password.txt
```

不设 `DATABASE_URL` 时用内嵌的 PGlite（数据在 `PLATERELAY_DATA_DIR/pglite-v2`），只用于开发。表结构和旧版本不兼容，旧的开发库（`pglite` 目录）不会被打开，也不会被删。

| 环境变量 | 说明 |
| --- | --- |
| `DATABASE_URL` | `postgresql://…`。不设则用内嵌 PGlite |
| `PLATERELAY_SECRET` | 签名链接和取件码用的密钥。不设则每次启动随机生成，重启后旧链接和没用掉的取件码失效 |
| `PLATERELAY_PUBLIC_ORIGIN` | 面板对外的地址（`scheme://host[:port]`），默认 `http://localhost:<PORT>`。浏览器的写请求只接受这个来源；daemon 登录时签名里绑的也是它 |
| `PLATERELAY_DATA_DIR` | 本地存储和内嵌数据库的目录，默认是仓库根目录下的 `.platerelay-data`（已被 git 忽略）。放在 `apps/server` 里面的话，Windows 上 dev 模式会因数据库写盘不停重启 |
| `PLATERELAY_SECURE_COOKIES` | 设为 `1` 时会话 cookie 带 `Secure`（HTTPS 部署时打开） |
| `PLATERELAY_TRUST_PROXY` | 在反向代理后面时设置，审计日志才记得到真实 IP |
| `PORT` | 默认 3000 |
| `PLATERELAY_DEV_ENROLL_TOKEN` | 只在开发时（`NODE_ENV` 不是 `production`）：一个固定、可重复使用的 daemon 注册令牌，省得每次去管理页生成 |
| `PLATERELAY_PARSE_WORKERS` | 解析 `.gcode.3mf` 的 worker 线程数，默认 CPU 核数减 1，最少 1、最多 4 |
| `PLATERELAY_PARSE_QUEUE` | 线程都忙时最多排队几个文件，默认 16，再多直接回 503 `parse_busy` |
| `PLATERELAY_PARSE_TIMEOUT_MS` | 单个文件解析的时间上限，默认 15000 |
| `PLATERELAY_STORAGE` | `local`（默认，存在 `PLATERELAY_DATA_DIR/storage`）或 `oss`（阿里云 OSS 等 S3 兼容存储） |
| `OSS_ENDPOINT`、`OSS_BUCKET`、`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET` | `PLATERELAY_STORAGE=oss` 时必填。桶保持私有，浏览器只拿到短时效签名链接 |
| `OSS_PUBLIC_ENDPOINT`、`OSS_REGION`、`OSS_PATH_STYLE` | 可选：签名链接用的对外地址、签名区域、路径式寻址（MinIO 用 `1`） |

`dev`、`start`、`user:create` 会读取 `apps/server/.env`（已被 git 忽略）。凭据只放在环境变量或 `.env` 里，不进仓库。

启动时自动执行 `drizzle/` 里的迁移。改了 `src/db/schema.ts` 后用 `pnpm --filter @platerelay/server db:generate` 生成新迁移。

## 和 daemon、模拟打印机一起跑

三个进程，都在本机（daemon 和模拟打印机的用法见 [daemon/README.md](../../daemon/README.md)）：

```sh
# 1. 面板
PLATERELAY_DEV_ENROLL_TOKEN=devtoken pnpm dev:server

# 2. 模拟打印机（在 daemon/ 目录）
PYTHONPATH=src uv run python -m platerelay_sim run --count 1 --speed 60

# 3. daemon：第一次带注册令牌，之后直接 run
PLATERELAY_ENROLL_TOKEN=devtoken PLATERELAY_DEV_INSECURE=1 \
  PYTHONPATH=src uv run python -m platerelay_daemon --data-dir ./.daemon-data run --panel http://localhost:3000
```

然后在面板里添加打印机：品牌 `sim`、序列号 `SIM-0001`、地址 `127.0.0.1:7130`。访问码在浏览器里用 daemon 的公钥加密（RSA-OAEP，SHA-256）后才交给面板，面板自己读不到。打印机第一次上报后停在「待清板」，有人确认清板才变成可用。

## 接口约定

- 前缀 `/api/v1`；daemon 用的接口在 `/daemon/v1`（WebSocket `/daemon/v1/ws`）。
- 登录后是 `pr_session` cookie。写请求只接受面板自己的来源（看 `Origin`），不另设 CSRF 令牌。
- 每个写请求都要带 `Idempotency-Key`（登录、登出、在场心跳除外），没带回 428；同一个键 24 小时内重放第一次的结果，键相同而内容不同回 409。
- 拒绝一律是 `application/problem+json`，前端按 `code` 找文案；`X-Request-Id` 和响应体里的 `requestId` 对得上日志。
- 会改状态的请求带上调用方看到的状态（`expectedStatus`、`expectedState`、`expectedJobId`），对不上回 409，不会作用到别的东西上。
- 给打印机的命令回 202 和 `commandId`：只代表交给了 daemon。之后发生了什么，以打印机自己的上报为准，面板不推断。daemon 不在线时回 409 `printer_unreachable`，命令不排队等它回来。
- 实时推送是 `GET /api/v1/stream`（Server-Sent Events）：变化后的资源整份推送，按连接者的权限裁剪。重连的浏览器会收到 `resync`，重新拉一遍数据。

## 测试

```sh
pnpm --filter @platerelay/server test
```

默认跑在内存 PGlite 上。设 `PLATERELAY_TEST_DATABASE_URL` 指向一个空的 PostgreSQL 数据库，可以对真实数据库再跑一遍。`PLATERELAY_TEST_LOG=1` 打开服务端日志。

测试里的 daemon 是 `test/helpers.ts` 的 `FakeDaemon`：自己生成密钥、注册、签挑战，再按测试的要求上报状态和事件；不连接任何打印机。

## 结构

| 目录 | 内容 |
| --- | --- |
| `src/db` | 表结构（drizzle）和数据库连接；`drizzle/` 是迁移 |
| `src/common` | 请求上下文、契约绑定和权限守卫（`op.ts`）、幂等键、错误格式 |
| `src/core` | 工作单元：一个事务，加上提交后要通知谁（浏览器、daemon） |
| `src/jobs` | 打印任务。订单进出「已派单、打印中、失败、待入库」和打印机因任务进出工作状态，只在这里发生，和任务的变化在同一个事务里 |
| `src/orders` | 提交、审核、修改、取消、重打、入库、处置、取件码、排队顺序 |
| `src/printers` | 应用 daemon 上报的事实（`facts.service.ts`）、派单和耗材映射、停止、人工判定、放出、清板 |
| `src/daemons` | daemon 注册和登录、WebSocket 控制通道、命令投递 |
| `src/realtime` | 给浏览器的推送 |
| `src/overview` | 概况、可用资源、待办 |
| `src/api` | 控制器，只做参数转接 |
| `src/files`、`src/gcode3mf`、`src/storage` | 上传和解析 `.gcode.3mf`、对象存储 |
| `src/settings`、`src/audit`、`src/auth` | 系统设置、审计日志、账户和会话 |

## 还没做的

契约里有、这里还没实现的接口会回 404：验证码和短信、邀请码、OIDC、头像、通知和通知偏好、耗材目录、延时摄影、摄像头实况、发现局域网里的打印机、打印机存储列表、归档。另外：

- 上传时的安全检查目前只有「文件结构能不能读」这一项；越界、危险指令、元数据一致性还没接。
- 幂等记录写在处理请求的事务之外：进程在两者之间崩掉的话，这个键要等过期才能重试。
- 重连后不补发错过的推送，一律让浏览器重新拉。
- daemon 的 HTTP 令牌随连接作废，但连接期间不轮换。
