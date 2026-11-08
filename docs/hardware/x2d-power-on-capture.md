# X2D 实测记录：上电、访问码、U 盘、摄像头、一次完整打印（2026-11-08）

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

### 5. 刷新访问码

同一天接着测：打印机空闲，PC 挂着一个 MQTT 会话（连上时发过一次 `pushall`，之后只收不发），同时用 tshark 抓和打印机之间的全部流量，然后用户在打印机屏幕上点「刷新访问码」。

| 时间 | 事件 |
| --- | --- |
| 19:03:09.878 | 打印机对**所有**已连接的 MQTT 会话发 TCP FIN（当时有两个客户端，两个会话前后相差不到 1 毫秒），随后对还在发数据的一端回 RST |
| 19:03:09 | paho 报 `DISCONNECT`，断开前最后一条推送距离断开只有 0.16 秒，说明刷新前推送一直正常 |
| 19:03:15 | 用旧访问码自动重连，CONNACK 返回 `Not authorized` |
| 之后 | FTPS 用旧访问码登录返回 `530 Login incorrect`（只登录，没有任何文件操作） |

刷新前两分钟，用存着的访问码另开一个连接能正常登录，说明刷新前后的变化确实是这次刷新造成的。

结论：
- 刷新是**立刻生效**的，而且是打印机**主动踢掉所有会话**，不是等下次重连才失败。driver 断线后马上重连一次，看到 `Not authorized` 就能判定访问码失效。
- MQTT 和 FTPS 用的是同一个访问码，一起失效。
- 断开时没有任何 MQTT 层的提示报文，只能从重连结果判断原因。
- 打印中刷新会不会影响打印还没测（驱动草稿 §11 第 16 条）。

### 6. U 盘拔插、再次断电重启（19:21 到 19:24，空闲）

全程只订阅 `report`，**一条请求都没发**（不需要 `pushall`，X2D 本来就每秒推整包）。

**U 盘拔插**：
- 19:22:30 拔出：`sdcard` true → false，同时 `home_flag` 从 -1066969704 变成 -1066969960，正好差 `0x100`（第 8 位）。19:22:47 插回，两者都恢复。
- 拔出前 16 秒内 `cfg` 先后变过几次（`…DA19` → `…DA99` → `…DA91` → `…DA99`），同一时刻还收到腔室灯的 `system.ledctrl` 回执。这几次 `cfg` 变化更像是屏幕上的其他操作（比如开灯），不能当成 U 盘信号。
- 上报里没有看到剩余空间这一类字段。`device.ctc` 只有温度。剩余空间要靠 FTPS 查，或者暂时不报（`freeBytes` 本来就是可选的）。
- 所以 X2D 的「介质在位」用 `sdcard` 或者 `home_flag & 0x100` 都行，二者一致。「可写」目前只能等上传时才知道（早上那次无 U 盘时返回 553）。

**断电重启**：
- 最后一条推送在 19:23:03，之后完全没有包。**MQTT 没有收到任何断开通知**，直到 19:23:36 才因为心跳超时报 `disconnect`，晚了 33 秒。19:23:39 重连就成功了。
- 结论：**判断失联不能靠 TCP 断开，要靠「推送停了」**。X2D 正常每秒一条，连续 3 到 5 秒收不到就可以认为失联。
- 开机后的特征：
  - `ams.version` 从 66 掉到 9，之后几秒内涨到 14。早上那次开机后是 16，运行两个多小时后是 66。**它开机清零后单调上涨，可以当开机标记**：看到它比上一次明显变小，就说明重启过。
  - 重连后的几秒内，`report` 上还会冒出一串平时没有的回执：`info.get_version`、`security.get_sn`（MC、TH、AMS 各一条）、`liveview` 初始化、`system.get_accessories`。这些是打印机自己的模块在开机时互相查询，可以作为辅助判断。
  - `upgrade_state.idx2` 每次开机都会变成新值，`stat` 开机后有几秒是 `40248000`，然后回到 `40258000`。
  - AMS 的 `info` 从 `11001103` 变成 `21001103`，含义不明。

### 7. 摄像头

用 PyAV 只读拉 `rtsps://<IP>:322/streaming/live/1`（用户名 `bblp`，密码是访问码，只在进程内存里，不进命令行）：

- H.264，1920×1080，标称 30 帧，大约每秒一个关键帧，没有音轨。连上到出第一帧 2 到 3 秒。
- 同时开 2、3、4 路，每路都是满帧。6 路和 8 路也都连得上、不会被拒，但从第 3 路开始只有大约 12 帧。这可能是 PC 同时解码多路 1080p 吃不消，不一定是打印机在限流。
- 结论：daemon 只拉 1 路，在本地分发给多个观看者，不要让每个浏览器各自直连打印机。

### 8. 一次完整打印的遥测（19:27 到 20:07）

文件 `Belt_Clamp_With_Clamps.gcode.3mf`（单盘、只用 1 号耗材黑色 PETG Matte），用户同意后上传到 U 盘并下发 `project_file`，`ams_mapping` 为 `[1,-1,-1,-1,-1]`，`ams_mapping2` 第一项为 `{ams_id:0, slot_id:1}`，其余为 `{255,255}`，`timelapse: true`。除了这一条，全程只订阅不发。

**状态和准备阶段**（`stg_cur` 名称取自 pybambu `const.py`）：

| 时间 | `gcode_state` | `stg_cur` | 说明 |
| --- | --- | --- | --- |
| 19:27:34 | IDLE | -1 | 收到 `project_file` 回执 `result: SUCCESS` |
| 19:27:35 | PREPARE | -1 | 只持续 1 秒 |
| 19:27:36 | RUNNING | -1 → 29 → 13 → 74 → 11 → 73 → 4 → 8 → 14 → 54 → 1 | 腔室降温、归位、热床异物检测、识别板型、**打印板对齐检测**、换料、挤出标定、擦嘴、等热床、自动调平 |
| 19:34:32 | PAUSE | 1 | 用户在屏幕上暂停（`print.command = pause` 回执） |
| 19:35:14 | RUNNING | 1 → 3 → 39 → 51 → 0 | 振动补偿、喷嘴偏移标定、打印校准线，19:36:16 开始打第一层 |
| 20:07:26 | FINISH | -1 | `mc_percent = 100`，`layer_num = 75/75` |

- `PREPARE` 很短，driver 不能指望一定能看到它。准备阶段实际都在 `RUNNING` + `stg_cur` 里，`stg_cur = 0` 才是真正开始打。
- `FINISH` 之后一直停在 `FINISH`（之后 2 分钟以上都没变），`subtask_name`、`gcode_file` 也保留着，直到下一个任务。
- **暂停**时的变化：`gcode_state` RUNNING → PAUSE，`mc_print_stage` 和 `mc_stage` 2 → 3，`job.job_state` 4 → 5，`mc_action` 1 → 257，`print_real_action` 0 → 1，`stg_cur` 不变。第一次继续后紧跟的第二次 `resume` 被拒，回执 `reason: "ERROR STATE"`，说明重复点击会被打印机自己挡掉。
- 打印中除了每秒一条整包，还会夹带少量增量消息：`gcode_line` 回执 46 条（`M400` 等，打印机内部的），`pause` / `resume` / `project_file` 回执。增量消息里没有 `gcode_state`，合并时不能把缺失当成清空。
- **打印板放歪没被识别**：用户在准备阶段把打印板放歪，打印机跑过了「打印板对齐检测」（`stg_cur = 73`，19:29:14 到 19:29:29），但 `hms`、`print_error` 一直是空和 0，调平照常进行，用户手动暂停摆正。面板开打前的「放板确认」不能依赖打印机。

**结束时冒出的 HMS**：20:07:45（FINISH 后 19 秒）`hms` 出现一条 `{attr: 83886336, code: 196612}`，即 `0500_0100_0003_0004`，`print_error` 仍是 0。含义还没查。

**打印机时钟是错的**：这条 HMS 的 `ts_unix` 是 `20261104191203`，但 `ts_boot` 2666720 毫秒正好对应 19:23 开机后 44 分钟，也就是 20:07。打印机的墙上时间比实际慢了大约 3 天 23 小时（局域网模式下大概没有对时）。延时摄影文件名也是按这个错的时间起的。**daemon 不能用打印机给的时间戳排事件，要用自己收到消息的时间。**

**摄像头**：19:39:27 到 19:40:30 打印中拉了 1 路流 60 秒，29.5 帧。拉流前 2 分钟、拉流时、拉流后，MQTT 整包推送的平均间隔分别是 1.19、1.17、1.16 秒，**拉流不影响状态上报**。

**延时摄影**：
- `ipcam.timelapse` 在打第一层时从 `disable` 变成 `enable`，FINISH 时变回 `disable`，可以用它判断这一单有没有在录。
- `ipcam.tl_external_free_kb` 从开打起每分钟约少 33 MB，从 790128 一路降到 -422128（变成负数）。最终 mp4 只有 1.7 MB，所以这个值不是 U 盘真实的剩余空间，更像是录像缓存的估算余量。变成负数是否和结束时那条 HMS 有关，要再确认。
- 打完 FTPS 只读列 `/timelapse`：只有 `video_2026-11-04_18-40-53_4.mp4`（1.7 MB）和 `thumbnail/` 下同名的 `.jpg`、`_mini.jpg`。按上面的时钟偏差换算，`18-40-53` 正好是这次第一层开始的时刻（实际 19:36），所以**这就是本次的延时摄影**：一次打印一个 mp4，加两张缩略图，文件名是打印机本地时间的开始时刻。

### 9. 第二次打印：异物报错、屏幕处理、打印中刷新访问码、人工停止（20:41 到 20:45）

用户在打印板上留了上一次的打印件，同意后重新下发同一个文件（U 盘上已有同样大小的文件，没有重新上传）。之后用户全部在打印机屏幕上操作，PC 只订阅不发。报错时自动从摄像头抓了 3 张图（报错后 2、8、20 秒），存在 `tools/printer_mcp/captures/photos/`（不进仓库）。

| 时间 | 事件 | 上报 |
| --- | --- | --- |
| 20:41:31 | 进入热床异物检测 | `stg_cur = 74` |
| 20:41:39 | **检测到异物，自动暂停** | `gcode_state = PAUSE`，`mc_print_stage` 3，`print_error = ap_err = 83918958`（`0500_806E`），`err = "90500806E"`；1 秒后 `fail_reason` 也变成同一个值。**`hms` 没有新增条目** |
| 20:43:40 | 用户在屏幕上处理（移走异物后继续） | 收到 `print.command = "ignore"` 回执，`print_error`、`fail_reason` 立刻归零，回到 RUNNING，重新做异物检测 |
| 20:43:44 | **打印中刷新访问码** | 所有 MQTT 会话被踢，旧码重连 `Not authorized` |
| 20:44:33 | 用户用 TUI 填了新码，监听自动从凭据库读新码重连 | 第一条整包就是完整状态：RUNNING，`stg_cur = 73`。**打印没有受刷新影响**，失联 49 秒，没有漏掉状态 |
| 20:44:47 | **用户在屏幕上停止** | 收到 `print.command = "stop"` 回执；20:44:48 变成 `FAILED`，`mc_print_stage` 1 |
| 20:44:55 | | `print_error = 50348044`（`0300_400C`），20:44:56 `fail_reason` 跟着变成同一个值 |

结论：
- **报错要看 `print_error`，不能只看 `hms`。** 异物检测这种报错只出现在 `print_error`、`ap_err`、`fail_reason`，`hms` 列表里没有。
- **屏幕上处理报错后，`print_error` 立刻归零**，同时上报里会出现一条 `ignore`（或别的处理动作）的命令回执，但不是我们发的。driver 可以据此报 `clearedBy: "device"`。
- **打印中刷新访问码不影响打印。** 重连后第一条整包就能拿到完整的进度和状态。
- **人工停止落到 `FAILED`**，但 `print_error` 会变成 `0300_400C`，看起来是「任务被取消」的专用码（【推断】，要对照 HMS 资料确认）。如果确认，driver 就能区分「被人停止」和「真失败」，不用只靠记住自己发过的 `stop`。注意 `fail_reason` 在头 7 秒里还残留着上一次异物报错的值，判断要以 `print_error` 为准，并且等上报稳定几秒。
- 报错时的自动抓拍可行：从收到报错到存好第一张图约 2 秒（大部分时间花在建立 RTSP 连接上），画面能看清板上的异物。

### 10. 查资料补齐（2026-11-08）

**报错码含义**：拓竹把各机型的报错文案放在 Bambu Studio 仓库的 `resources/hms/` 下，按序列号前 3 位分文件。X2D 的序列号以 `20P` 开头，对应 `hms_en_20P.json`、`hms_zh-cn_20P.json`（版本 `202511162200`），里面分 `device_error`（对应 `print_error`，8 位）和 `device_hms`（对应 `hms` 的 `attr` + `code`，16 位）两张表。今天遇到的三个码：

| 码 | 来源字段 | 官方文案（英文表） | 实测场景 |
| --- | --- | --- | --- |
| `0500806E` | `print_error` | Foreign objects detected on heatbed; please check and clean up the heatbed. | §9 板上留异物 |
| `0300400C` | `print_error` | The task was canceled. | §9 屏幕上停止。**确认是「任务被取消」专用码** |
| `0500_0100_0003_0004` | `hms` | Not enough space on the USB flash drive. Video recording and timelapse recording cannot be performed. Please clear some space. | §8 打印结束后出现，正好对上 `tl_external_free_kb` 变成负数 |

所以 §8 里那个变成负数的 `tl_external_free_kb` 就是 U 盘给录像留的空间不够了，打印机报了「U 盘空间不足，录像和延时摄影无法进行」。但这次延时摄影的 mp4 还是生成了（1.7 MB），可能是录到一半停了，要再确认。driver 应该把 `tl_external_free_kb < 0` 或这条 HMS 报成存储告警。

**报错的处理选项**：同一目录下的 `hms_action_20P.json` 给每个 `ecode` 列出可用的按钮 ID（`actions`），这就是驱动草稿 §11 第 6 条要找的文件，**随 Bambu Studio 开源发布，可以离线用**。`0500806E` 对应的是 `[21]`，但 Bambu Studio 的 `DeviceErrorDialog.hpp` 里没有定义 21，说明这个按钮只在打印机屏幕上有。实测用户在屏幕上处理后，打印机发出的是 `ignore` 命令回执。

**打印机时钟**：拓竹论坛里多位用户反映，局域网模式下打印机不能指定本地 NTP 服务器，也不认 DHCP 下发的 NTP 选项，屏幕上不能手动设时间。打印机靠联网访问外部时间服务器对时，有人观察到它不是开机就对时，而是按周期对时。所以只要它能出网，时间最终会对上；被路由器拦了出网，时间就会一直错。这些都是用户报告，不是官方说明。驱动草稿 §5.5 已定以 daemon 时钟为准。

来源：[Bambu Studio `resources/hms`](https://github.com/bambulab/BambuStudio/tree/master/resources/hms)、[`DeviceErrorDialog.hpp`](https://github.com/bambulab/BambuStudio/blob/master/src/slic3r/GUI/DeviceErrorDialog.hpp)、[论坛：LAN mode system time no NTP](https://forum.bambulab.com/t/lan-mode-system-time-no-ntp/212547)、[论坛：Printer in LAN Mode connects to Internet](https://forum.bambulab.com/t/printer-in-lan-mode-connects-to-internet/139125)。

## 原始记录

脱敏后的原始报文、抓包摘要和报错照片在 [`x2d-2026-11-08/`](x2d-2026-11-08/README.md)。

## 后续可做

- 再断电一次，录 `ams.version`、`upgrade_state.idx2` 开机后的值，确认 boot marker。
- 在路由器上（或有线镜像口）抓一次，补上 DHCP 交互和打印机连云的流量。
