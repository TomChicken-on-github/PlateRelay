# 打印机调试 MCP + TUI

临时开发工具：让本机的 Claude Code 直接查拓竹打印机的状态，不用每次写脚本，也不用在看不见的终端里输访问码。用到什么功能再加。

## 读和写分开

- **只读**：MQTT 只发 `pushall`（30 秒内最多一次）和 `get_version`，经过 daemon 的 `is_read_only_request` 检查（`_send`），别的请求直接报错。FTPS 用 daemon 的 `ReadOnlyFTP`，上传、删除、改名等写操作命令会被拦下。
- **控制**：只有白名单里的 5 条命令，报文取自 pybambu `commands.py`，走单独的出口 `_send_control`，日志只记命令名。不做任意 JSON 透传，不能起打印、不能上传文件。

| 命令 | 作用 |
| --- | --- |
| `pause` | 暂停打印 |
| `resume` | 继续打印 |
| `stop` | 停止打印（不能恢复） |
| `light_on` / `light_off` | 腔室灯开 / 关 |

**每条控制命令都必须由人二次确认，Claude 不能代为确认：**

- TUI：选完命令后显示打印机名、IP、当前 `gcode_state` 和命令，确认框默认“否”。
- MCP 工具 `control`：先过 Claude Code 自己的工具权限提示（项目 `.claude/settings.json` 里把它设成了 `ask`，**不要把 `mcp__printer-debug__control` 加进 allow 列表**）；然后服务端用 MCP elicitation 弹确认框，内容同上，只有点“接受”并勾选确认才发送。拒绝、取消、5 分钟超时、客户端不支持确认框，一律不发送。

## 第一次用：在自己的终端里打开 TUI

```powershell
cd D:\Project\PlateRelay
uv run --project daemon --with keyring --with questionary python tools/printer_mcp/server.py menu
```

↑↓ 选择，回车确定；任何一步按两下 Esc 返回（第一下会提示，2 秒内再按一下确认），连接、扫描等待中按 Ctrl+C 中断：

- **查看状态**：状态摘要和 AMS 各槽的料。
- **控制打印机（需要确认）**：见上表。
- **扫描局域网添加**：约 10 秒，只监听拓竹打印机的 SSDP 广播（UDP 1990 / 2021），不向打印机发任何包。拓竹软件（Bambu Studio / Orca）开着时可能占用端口，扫不到就先关掉再试。
- **手动添加**：填 IP、序列号、访问码。
- **删除已保存的打印机**。

打印机按序列号认：扫到或手动填的序列号已经保存过，就直接更新那一条的 IP 和访问码（访问码留空表示不变），不会再多出一台。`setup` 用新名字保存同一序列号时，也会替换旧条目。改完不用重启 MCP，下次调用工具时它发现配置变了会自动按新配置重连。

访问码输入不显示。IP、序列号、访问码一起存在 Windows 凭据管理器里（条目名 `platerelay-printer-debug`），不进仓库、不进日志。

其它命令：`server.py scan` 只扫描，`server.py list` 列出已保存，`server.py setup <名字>` 手动保存，`server.py forget <名字>` 删除。

## 在 Claude Code 里用

仓库根目录的 `.mcp.json` 已注册 `printer-debug`。在仓库目录打开 Claude Code（或 Remote Control 会话），第一次会问是否启用这个项目 MCP，同意即可。

| 工具 | 作用 |
| --- | --- |
| `printers` | 已保存的打印机名字，第一个是默认 |
| `status` | 状态摘要：gcode_state、阶段、进度、温度、报错、喷嘴、AMS 概况 |
| `raw_report` | 合并后的原始上报 JSON，`path` 可过滤，如 `print.ams`、`print.device.extruder.info[0]` |
| `record` | 录 N 秒（≤600）的上报，返回逐条字段变化；原始报文存到 `tools/printer_mcp/captures/`（已 gitignore） |
| `version` | `get_version` 的固件和模块列表 |
| `ftp_list` | 列 FTPS 目录 |
| `control` | 发送白名单控制命令，**每次都要人工二次确认** |

注意：`raw_report` 对增量报文里的列表是整体替换，和 pybambu 按 id 合并不同，看 AMS 细节时以 `record` 的原始报文为准。

## 自测（不连真机）

```bash
uv run --project daemon --with "mcp>=1.2,<2" --with keyring --with questionary --with pytest pytest tools/printer_mcp
```

控制路径用假的 MQTT client 测：白名单、拒绝 / 取消 / 未勾选 / 超时 / 客户端不支持确认框时都不发送，确认后只发一条；另有经过真实 MCP 客户端（内存连接）的端到端测试。
