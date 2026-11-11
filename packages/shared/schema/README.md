# 契约

面板、前端和 daemon 之间"数据长什么样"的唯一来源。这里的文件由人维护，代码从它们生成，不手写第二份。

| 路径 | 内容 |
| --- | --- |
| `openapi.yaml` | HTTP 接口（OpenAPI 3.1）：路径、参数、请求体、响应，以及每个接口需要的权限（`x-permission`） |
| `daemon/v1/*.schema.json` | daemon 和面板之间控制通道的消息，每种消息一个 JSON Schema（2020-12）文件；共用的结构在 `common.schema.json` |
| `daemon/v1/messages.json` | 消息清单：类型、方向、要不要确认 |
| `daemon/v1/examples/` | 消息样例。面板和 daemon 两边的测试都要能解析它们 |

## 生成了什么

| 生成物 | 给谁用 |
| --- | --- |
| `src/generated/api.ts` | 接口的 TypeScript 类型。前端通过 `@platerelay/shared/api` 的 `createApiClient()` 用它 |
| `src/generated/operations.ts`、`openapi-document.ts` | 接口的操作表和整份契约。服务端通过 `@platerelay/shared/contract/http` 的 `validateRequestBody()` 校验请求 |
| `src/generated/daemon-protocol*.ts` | daemon 消息的 TypeScript 类型和 Schema。面板通过 `@platerelay/shared/contract/daemon` 的 `parseDaemonMessage()` 校验消息 |
| `daemon/src/platerelay_daemon/protocol/v1.py` | daemon 消息的 pydantic 模型。daemon 通过 `platerelay_daemon.protocol.parse_message()` 校验消息 |

生成的文件提交进仓库。

## 改契约的步骤

1. 改这里的 `openapi.yaml` 或 `daemon/v1/` 下的 Schema；加了新消息就在 `messages.json` 里登记，并在 `examples/` 里放一个样例。
2. 重新生成：

   ```sh
   pnpm --filter @platerelay/shared generate
   daemon/scripts/generate_protocol.sh
   ```

3. 检查：`pnpm --filter @platerelay/shared check:contract`。CI 会再跑一遍生成，结果和提交的不一样就失败。

## 约定

- 字段名、枚举值、错误码用英文，说明用中文。
- 说明直接写行为和规则本身，不写设计文档的编号或章节号。契约是代码的一部分，要能脱离设计文档读懂；`check:contract` 会拦下编号。
- daemon 协议的次版本只加东西（可选字段、消息类型、命令类型）。双方都忽略不认识的字段，所以 daemon 消息的对象不封闭；不认识的消息类型回 `ack` 后忽略。
- HTTP 接口的请求和响应是封闭的（`additionalProperties: false`），多传字段会被拒绝。
