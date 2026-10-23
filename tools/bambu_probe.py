#!/usr/bin/env python3
"""
PlateRelay · 拓竹打印机只读探测脚本

只做三件事：
  1. 通过 MQTT 订阅打印机的状态上报，把收到的原始消息存成文件；
  2. 发一次 pushall（请求打印机推送一次完整状态，只读，不会让打印机动）；
  3. 通过 FTPS 列出存储里的目录（不上传、不下载、不删除）。

不会发出任何打印、加热、移动、暂停、停止之类的命令。
加 --passive 参数则连 pushall 都不发，完全只听。

前提：打印机已开启「仅局域网」+「开发者模式」，运行脚本的电脑和打印机在同一个局域网。

用法：
  pip install "paho-mqtt>=2"
  python bambu_probe.py --host 192.168.x.x --serial 打印机序列号 --seconds 60

访问码会在运行时询问，不会写进任何文件。
输出：
  probe_mqtt.jsonl   每行一条收到的 MQTT 消息（原始 JSON）
  probe_summary.txt  关键字段汇总 + FTPS 目录列表
"""

import argparse
import ftplib
import getpass
import json
import ssl
import sys
import time

try:
    import paho.mqtt.client as mqtt
except ImportError:
    sys.exit('缺少 paho-mqtt，请先运行：pip install "paho-mqtt>=2"')

USER = "bblp"

# 想在汇总里重点看的字段（找不到就算了，原始数据都在 jsonl 里）
KEYS_OF_INTEREST = [
    "gcode_state", "stg_cur", "mc_print_stage", "print_error", "hms",
    "print_type", "subtask_name", "gcode_file", "mc_percent", "mc_remaining_time",
    "layer_num", "total_layer_num", "sdcard", "home_flag", "fun",
    "nozzle_diameter", "nozzle_type", "device", "ipcam", "upgrade_state",
]


def collect_keys(obj, found, path=""):
    """递归找出感兴趣的字段，记下每个字段出现过的值。"""
    if isinstance(obj, dict):
        for k, v in obj.items():
            p = f"{path}.{k}" if path else k
            if k in KEYS_OF_INTEREST:
                s = json.dumps(v, ensure_ascii=False)
                if len(s) > 300:
                    s = s[:300] + "…"
                found.setdefault(p, set()).add(s)
            collect_keys(v, found, p)
    elif isinstance(obj, list):
        for item in obj:
            collect_keys(item, found, path + "[]")


def probe_mqtt(host, serial, code, seconds, passive):
    found = {}
    count = {"n": 0}
    out = open("probe_mqtt.jsonl", "w", encoding="utf-8")

    def on_connect(client, userdata, flags, reason_code, properties):
        print(f"[MQTT] 连接结果：{reason_code}")
        client.subscribe(f"device/{serial}/report")
        if not passive:
            # 只读：请求打印机推送一次完整状态
            req = {"pushing": {"sequence_id": "1", "command": "pushall"}}
            client.publish(f"device/{serial}/request", json.dumps(req))
            print("[MQTT] 已发送 pushall（只读请求）")

    def on_message(client, userdata, msg):
        count["n"] += 1
        raw = msg.payload.decode("utf-8", errors="replace")
        out.write(raw + "\n")
        try:
            collect_keys(json.loads(raw), found)
        except json.JSONDecodeError:
            pass

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.username_pw_set(USER, code)
    # 打印机用的是自签名证书，这里不校验证书（只在局域网内用于探测）
    client.tls_set(cert_reqs=ssl.CERT_NONE)
    client.tls_insecure_set(True)
    client.on_connect = on_connect
    client.on_message = on_message

    print(f"[MQTT] 连接 {host}:8883 ……")
    try:
        client.connect(host, 8883, keepalive=30)
    except Exception as e:
        out.close()
        return f"MQTT 连接失败：{e!r}\n", {}
    client.loop_start()
    time.sleep(seconds)
    client.loop_stop()
    client.disconnect()
    out.close()
    return f"MQTT 共收到 {count['n']} 条消息\n", found


class ImplicitFTPS(ftplib.FTP_TLS):
    """隐式 TLS 的 FTPS（端口 990）。标准库默认是显式 TLS，需要这样包一层。"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._sock = None

    @property
    def sock(self):
        return self._sock

    @sock.setter
    def sock(self, value):
        if value is not None and not isinstance(value, ssl.SSLSocket):
            value = self.context.wrap_socket(value, server_hostname=self.host)
        self._sock = value

    def ntransfercmd(self, cmd, rest=None):
        # 数据连接复用控制连接的 TLS 会话，不少 FTPS 服务端要求这样
        conn, size = ftplib.FTP.ntransfercmd(self, cmd, rest)
        if self._prot_p:
            conn = self.context.wrap_socket(
                conn, server_hostname=self.host, session=self.sock.session
            )
        return conn, size


def probe_ftps(host, code):
    lines = []
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    ftp = ImplicitFTPS(context=ctx, timeout=15)
    try:
        ftp.connect(host, 990)
        ftp.login(USER, code)
        ftp.prot_p()
        lines.append("FTPS 登录成功")
        root = ftp.nlst()
        lines.append(f"根目录：{root}")
        # 只列目录，不下载任何文件
        for name in root:
            try:
                sub = ftp.nlst(name)
                shown = sub[:30]
                more = f" …（共 {len(sub)} 项）" if len(sub) > 30 else ""
                lines.append(f"  {name}/ → {shown}{more}")
            except ftplib.all_errors:
                pass  # 是文件不是目录，或者没权限，跳过
        ftp.quit()
    except Exception as e:
        lines.append(f"FTPS 失败：{e!r}")
    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser(description="拓竹打印机只读探测（不会发起打印）")
    ap.add_argument("--host", required=True, help="打印机 IP")
    ap.add_argument("--serial", required=True, help="打印机序列号")
    ap.add_argument("--seconds", type=int, default=60, help="监听多少秒，默认 60")
    ap.add_argument("--passive", action="store_true", help="完全只听，连 pushall 也不发")
    ap.add_argument("--skip-ftps", action="store_true", help="跳过 FTPS 目录列表")
    args = ap.parse_args()

    code = getpass.getpass("局域网访问码（输入时不显示）：")

    summary, found = probe_mqtt(args.host, args.serial, code, args.seconds, args.passive)
    report = [summary, "\n== 关键字段出现过的值 ==\n"]
    for k in sorted(found):
        report.append(f"{k}:\n")
        for v in sorted(found[k]):
            report.append(f"    {v}\n")

    if not args.skip_ftps:
        print("[FTPS] 列目录 ……")
        report.append("\n== FTPS ==\n")
        report.append(probe_ftps(args.host, code))

    with open("probe_summary.txt", "w", encoding="utf-8") as f:
        f.writelines(report)
    print("完成：probe_mqtt.jsonl、probe_summary.txt")


if __name__ == "__main__":
    main()
