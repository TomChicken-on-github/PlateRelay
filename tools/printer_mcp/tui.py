"""PlateRelay · 打印机调试 TUI（上下键选择）

在自己的终端里运行：
  uv run --project daemon --with keyring --with questionary python tools/printer_mcp/server.py menu

扫描 / 手动添加 / 删除打印机，查看状态，以及发送白名单里的控制命令。
控制命令发送前一定弹确认框，默认“否”，必须本人选“是”。
"""

from __future__ import annotations

import json
import logging
import time

import questionary

import server as srv

BACK = "← 返回"


def _pick_printer() -> str | None:
    names = srv.list_printers()
    if not names:
        print("还没有保存打印机，先扫描或手动添加")
        return None
    if len(names) == 1:
        return names[0]
    return questionary.select("哪台打印机？", choices=[*names, BACK]).ask()


def _connect(name: str) -> srv.PrinterConnection | None:
    print(f"正在连接 {name}……")
    try:
        return srv.conn(name)
    except Exception as e:  # noqa: BLE001
        print(f"连接失败：{e}")
        return None


def _save(host: str, serial: str, default_name: str) -> None:
    name = questionary.text("给它起个名字", default=default_name).ask()
    if not name:
        return
    code = questionary.password("访问码（在打印机屏幕上看，输入不显示）").ask()
    if not code:
        print("访问码为空，没有保存")
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
    p = questionary.select("选哪台？", choices=[*choices, BACK]).ask()
    if isinstance(p, dict):
        _save(p["host"], p["serial"], srv._slug(p["name"], p["serial"][-6:].lower()))


def add_manually() -> None:
    host = questionary.text("打印机 IP").ask()
    serial = questionary.text("序列号").ask()
    if host and serial:
        _save(host.strip(), serial.strip(), "printer")
    else:
        print("IP 和序列号都不能为空")


def remove() -> None:
    names = srv.list_printers()
    if not names:
        print("没有已保存的打印机")
        return
    name = questionary.select("删除哪台？", choices=[*names, BACK]).ask()
    if name and name != BACK and questionary.confirm(f"确定从凭据管理器删除 {name}？", default=False).ask():
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


def control() -> None:
    name = _pick_printer()
    if not name or name == BACK:
        return
    choices = [questionary.Choice(f"{cmd} · {label}", value=cmd) for cmd, (label, _) in srv.CONTROL_COMMANDS.items()]
    command = questionary.select("发送哪条控制命令？", choices=[*choices, BACK]).ask()
    if not command or command == BACK:
        return
    c = _connect(name)
    if not c:
        return
    # 第二次确认：显示打印机、IP、当前状态和命令，默认“否”
    print(srv.control_prompt(c, command))
    if not questionary.confirm("确认发送？", default=False).ask():
        print("已取消，没有发送")
        return
    c._send_control(command)
    print(f"已发送 {command}，3 秒后看状态……")
    time.sleep(3)
    print(f"gcode_state：{c.snapshot().get('print', {}).get('gcode_state', '?')}")


ACTIONS = {
    "查看状态": show_status,
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
        choice = questionary.select("做什么？（↑↓ 选择，回车确定）", choices=[*ACTIONS, "退出"]).ask()
        if choice is None or choice == "退出":
            return
        try:
            ACTIONS[choice]()
        except KeyboardInterrupt:
            print("已中断")


if __name__ == "__main__":
    main()
