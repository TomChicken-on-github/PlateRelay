# X2D 实测原始记录（2026-11-08）

配合 [X2D 实测记录](../x2d-power-on-capture.md) 看，章节号对应那份文档。

| 文件 | 内容 | 对应章节 |
| --- | --- | --- |
| `1-boot-first-push.jsonl.gz` | 上电后第一次连 MQTT，发一次 `pushall`，录 90 秒 | §3、§4 |
| `2-idle-usb-reboot.jsonl.gz` | 空闲时只订阅：U 盘拔插、断电重启、重连 | §6 |
| `3-print1-belt-clamp.jsonl.gz` | 第一次打印全程：下发、准备阶段、人工暂停、打印中拉流、FINISH、结束时的 HMS | §8 |
| `4-print2-foreign-object-refresh-stop.jsonl.gz` | 第二次打印：异物报错暂停、屏幕处理、打印中刷新访问码（中间有约 49 秒断线）、人工停止 | §9 |
| `5-print3-belt-clamp-20261109.jsonl.gz` | 2026-11-09 第三次打印全程，正常完成，含下发前的空闲状态 | §11 |
| `6-print4-cmd-tests-20261109.jsonl.gz` | 2026-11-09 第四次打印：关连续录像、延时摄影命令被拒、异物报错后 `clean_print_error` 和 `resume`、打印中重复下发被拒 | §12 |
| `pcap-print3-printer-non-mqtt.tsv` | 第三次打印时打印机的非 MQTT 流量（SSDP、ARP、FTPS 控制连接和各连接的建立、关闭） | §11 |
| `pcap-boot-printer-packets.tsv` | 上电抓包里打印机（MAC `50:31:23:d8:82:08`）相关的包，只有时间、地址、协议和摘要 | §1 |
| `pcap-refresh-tcp-open-close.tsv` | 刷新访问码那次抓包里 8883 端口的 SYN、FIN、RST | §5 |
| `photos/` | 第二次打印前的板面，以及异物报错后 2、8、20 秒自动抓的画面 | §9 |

格式：每行一个 JSON。`_t` 是 PC 收到消息的 Unix 时间（秒）。`_event` 行是录制程序自己记的连接事件（`connack`、`disconnect`），其余行是打印机 `device/<SN>/report` 上的原始报文。第一份文件开头是 `{"_before": {}}`。

脱敏：打印机、AMS、主板、热端等所有序列号和芯片序列号都只保留前 4 位和后 4 位，中间换成 `*`。访问码不在任何文件里（导出时逐个检查过）。原始的 pcap 没有放进来，因为里面有局域网里其他设备的广播，SSDP 报文里也有完整序列号。

读法示例：

```python
import gzip, json
for line in gzip.open("3-print1-belt-clamp.jsonl.gz", "rt", encoding="utf-8"):
    r = json.loads(line)
    p = r.get("print", {})
    if "gcode_state" in p:
        print(r["_t"], p["gcode_state"], p.get("stg_cur"), p.get("print_error"))
```
