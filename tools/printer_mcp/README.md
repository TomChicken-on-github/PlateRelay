# 打印机只读调试 MCP

临时开发工具：让本机的 Claude Code 直接查拓竹打印机的状态，不用每次写脚本，也不用在看不见的终端里输访问码。用到什么功能再加。

## 只读

- MQTT 只发 `pushall`（30 秒内最多一次）和 `get_version`，发送前经过 daemon 的 `is_read_only_request` 检查，别的请求直接报错。
- FTPS 用 daemon 的 `ReadOnlyFTP`，上传、删除、改名等写操作命令会被拦下。
- 没有任何控制命令的入口。以后开发驱动真要发命令，另加工具，并且要用户当场同意。

## 第一次用：在自己的终端里保存打印机

```powershell
cd D:\Project\PlateRelay
uv run --project daemon --with keyring python tools/printer_mcp/server.py setup x2d
```

按提示输入 IP、序列号、访问码（访问码输入不显示）。三项一起存在 Windows 凭据管理器里（条目名 `platerelay-printer-debug`），不进仓库、不进日志。

其它命令：`... server.py list` 列出已保存的打印机，`... server.py forget x2d` 删除。

## 在 Claude Code 里用

仓库根目录的 `.mcp.json` 已注册 `printer-debug`。在仓库目录打开 Claude Code（或 Remote Control 会话），第一次会问是否启用这个项目 MCP，同意即可。

| 工具 | 作用 |
| --- | --- |
| `printers` | 已保存的打印机名字，第一个是默认 |
| `status` | 状态摘要：gcode_state、阶段、进度、温度、报错、device、AMS 概况 |
| `raw_report` | 合并后的原始上报 JSON，`path` 可过滤，如 `print.ams`、`print.device.extruder.info[0]` |
| `record` | 录 N 秒（≤600）的上报，返回逐条字段变化；原始报文存到 `tools/printer_mcp/captures/`（已 gitignore） |
| `version` | `get_version` 的固件和模块列表 |
| `ftp_list` | 列 FTPS 目录 |

注意：`raw_report` 对增量报文里的列表是整体替换，和 pybambu 按 id 合并不同，看 AMS 细节时以 `record` 的原始报文为准。

## 自测（不连真机）

```bash
uv run --project daemon --with "mcp>=1.2,<2" --with keyring --with pytest pytest tools/printer_mcp
```
