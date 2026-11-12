# PlateRelay

[English](README.md)

自托管的共享 3D 打印机管理系统。接收很多人的打印请求，在一批打印机之间排队，并在成品被主人取走之前一直记录它的去向。

适用于打印机是公共资源的场合：黑客松、创客空间、学校、工作室。

## 关于项目

共享打印机通常靠聊天群和便利贴运转：下一个轮到谁，哪台机器空着，打完的东西放哪了。PlateRelay 把这些放进一个系统，并且把实体交接当作系统的一部分，而不是事后补一句。

### 功能

* **订单接收**：接收切好片的 `.gcode.3mf`，从中读出盘、耗材和打印时间。多盘文件按盘拆成各自独立的订单。
* **审核与排队**：工作人员通过或驳回；通过的订单按先到先得排队，只会匹配到真正能打印它的打印机。
* **打印机管理**：显示每台打印机自己上报的真实状态；现场的人确认耗材映射后才派单。
* **取件交接**：打印完成后，铲件的人拍照并记下格位入库；主人凭一次性取件码，由工作人员扫码取走。
* **角色与审计**：四个预置角色（User、Staff、Builder、Coreteam），基于细粒度权限；审计日志只能追加。
* **自托管、可扩展**：部署在自己的机器上；打印机品牌是适配器，对象存储可以是任何 S3 兼容服务或本地磁盘。

系统由三部分组成：

| 部分 | 位置 | 作用 |
| --- | --- | --- |
| 面板后端 | `apps/server` | 订单、队列、权限、审计、存储 |
| 面板前端 | `apps/web` | 浏览器界面 |
| daemon | `daemon` | 部署在打印机所在局域网，主动连面板，和打印机对话 |

daemon 主动向外连接面板，打印机不需要对公网可达。打印机访问码在浏览器里用 daemon 的公钥加密，面板只保存密文。

### 技术栈

* [NestJS](https://nestjs.com/) 与 PostgreSQL（[Drizzle ORM](https://orm.drizzle.team/)），开发时用内嵌的 PGlite
* [React](https://react.dev/)、[Vite](https://vite.dev/)、[Tailwind CSS](https://tailwindcss.com/)、[Motion](https://motion.dev/)
* daemon 用 Python 3.12+
* S3 兼容的对象存储（默认本地磁盘）
* `packages/shared/schema` 里的 OpenAPI 契约和 JSON Schema 描述的 daemon 协议，类型由它们生成

## 快速开始

下面的步骤在一台机器上用模拟打印机跑起整套系统，不会碰任何真实打印机。

### 环境要求

* Node.js 24 及以上，以及 [pnpm](https://pnpm.io/)
* Python daemon 用 [uv](https://docs.astral.sh/uv/)

### 安装

```sh
git clone https://github.com/TomChicken-on-github/PlateRelay.git
cd PlateRelay
pnpm install
(cd daemon && uv sync)
```

### 启动面板、模拟打印机和 daemon

开三个终端。

```sh
# 1. 面板后端，监听 :3000（内嵌数据库，数据在 .platerelay-data/）
PLATERELAY_DEV_ENROLL_TOKEN=devtoken pnpm dev:server
```

```sh
# 2. 模拟打印机，监听 127.0.0.1:7130
cd daemon
PYTHONPATH=src uv run python -m platerelay_sim run --count 1 --speed 60
```

```sh
# 3. daemon；令牌只在第一次运行时需要
cd daemon
PLATERELAY_ENROLL_TOKEN=devtoken PLATERELAY_DEV_INSECURE=1 \
  PYTHONPATH=src uv run python -m platerelay_daemon --data-dir ./.daemon-data run --panel http://localhost:3000
```

然后通过接口创建第一个管理员并添加打印机（见 [apps/server/README.md](apps/server/README.md)）：调用一次 `POST /api/v1/setup`，或运行 `pnpm --filter @platerelay/server user:create`。添加打印机时品牌填 `sim`，序列号 `SIM-0001`，地址 `127.0.0.1:7130`。第一次上报后打印机停在「待清板」，有人确认清板才变成可用。

### 运行前端原型

```sh
pnpm dev:web
```

打开 http://localhost:5173/。它使用本地模拟数据，不需要后端和 daemon，也还没有接到重写后的后端接口。

## 使用

* 后端配置、环境变量、HTTP 约定和模块结构：[apps/server/README.md](apps/server/README.md)
* daemon、模拟打印机，以及如何扮演站在机器旁的人：[daemon/README.md](daemon/README.md)
* 前端：[apps/web/README.md](apps/web/README.md)
* 接口契约：[packages/shared/schema/openapi.yaml](packages/shared/schema/openapi.yaml)

测试：

```sh
pnpm test                      # 共享契约和后端
(cd daemon && uv run pytest)   # daemon
```

## 路线图

已完成：

- [x] 后端的订单、审核、排队、派单、入库、取件流程，含权限和审计日志
- [x] daemon 和模拟打印机，与后端端到端跑通
- [x] 契约先行的接口和 daemon 协议，类型自动生成
- [x] 前端原型

进行中或计划中：

- [ ] 前端接入新接口
- [ ] 拓竹适配器（目前只有只读的状态换算，没有对真机发命令的实现）
- [ ] 摄像头实况、抓拍、延时摄影
- [ ] 上传文件的安全检查（目前只检查文件能否读取）
- [ ] 通知、邀请码、OIDC 登录
- [ ] 局域网发现打印机

欢迎提 issue 提出更多想法。

## 参与贡献

欢迎贡献。

1. Fork 本项目并新建分支
2. 修改后运行上面的测试
3. 向 `main` 提交 pull request

`packages/shared/src/generated` 和 `daemon/src/platerelay_daemon/protocol` 下的文件由契约生成：改契约，然后运行 `pnpm --filter @platerelay/shared generate` 和 `daemon/scripts/generate_protocol.sh`。

## 许可证

按 GPL-3.0-only 发布，见 [LICENSE](LICENSE)。本程序不附带任何担保。

第三方代码见[第三方代码](#第三方代码)。

## 致谢

* [ha-bambulab](https://github.com/greghesp/ha-bambulab)：拓竹适配器复用了它的 `pybambu`
* [Best-README-Template](https://github.com/othneildrew/Best-README-Template)

### 第三方代码

| 组件 | 位置 | 版权 | 许可证 |
| --- | --- | --- | --- |
| [ha-bambulab](https://github.com/greghesp/ha-bambulab) 的 `pybambu` | [daemon/src/platerelay_daemon/adapters/bambu/_vendor/pybambu/](daemon/src/platerelay_daemon/adapters/bambu/_vendor/pybambu/) | Copyright (c) 2023 ha-bambulab contributors | MIT，原文见 [LICENSE](daemon/src/platerelay_daemon/adapters/bambu/_vendor/pybambu/LICENSE) |

Copyright (C) 2026 Tom_Chicken。PlateRelay 与拓竹（Bambu Lab）、ha-bambulab 项目均无关联。
