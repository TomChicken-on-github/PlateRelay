# PlateRelay

面向黑客松、创客空间、学校、工作室等公共资源场景的共享 3D 打印管理系统。

## 目录

```text
apps/server      后端（NestJS）
apps/web         前端（React）
daemon           设备端（Python）
packages/shared  共享契约与类型
docs             项目文档
tools            工具脚本
```

## 本地开发

```sh
pnpm dev:web
```

打开终端输出的地址，默认是 http://localhost:5173/。按 `Ctrl+C` 停止。

默认运行前端原型，使用本地模拟数据，不需要启动后端或 daemon，也不会连接打印机。后端已按第二稿的接口契约重写（见 [apps/server/README.md](apps/server/README.md)），前端的 `VITE_API=http` 模式还是按旧接口写的，暂时不能用，等前端按新契约重做后恢复。

### 环境要求

### 安装依赖

### 启动

在仓库根目录运行：



## 文档

- [版本功能边界清单](docs/design/00-scope-and-principles.md)
- [业务规约与状态机清单](docs/design/01-business-rules.md)
- [数据模型与通信契约](docs/design/02/README.md)
- [核心交互时序图](docs/design/03-sequences.md)
- [项目简报](docs/project-brief.md)
- [打印机 Driver 接口草稿](docs/printer-driver-interface-draft.md)

## 版权与许可证

Copyright (C) 2026 Tom_Chicken

PlateRelay 是自由软件，按 GNU 通用公共许可证第 3 版（[GPL-3.0-only](LICENSE)）发布。本程序不附带任何担保，详见许可证全文。

### 第三方代码

| 组件 | 位置 | 版权 | 许可证 |
| --- | --- | --- | --- |
| [ha-bambulab](https://github.com/greghesp/ha-bambulab) 的 pybambu | [daemon/src/platerelay_daemon/drivers/bambu/_vendor/pybambu/](daemon/src/platerelay_daemon/drivers/bambu/_vendor/pybambu/) | Copyright (c) 2023 ha-bambulab contributors | MIT，原文见 [LICENSE](daemon/src/platerelay_daemon/drivers/bambu/_vendor/pybambu/LICENSE) |

PlateRelay 与拓竹（Bambu Lab）、ha-bambulab 项目均无关联。
