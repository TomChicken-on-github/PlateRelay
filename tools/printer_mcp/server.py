"""PlateRelay · 打印机只读调试 MCP（临时开发工具，用到什么加什么）

给本机的 Claude Code 用：保持一条到拓竹打印机的 MQTT 连接，缓存最新状态，
可以查状态、看原始报文、录一段时间的变化、列 FTPS 目录。

只读：
  - MQTT 只会发 pushall 和 get_version，经过 daemon 的 is_read_only_request 检查，
    其它任何请求直接抛异常。本文件没有任何控制命令的入口。
  - FTPS 用 daemon 的 ReadOnlyFTP，写操作命令（上传、删除、改名……）会被拦下。

凭据：
  打印机的地址、序列号、访问码存在系统凭据库（Windows 上是凭据管理器），
  不进仓库、不进日志、不走命令行参数。先在自己的终端里运行一次设置菜单（可扫描局域网或手动输入）：
    uv run --project daemon --with keyring python tools/printer_mcp/server.py menu

用法见同目录 README.md。
"""

from __future__ import annotations

import argparse
import getpass
import json
import logging
import ssl
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "daemon" / "src"))

from platerelay_daemon.drivers.bambu.read_only import (  # noqa: E402
    ReadOnlyFTP,
    is_read_only_request,
)

LOGGER = logging.getLogger("printer_mcp")
KEYRING_SERVICE = "platerelay-printer-debug"
INDEX_KEY = "__printers__"
CAPTURE_DIR = Path(__file__).resolve().parent / "captures"
# pushall 不要发得太勤，P1 系列被刷太快会卡。
PUSHALL_MIN_INTERVAL = 30.0

SUMMARY_KEYS = [
    "gcode_state", "mc_print_stage", "stg_cur", "print_type", "subtask_name",
    "gcode_file", "mc_percent", "mc_remaining_time", "layer_num", "total_layer_num",
    "print_error", "hms", "nozzle_temper", "nozzle_target_temper", "bed_temper",
    "bed_target_temper", "chamber_temper", "wifi_signal", "sdcard", "home_flag",
]


# ---------- 凭据 ----------

def _keyring():
    try:
        import keyring
    except ImportError:
        sys.exit("缺少 keyring：请用 `uv run --project daemon --with keyring ...` 运行")
    return keyring


def list_printers() -> list[str]:
    raw = _keyring().get_password(KEYRING_SERVICE, INDEX_KEY)
    return json.loads(raw) if raw else []


def load_printer(name: str | None) -> tuple[str, dict[str, str]]:
    names = list_printers()
    if not names:
        raise RuntimeError("还没有配置打印机，请先在自己的终端里运行 setup")
    name = name or names[0]
    raw = _keyring().get_password(KEYRING_SERVICE, name)
    if not raw:
        raise RuntimeError(f"没有名为 {name!r} 的打印机，已配置：{', '.join(names)}")
    return name, json.loads(raw)


def save_printer(name: str, host: str, serial: str, code: str) -> None:
    kr = _keyring()
    kr.set_password(KEYRING_SERVICE, name, json.dumps({"host": host, "serial": serial, "access_code": code}))
    names = list_printers()
    if name not in names:
        names.append(name)
        kr.set_password(KEYRING_SERVICE, INDEX_KEY, json.dumps(names))
    print(f"已保存 {name}（{host}）。已配置：{', '.join(list_printers())}")


def setup(name: str) -> None:
    host = input("打印机 IP：").strip()
    serial = input("序列号：").strip()
    code = getpass.getpass("访问码（输入不显示）：").strip()
    if not (host and serial and code):
        sys.exit("三项都不能为空")
    save_printer(name, host, serial, code)


# ---------- 局域网发现：只监听拓竹的 SSDP 广播，不发任何包 ----------

SSDP_PORTS = (1990, 2021)
SSDP_GROUP = "239.255.255.250"


def parse_ssdp(data: bytes, addr_ip: str) -> dict[str, str] | None:
    try:
        text = data.decode("utf-8", "replace")
    except Exception:  # noqa: BLE001
        return None
    headers: dict[str, str] = {}
    for line in text.splitlines()[1:]:
        if ":" in line:
            k, v = line.split(":", 1)
            headers[k.strip().lower()] = v.strip()
    if "bambulab" not in headers.get("nt", "").lower() or not headers.get("usn"):
        return None
    return {
        "serial": headers["usn"],
        "host": headers.get("location") or addr_ip,
        "model": headers.get("devmodel.bambu.com", "?"),
        "name": headers.get("devname.bambu.com", ""),
        "connect": headers.get("devconnect.bambu.com", ""),
    }


def discover(seconds: float = 10.0) -> list[dict[str, str]]:
    import select
    import socket

    socks = []
    for port in SSDP_PORTS:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(("", port))
        except OSError as e:
            print(f"  （端口 {port} 监听不了：{e}，可能被拓竹软件占用，先关掉它再试）")
            s.close()
            continue
        try:
            mreq = socket.inet_aton(SSDP_GROUP) + socket.inet_aton("0.0.0.0")
            s.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
        except OSError:
            pass  # 收不到组播也还能收广播
        socks.append(s)
    found: dict[str, dict[str, str]] = {}
    end = time.time() + seconds
    try:
        while socks and time.time() < end:
            ready, _, _ = select.select(socks, [], [], 0.5)
            for s in ready:
                data, addr = s.recvfrom(4096)
                info = parse_ssdp(data, addr[0])
                if info and info["serial"] not in found:
                    found[info["serial"]] = info
                    print(f"  发现：{info['name'] or '?'}  {info['model']}  {info['host']}")
    finally:
        for s in socks:
            s.close()
    return list(found.values())


def _slug(text: str, fallback: str) -> str:
    out = "".join(ch.lower() if ch.isalnum() else "-" for ch in text).strip("-")
    return out or fallback


def _ask_and_save(host: str, serial: str, default_name: str) -> None:
    name = input(f"给它起个名字 [{default_name}]：").strip() or default_name
    code = getpass.getpass("访问码（在打印机屏幕上看，输入不显示）：").strip()
    if not code:
        print("访问码为空，没有保存")
        return
    save_printer(name, host, serial, code)


def menu() -> None:
    while True:
        names = list_printers()
        print("\n== PlateRelay 打印机调试 · 设置 ==")
        print(f"已保存：{', '.join(names) or '无'}")
        print("  1) 扫描局域网（只听广播，约 10 秒）")
        print("  2) 手动输入")
        print("  3) 删除已保存的打印机")
        print("  0) 退出")
        choice = input("> ").strip()
        if choice == "1":
            print("正在监听……打印机要开着并在同一局域网")
            found = discover()
            if not found:
                print("没有发现。可以多试一次，或者选 2 手动输入")
                continue
            for i, p in enumerate(found, 1):
                print(f"  {i}) {p['name'] or '?'}  型号 {p['model']}  {p['host']}  序列号 {p['serial']}")
            pick = input("选哪台（回车取消）：").strip()
            if pick.isdigit() and 1 <= int(pick) <= len(found):
                p = found[int(pick) - 1]
                _ask_and_save(p["host"], p["serial"], _slug(p["name"], p["serial"][-6:].lower()))
        elif choice == "2":
            host = input("打印机 IP：").strip()
            serial = input("序列号：").strip()
            if host and serial:
                _ask_and_save(host, serial, "printer")
            else:
                print("IP 和序列号都不能为空")
        elif choice == "3":
            if not names:
                continue
            for i, n in enumerate(names, 1):
                print(f"  {i}) {n}")
            pick = input("删除哪台（回车取消）：").strip()
            if pick.isdigit() and 1 <= int(pick) <= len(names):
                forget(names[int(pick) - 1])
        elif choice in ("0", "q", ""):
            return


def forget(name: str) -> None:
    kr = _keyring()
    try:
        kr.delete_password(KEYRING_SERVICE, name)
    except Exception:  # noqa: BLE001
        pass
    names = [n for n in list_printers() if n != name]
    kr.set_password(KEYRING_SERVICE, INDEX_KEY, json.dumps(names))
    print(f"已删除 {name}。剩下：{', '.join(names) or '无'}")


# ---------- 报文处理 ----------

def deep_merge(dst: dict, src: dict) -> None:
    """把增量报文合并进缓存。列表整体替换（原始调试用，不做 pybambu 那种按 id 合并）。"""
    for k, v in src.items():
        if isinstance(v, dict) and isinstance(dst.get(k), dict):
            deep_merge(dst[k], v)
        else:
            dst[k] = v


def flatten(obj: Any, prefix: str = "") -> dict[str, Any]:
    out: dict[str, Any] = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            out.update(flatten(v, f"{prefix}.{k}" if prefix else str(k)))
    elif isinstance(obj, list):
        if not obj:
            out[prefix] = []
        for i, v in enumerate(obj):
            out.update(flatten(v, f"{prefix}[{i}]"))
    else:
        out[prefix] = obj
    return out


def get_path(obj: Any, path: str | None) -> Any:
    """按 a.b[0].c 取值。"""
    if not path:
        return obj
    cur = obj
    for part in path.replace("[", ".[").split("."):
        if not part:
            continue
        if part.startswith("["):
            cur = cur[int(part[1:-1])]
        else:
            cur = cur[part]
    return cur


# ---------- 连接 ----------

class PrinterConnection:
    def __init__(self, name: str, cfg: dict[str, str]) -> None:
        import paho.mqtt.client as mqtt

        self.name = name
        self.host = cfg["host"]
        self.serial = cfg["serial"]
        self._code = cfg["access_code"]
        self.state: dict[str, Any] = {}
        self.version: dict[str, Any] | None = None
        self.connected = threading.Event()
        self.last_message_at: float | None = None
        self._last_pushall = 0.0
        self._seq = 0
        self._lock = threading.Lock()
        self._listeners: list[list[tuple[float, dict]]] = []

        c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"platerelay-debug-{int(time.time())}")
        c.username_pw_set("bblp", self._code)
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE  # 拓竹局域网是自签证书
        c.tls_set_context(ctx)
        c.on_connect = self._on_connect
        c.on_disconnect = self._on_disconnect
        c.on_message = self._on_message
        c.reconnect_delay_set(1, 30)
        self._client = c
        c.connect_async(self.host, 8883, keepalive=60)
        c.loop_start()

    def _on_connect(self, client, userdata, flags, reason_code, properties) -> None:
        if reason_code.is_failure:
            LOGGER.warning("[%s] MQTT 连接失败：%s", self.name, reason_code)
            return
        LOGGER.info("[%s] MQTT 已连接", self.name)
        client.subscribe(f"device/{self.serial}/report")
        self.connected.set()
        self._send({"pushing": {"command": "pushall"}}, force=True)
        self._send({"info": {"command": "get_version"}})

    def _on_disconnect(self, client, userdata, flags, reason_code, properties) -> None:
        self.connected.clear()
        LOGGER.info("[%s] MQTT 断开：%s", self.name, reason_code)

    def _on_message(self, client, userdata, msg) -> None:
        try:
            data = json.loads(msg.payload)
        except ValueError:
            return
        now = time.time()
        with self._lock:
            self.last_message_at = now
            if isinstance(data.get("print"), dict):
                deep_merge(self.state, {"print": data["print"]})
            if isinstance(data.get("info"), dict) and data["info"].get("command") == "get_version":
                self.version = data["info"]
            for k, v in data.items():
                if k not in ("print", "info") and isinstance(v, dict):
                    deep_merge(self.state, {k: v})
            for buf in self._listeners:
                buf.append((now, data))

    def _send(self, msg: dict, *, force: bool = False) -> bool:
        # 唯一的发送出口。只放行 daemon 白名单里的只读请求。
        if not is_read_only_request(msg):
            raise PermissionError("只读调试工具不发送控制命令")
        if msg.get("pushing", {}).get("command") == "pushall":
            if not force and time.time() - self._last_pushall < PUSHALL_MIN_INTERVAL:
                return False
            self._last_pushall = time.time()
        self._seq += 1
        body = dict(next(iter(msg.values())), sequence_id=str(self._seq))
        payload = {next(iter(msg)): body}
        self._client.publish(f"device/{self.serial}/request", json.dumps(payload))
        return True

    def wait_ready(self, timeout: float = 15.0) -> None:
        if not self.connected.wait(timeout):
            raise RuntimeError(f"{self.name}（{self.host}）{timeout:.0f} 秒内没连上 MQTT，检查局域网模式、IP 和访问码")
        end = time.time() + timeout
        while not self.state and time.time() < end:
            time.sleep(0.2)

    def refresh(self) -> bool:
        sent = self._send({"pushing": {"command": "pushall"}})
        if sent:
            time.sleep(1.5)
        return sent

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return json.loads(json.dumps(self.state))

    def record(self, seconds: float) -> tuple[dict, list[tuple[float, dict]]]:
        buf: list[tuple[float, dict]] = []
        with self._lock:
            before = json.loads(json.dumps(self.state))
            self._listeners.append(buf)
        try:
            time.sleep(seconds)
        finally:
            with self._lock:
                self._listeners.remove(buf)
        return before, buf

    def ftp_list(self, path: str) -> list[str]:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        ftp = ReadOnlyFTP(context=ctx)
        ftp.connect(host=self.host, port=990, timeout=15)
        try:
            ftp.login(user="bblp", passwd=self._code)
            ftp.prot_p()
            lines: list[str] = []
            ftp.retrlines(f"LIST {path}", lines.append)
            return lines
        finally:
            try:
                ftp.quit()
            except Exception:  # noqa: BLE001
                ftp.close()


_connections: dict[str, PrinterConnection] = {}


def conn(printer: str | None) -> PrinterConnection:
    name, cfg = load_printer(printer)
    if name not in _connections:
        _connections[name] = PrinterConnection(name, cfg)
    c = _connections[name]
    c.wait_ready()
    return c


def diff_messages(before: dict, msgs: list[tuple[float, dict]], path: str | None) -> list[str]:
    """逐条报文合并，只列出叶子字段的变化。"""
    state = json.loads(json.dumps(before))
    prev = flatten(state)
    t0 = msgs[0][0] if msgs else 0.0
    out: list[str] = []
    for t, data in msgs:
        for k, v in data.items():
            if isinstance(v, dict) and not (k == "info" and v.get("command") == "get_version"):
                deep_merge(state, {k: v})
        cur = flatten(state)
        for key in sorted(set(prev) | set(cur)):
            if path and not key.startswith(path):
                continue
            a, b = prev.get(key, "<无>"), cur.get(key, "<无>")
            if a != b:
                out.append(f"+{t - t0:6.1f}s  {key}: {json.dumps(a, ensure_ascii=False)} → {json.dumps(b, ensure_ascii=False)}")
        prev = cur
    return out


# ---------- MCP ----------

def build_server():
    from mcp.server.fastmcp import FastMCP

    mcp = FastMCP("platerelay-printer-debug")

    @mcp.tool()
    def printers() -> str:
        """列出已配置的打印机名字（不含凭据）。第一个是默认打印机。"""
        names = list_printers()
        return json.dumps({"printers": names, "connected": [n for n, c in _connections.items() if c.connected.is_set()]}, ensure_ascii=False)

    @mcp.tool()
    def status(printer: str | None = None, refresh: bool = False) -> str:
        """当前状态摘要（gcode_state、阶段、进度、温度、报错等）。refresh=True 会发一次只读 pushall（30 秒内最多一次）。"""
        c = conn(printer)
        if refresh:
            c.refresh()
        p = c.snapshot().get("print", {})
        summary = {k: p[k] for k in SUMMARY_KEYS if k in p}
        if "device" in p:
            summary["device"] = p["device"]
        if "ams" in p:
            summary["ams_exist_bits"] = p["ams"].get("ams_exist_bits")
            summary["ams_units"] = len(p["ams"].get("ams", []))
        summary["_age_s"] = round(time.time() - c.last_message_at, 1) if c.last_message_at else None
        return json.dumps({"printer": c.name, "status": summary}, ensure_ascii=False, indent=1)

    @mcp.tool()
    def raw_report(path: str | None = None, printer: str | None = None, refresh: bool = False) -> str:
        """合并后的原始上报 JSON。path 用点号和下标过滤，例如 "print.ams"、"print.device.extruder.info[0]"。
        注意：增量报文里的列表是整体替换的，和 pybambu 按 id 合并不同。"""
        c = conn(printer)
        if refresh:
            c.refresh()
        try:
            value = get_path(c.snapshot(), path)
        except (KeyError, IndexError, ValueError, TypeError):
            return f"路径不存在：{path}"
        return json.dumps(value, ensure_ascii=False, indent=1)

    @mcp.tool()
    def record(seconds: float = 30, path: str | None = None, printer: str | None = None) -> str:
        """录一段时间（最长 600 秒）的上报，返回逐条的字段变化（可用 path 前缀过滤，如 "print.ams"）。
        原始报文同时存到 tools/printer_mcp/captures/ 下的 jsonl 文件。录制期间可以让用户去插拔、换料。"""
        seconds = max(1.0, min(float(seconds), 600.0))
        c = conn(printer)
        before, msgs = c.record(seconds)
        CAPTURE_DIR.mkdir(exist_ok=True)
        f = CAPTURE_DIR / f"{c.name}-{datetime.now():%Y%m%d-%H%M%S}.jsonl"
        with f.open("w", encoding="utf-8") as out:
            out.write(json.dumps({"_before": before}, ensure_ascii=False) + "\n")
            for t, data in msgs:
                out.write(json.dumps({"_t": t, **data}, ensure_ascii=False) + "\n")
        changes = diff_messages(before, msgs, path)
        head = f"{len(msgs)} 条报文，{len(changes)} 处变化，原始数据：{f.relative_to(ROOT)}"
        if len(changes) > 400:
            changes = changes[:400] + [f"……还有 {len(changes) - 400} 处，见文件"]
        return "\n".join([head, *changes])

    @mcp.tool()
    def version(printer: str | None = None) -> str:
        """get_version 的结果：固件版本和模块列表（AMS 型号、序列号等）。"""
        c = conn(printer)
        end = time.time() + 5
        while c.version is None and time.time() < end:
            time.sleep(0.2)
        return json.dumps(c.version, ensure_ascii=False, indent=1) if c.version else "还没收到 get_version 回复"

    @mcp.tool()
    def ftp_list(path: str = "/", printer: str | None = None) -> str:
        """列 FTPS 目录（只读，写操作命令会被拦下）。"""
        c = conn(printer)
        return "\n".join(c.ftp_list(path)) or "（空）"

    return mcp


def main() -> None:
    logging.basicConfig(level=logging.INFO, stream=sys.stderr, format="%(asctime)s %(name)s %(message)s")
    ap = argparse.ArgumentParser(description="PlateRelay 打印机只读调试 MCP")
    sub = ap.add_subparsers(dest="cmd")
    sub.add_parser("menu", help="设置菜单：扫描局域网选择打印机，或手动输入")
    sub.add_parser("scan", help="只扫描局域网，列出听到的打印机")
    s = sub.add_parser("setup", help="手动保存一台打印机（交互输入）")
    s.add_argument("name")
    f = sub.add_parser("forget", help="从系统凭据库删除一台打印机")
    f.add_argument("name")
    sub.add_parser("list", help="列出已配置的打印机")
    args = ap.parse_args()
    if args.cmd == "menu":
        menu()
    elif args.cmd == "scan":
        found = discover()
        print(f"共 {len(found)} 台" if found else "没有发现")
    elif args.cmd == "setup":
        setup(args.name)
    elif args.cmd == "forget":
        forget(args.name)
    elif args.cmd == "list":
        print(", ".join(list_printers()) or "（无）")
    else:
        build_server().run()


if __name__ == "__main__":
    main()
