# PlateRelay

面向黑客松等公共资源场景的共享 3D 打印管理系统：选手提交 `.gcode.3mf`，经人工审核、排队派单、打印、铲件入库，到扫码取件。项目从 MVP 开始迭代。

## 先读

| 文档 | 内容 |
| --- | --- |
| [版本功能边界清单](docs/design/00-scope-and-principles.md) | 设计层文档第 0 份：非目标、取舍顺序、原则、不变量、v1 范围。**与简报冲突时以它为准。** |
| [项目简报](docs/project-brief.md) | 定位、已定决策、第一阶段范围、状态机、开放问题。**§0 与后文冲突时以 §0 为准。** |
| [Driver 接口草稿](docs/printer-driver-interface-draft.md) | 设备能力、标准状态、原始状态映射、报错处理、摄像头、存储、实测清单。 |
| [MD3 概况页规格](docs/ui/figma-md3-overview-spec.md) | 从 Figma 读出的概况页布局、颜色、字体、尺寸。[原型](docs/ui/platerelay-md3-prototype.html)是对照它做的静态页面，只作视觉参考。 |
| [打印机调试 MCP + TUI](tools/printer_mcp/README.md) | 本机 Claude Code 查打印机状态、录报文变化、列 FTPS 目录；访问码存 Windows 凭据管理器。调试真机优先用它，不要再临时写脚本。`control` 工具只能发白名单命令（暂停/继续/停止/腔室灯），**每次都要用户本人在确认框里二次确认**，不得代为确认或绕过。 |
| [X2D 上电抓包记录](docs/hardware/x2d-power-on-capture.md) | 上电后局域网上只有 SSDP（255.255.255.255:2021）和 ARP、DHCP 地址会漂、MQTT 约 1 秒一条整包、boot marker 候选字段。 |
| [只读探测脚本](tools/bambu_probe.py) | 对拓竹打印机做只读探测：MQTT 收状态、发一次 `pushall`、FTPS 只列目录。 |

文档里标【建议】【倾向】【待定】的条目不是用户的决定，实现前要先确认。

## 硬约束

- **不得向真实打印机发起打印**，也不得发送加热、移动、进退料、暂停、继续、停止、修改设置等控制命令，除非用户在当次任务里明确同意。只读请求（如 MQTT `pushall`）除外。
- 不得通过 FTPS 上传、删除或覆盖打印机存储里的文件，除非用户明确同意。
- 打印机访问码、密码、令牌等凭据不得写进代码、配置文件、日志或命令行参数。
- 卡片布局严格按 Figma 设计稿来，不自行重排。
- 技术栈以简报 §5.6 为准：面板 NestJS + React + PostgreSQL，daemon 用 Python，对象存储走 S3 兼容接口，协议 GPLv3。
