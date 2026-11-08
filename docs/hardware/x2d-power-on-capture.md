# X2D 上电抓包记录（2026-11-08）

对象：拓竹 X2D（型号代号 N6，SN 20P6BJ\*\*\*\*1799，固件 01.02.00.00），Wi-Fi 接入，局域网模式。

目的：看打印机从断电到上电联网会往局域网发什么，给自动发现（F-PRT-12）和「上电恢复 / boot marker」驱动测试项提供实测依据。

## 方法

- 抓包：PC（PLANA-CORE，WLAN 192.168.0.103）上用 tshark 4.6.8 + Npcap 被动抓 WLAN 网卡，捕获过滤器 `arp or broadcast or multicast or (ip and src net 192.168.0.0/24 and dst net 192.168.0.0/24)`。16:50:53 开始，16:56:59 结束（UTC+9），打印机在抓包开始时处于断电状态。
- MQTT：开机稳定后用调试 MCP 的 `PrinterConnection` 连一次 8883，订阅 `device/<SN>/report`，**只发了一次 `pushall`**（这次把 `get_version` 也拦掉了），录 90 秒，16:54:39 连上，16:56:10 断开。没有发任何控制命令，没有碰 FTPS。
- 原始文件不进仓库：pcap 在会话临时目录，MQTT 报文在 `tools/printer_mcp/captures/`（已 gitignore）。

局限：PC 走 Wi-Fi，又没有监控模式，只能看到广播、组播和发给本机的包。打印机和路由器之间的单播（DHCP Offer/ACK 如果是单播、连拓竹云的流量）看不到。

## 结果

### 1. 局域网上能看到的只有 SSDP 和 ARP

整个过程打印机（MAC `50:31:23:d8:82:08`，厂商 FN-LINK，即 Wi-Fi 模组）只发了两种包：

| 时间 | 包 | 说明 |
| --- | --- | --- |
| 16:51:54 | UDP 192.168.0.104:2021 → 255.255.255.255:2021 | 第一包就是 SSDP NOTIFY，此时已经有 IP |
| 16:51:58 | ARP Who has 192.168.0.1? | 找网关，之后约每 30 秒一次 |
| 16:52:09 起 | SSDP NOTIFY | 第一包后隔了 15 秒，之后稳定约 5 秒一次 |

共 52 个 SSDP，平均间隔 5.8 秒，最长 15.1 秒。

**没有看到**：DHCP（Discover/Request 按理是广播，但这台 AP 没有转给其他无线客户端，或者打印机在抓到前已经续约）、mDNS、LLMNR、IGMP、ICMPv6、免费 ARP。所以对这台机器来说，**SSDP 是唯一能被动发现它的信号**。

这次拿到的 IP 是 **192.168.0.104**。之前见过 .106 和 .103（.103 现在是 PC 自己），说明 DHCP 地址会漂，自动发现必须按序列号认机器、IP 变了要跟着改（F-PRT-12 里的「同一序列号换了 IP 时自动更新地址」是必要的）。调试 MCP 的凭据条目里存的是 .106，这次已经改成 .104（只改 host 字段）。

### 2. SSDP 报文内容

发往 `255.255.255.255:2021`，不是标准 SSDP 的 `239.255.255.250:1900`，虽然报文里写的 `Host` 是 `239.255.255.250:1990`：

```
NOTIFY * HTTP/1.1
Host: 239.255.255.250:1990
Server: UPnP/1.0
Location: 192.168.0.104
NT: urn:bambulab-com:device:3dprinter:1
NTS: ssdp:alive
USN: <完整序列号>
Cache-Control: max-age=1800
DevModel.bambu.com: N6
DevName.bambu.com: <用户设置的机器名，UTF-8>
DevConnect.bambu.com: lan
DevBind.bambu.com: free
Devseclink.bambu.com: secure
DevInf.bambu.com: wlan0
DevVersion.bambu.com: 01.02.00.00
DevCap.bambu.com: 1
```

- `Location` 只是 IP，没有 URL。
- `DevConnect: lan` 表示局域网模式，`DevBind: free` 表示没绑云账号。
- `DevName` 是 UTF-8，解析时不要按 Latin-1 解。
- 现有 `tools/printer_mcp/server.py` 的 `SSDP_PORTS = (1990, 2021)` 能覆盖到。

### 3. MQTT 首批推送

- TCP 握手到 MQTT CONNACK 不到 1 秒，这时 8883 早已就绪（是在第一条 SSDP 之后约 2 分 45 秒才连的，更早能否连上这次没测）。
- 连上后 **每 1.0 到 1.4 秒推一条完整的 `push_status`**（约 9.4 KB，99 个顶层字段，`sequence_id` 固定是 `"2021"`，`msg = 0`），90 秒内 78 条，期间只有喷嘴温度在 16 和 17 之间跳。11-04 那次非开机的录制里也是同样的整包高频推送，所以 **这是 X2D 的常态，不是开机特有的**。daemon 不能假设「先一条全量、后面都是增量」。
- 开机后的状态：`gcode_state = IDLE`，`mc_print_stage = "1"`，`stg_cur = -1`，`print_error = 0`，`hms = []`，`sdcard = false`，`upgrade_state.status = IDLE`，`lights_report` 里腔室灯 `off`、工作灯 `flashing`，`wifi_signal = -63dBm`，`net.info[0].ip = 1744873664`（小端序即 192.168.0.104），`ipcam.rtsp_url` 跟着换成了新 IP。
- 上一次的任务字段（`subtask_name`、`gcode_file`、`job_id`、`task_id` 等）全部是空的，**断电后不会保留上一个任务**。

### 4. 有没有 boot marker

报文里**没有**开机时间、启动计数或 uptime 这类明确字段。和 11-04 的非开机录制对比，除了温度、IP 和 AMS 湿度，只有这几个字段不同：

| 字段 | 11-04（运行中） | 11-08（刚开机） | 推测 |
| --- | --- | --- | --- |
| `ams.version` | 1015 | 16 | 可能是 AMS 数据的变化计数，开机清零后从小数开始。**最像可用的开机标记**，但要再断电一次确认是否每次都回到小值 |
| `upgrade_state.idx2` | 349620987 | 1833516203 | 每次不同，含义不明 |
| `cfg` | `4C92057DA99` | `4C92057DA19` | 配置位图，差一位，可能和灯或别的开关有关 |
| `care[1].info` | `118190D` | `C21909` | 含义不明 |
| `lights_report[0].mode` | `on` | `off` | 腔室灯开机默认关 |

【待定】在找到可靠字段之前，daemon 判断「打印机重启过」可以用这几个组合信号：MQTT 断开后重连、`ams.version` 明显变小、上一个任务的 `job_id` / `task_id` 变成空。这需要再做一次断电实验验证。

## 后续可做

- 再断电一次，录 `ams.version`、`upgrade_state.idx2` 开机后的值，确认 boot marker。
- 在路由器上（或有线镜像口）抓一次，补上 DHCP 交互和打印机连云的流量。
