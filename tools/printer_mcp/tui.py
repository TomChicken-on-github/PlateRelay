"""PlateRelay · 打印机调试 TUI（上下键选择）

在自己的终端里运行：
  uv run --project daemon --with keyring --with questionary python tools/printer_mcp/server.py menu

扫描 / 手动添加 / 删除打印机，查看状态，以及发送白名单里的控制命令。
控制命令发送前一定弹确认框，默认“否”，必须本人选“是”。
任何一步按两下 Esc 返回（第一下提示，2 秒内再按一下确认）；连接、扫描等待中按 Ctrl+C 中断。
"""

from __future__ import annotations

import json
import logging
import time

import questionary
from prompt_toolkit.application import run_in_terminal
from prompt_toolkit.key_binding import KeyBindings, merge_key_bindings

import server as srv

BACK = "← 返回"
ESC_WINDOW = 2.0


def _ask(question: questionary.Question):
    """给 questionary 的问题加上「按两下 Esc 取消」，取消时返回 None，和 Ctrl+C 一样。"""
    armed = [0.0]
    kb = KeyBindings()

    @kb.add("escape", eager=True)
    def _(event) -> None:
        if time.time() - armed[0] < ESC_WINDOW:
            event.app.exit(result=None)
        else:
            armed[0] = time.time()
            run_in_terminal(lambda: print("  再按一次 Esc 返回"))

    app = question.application
    app.key_bindings = merge_key_bindings([b for b in (app.key_bindings, kb) if b])
    return question.ask()


def _pick_printer() -> str | None:
    names = srv.list_printers()
    if not names:
        print("还没有保存打印机，先扫描或手动添加")
        return None
    if len(names) == 1:
        return names[0]
    return _ask(questionary.select("哪台打印机？", choices=[*names, BACK]))


def _connect(name: str) -> srv.PrinterConnection | None:
    print(f"正在连接 {name}……")
    try:
        return srv.conn(name)
    except Exception as e:  # noqa: BLE001
        print(f"连接失败：{e}")
        return None


def _save(host: str, serial: str, default_name: str) -> None:
    existing = srv.find_by_serial(serial)
    if existing:
        # 同一台机器（序列号相同）：更新原条目，不另存一份
        _, old = srv.load_printer(existing)
        print(f"这台已经保存为 {existing}（{old['host']}），更新它的 IP 和访问码")
        code = _ask(questionary.password("新访问码（输入不显示，直接回车保留原来的）"))
        if code is None:
            print("已取消，没有保存")
            return
        srv.save_printer(existing, host, serial, code.strip() or old["access_code"])
        return
    name = _ask(questionary.text("给它起个名字", default=default_name))
    if not name:
        print("已取消，没有保存")
        return
    code = _ask(questionary.password("访问码（在打印机屏幕上看，输入不显示）"))
    if not code:
        print("访问码为空或已取消，没有保存")
        return
    srv.save_printer(name.strip(), host, serial, code.strip())


def add_by_scan() -> None:
    print("正在监听局域网广播（约 10 秒，只听不发）……")
    found = srv.discover()
    if not found:
        print("没有发现。可以再扫一次，或者手动添加")
        return
    choices = [
        questionary.Choice(f"{p['name'] or '?'}  型号 {p['model']}  {p['host']}  序列号 {p['serial']}", value=p)
        for p in found
    ]
    p = _ask(questionary.select("选哪台？", choices=[*choices, BACK]))
    if isinstance(p, dict):
        _save(p["host"], p["serial"], srv._slug(p["name"], p["serial"][-6:].lower()))


def add_manually() -> None:
    host = _ask(questionary.text("打印机 IP"))
    if host is None:
        return
    serial = _ask(questionary.text("序列号"))
    if serial is None:
        return
    if host and serial:
        _save(host.strip(), serial.strip(), "printer")
    else:
        print("IP 和序列号都不能为空")


def remove() -> None:
    names = srv.list_printers()
    if not names:
        print("没有已保存的打印机")
        return
    name = _ask(questionary.select("删除哪台？", choices=[*names, BACK]))
    if name and name != BACK and _ask(questionary.confirm(f"确定从凭据管理器删除 {name}？", default=False)):
        srv.forget(name)


def show_status() -> None:
    name = _pick_printer()
    if not name or name == BACK:
        return
    c = _connect(name)
    if not c:
        return
    print(json.dumps(srv.status_summary(c), ensure_ascii=False, indent=1))
    ams = c.snapshot().get("print", {}).get("ams", {}).get("ams", [])
    for unit in ams:
        for t in unit.get("tray", []):
            print(f"  AMS {unit.get('id')} 槽 {t.get('id')}：{t.get('tray_type') or '空'} "
                  f"{t.get('tray_sub_brands', '')} #{t.get('tray_color', '')[:6]} 余量 {t.get('remain', '?')}")


NOISY = ("temp", "temper", "fan", "speed", "wifi_signal", "remain_time", "mc_remaining_time", "humidity", "_kb", "hnow", "snow", "spre", "star", "hpre", "htar")


def watch_changes() -> None:
    """实时打印每条报文带来的字段变化，Ctrl+C 停止。只收不发（连上时的那一次 pushall 除外）。"""
    name = _pick_printer()
    if not name or name == BACK:
        return
    path = _ask(questionary.text("只看哪个前缀？（如 print.ams，直接回车看全部）"))
    if path is None:
        return
    quiet = _ask(questionary.confirm("隐藏温度、风扇、剩余时间等每秒都在变的字段？", default=True))
    if quiet is None:
        return
    c = _connect(name)
    if not c:
        return
    state = c.snapshot()
    prev = srv.flatten(state)
    buf: list[tuple[float, dict]] = []
    with c._lock:
        c._listeners.append(buf)
    print("开始监听，Ctrl+C 停止……")
    try:
        while True:
            time.sleep(0.5)
            with c._lock:
                msgs, buf[:] = list(buf), []
            for t, data in msgs:
                ts = time.strftime("%H:%M:%S", time.localtime(t))
                for k, v in data.items():
                    if not isinstance(v, dict):
                        continue
                    cmd = v.get("command")
                    if cmd and cmd != "push_status":
                        # 命令回执（暂停、继续、灯光等）整条显示，不并进状态
                        print(f"{ts}  [{k}.{cmd}] {json.dumps(v, ensure_ascii=False)[:200]}")
                        continue
                    srv.deep_merge(state, {k: v})
                cur = srv.flatten(state)
                for key in sorted(set(prev) | set(cur)):
                    if path and not key.startswith(path.strip()):
                        continue
                    if quiet and any(n in key for n in NOISY):
                        continue
                    a, b = prev.get(key, "<无>"), cur.get(key, "<无>")
                    if a != b:
                        print(f"{ts}  {key}: {json.dumps(a, ensure_ascii=False)} → {json.dumps(b, ensure_ascii=False)}")
                prev = cur
    except KeyboardInterrupt:
        print("已停止")
    finally:
        with c._lock:
            c._listeners.remove(buf)


def control() -> None:
    name = _pick_printer()
    if not name or name == BACK:
        return
    choices = [questionary.Choice(f"{cmd} · {label}", value=cmd) for cmd, (label, _) in srv.CONTROL_COMMANDS.items()]
    command = _ask(questionary.select("发送哪条控制命令？", choices=[*choices, BACK]))
    if not command or command == BACK:
        return
    c = _connect(name)
    if not c:
        return
    # 第二次确认：显示打印机、IP、当前状态和命令，默认“否”
    print(srv.control_prompt(c, command))
    if not _ask(questionary.confirm("确认发送？", default=False)):
        print("已取消，没有发送")
        return
    c._send_control(command)
    print(f"已发送 {command}，3 秒后看状态……")
    time.sleep(3)
    print(f"gcode_state：{c.snapshot().get('print', {}).get('gcode_state', '?')}")


ACTIONS = {
    "查看状态": show_status,
    "实时查看变化（Ctrl+C 停止）": watch_changes,
    "控制打印机（需要确认）": control,
    "扫描局域网添加": add_by_scan,
    "手动添加": add_manually,
    "删除已保存的打印机": remove,
}


def main() -> None:
    logging.getLogger().setLevel(logging.WARNING)
    while True:
        names = srv.list_printers()
        print(f"\n== PlateRelay 打印机调试 ==  已保存：{', '.join(names) or '无'}")
        choice = _ask(questionary.select("做什么？（↑↓ 选择，回车确定，Esc 两下退出）", choices=[*ACTIONS, "退出"]))
        if choice is None or choice == "退出":
            return
        try:
            ACTIONS[choice]()
        except KeyboardInterrupt:
            print("已中断")


if __name__ == "__main__":
    main()
