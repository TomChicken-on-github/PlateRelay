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

默认运行前端原型，使用本地模拟数据，不需要启动后端或 daemon，也不会连接打印机。设置 `VITE_API=http` 后，已接通的页面（包括审计日志）改用后端；后端启动与接口说明见 [apps/server/README.md](apps/server/README.md)。审计以外的设置页面仍是模拟操作，不会持久化到后端。

### 环境要求

### 安装依赖

### 启动

在仓库根目录运行：



## 文档

- [项目简报](docs/project-brief.md)
- [打印机 Driver 接口草稿](docs/printer-driver-interface-draft.md)

## 许可证

[GPL-3.0-only](LICENSE)
