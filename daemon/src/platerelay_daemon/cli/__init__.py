"""命令行入口：run（启动，第一次会先注册）和 status（看本机状态）。"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import platform
import socket
import sqlite3
from pathlib import Path

from platerelay_daemon import __version__
from platerelay_daemon.app import Daemon
from platerelay_daemon.link import DaemonKeys, check_panel_url, enroll
from platerelay_daemon.store import Store

ENROLL_TOKEN_ENV = "PLATERELAY_ENROLL_TOKEN"
DEV_INSECURE_ENV = "PLATERELAY_DEV_INSECURE"
DATA_DIR_ENV = "PLATERELAY_DATA_DIR"
PANEL_URL_ENV = "PLATERELAY_PANEL_URL"


def _default_data_dir() -> Path:
    return Path(os.environ.get(DATA_DIR_ENV) or Path.home() / ".platerelay-daemon")


async def _run(options: argparse.Namespace) -> None:
    data_dir: Path = options.data_dir
    insecure = os.environ.get(DEV_INSECURE_ENV) == "1"
    store = Store(data_dir / "daemon.sqlite")
    panel_url = options.panel or os.environ.get(PANEL_URL_ENV) or store.get_setting("panel_url")
    daemon_id = store.get_setting("daemon_id")
    if not panel_url:
        raise SystemExit(f"第一次启动要给面板地址：--panel 或环境变量 {PANEL_URL_ENV}")
    check_panel_url(panel_url, insecure)
    if daemon_id is None or panel_url != store.get_setting("panel_url"):
        # 一次性注册令牌只从环境变量或参数拿，用完即弃，不写进配置和日志
        token = options.token or os.environ.get(ENROLL_TOKEN_ENV)
        if not token:
            raise SystemExit(f"这个 daemon 还没注册：用面板生成的安装命令启动，或设环境变量 {ENROLL_TOKEN_ENV}")
        keys = DaemonKeys.load_or_create(data_dir / "daemon.key")
        daemon_id = await enroll(
            panel_url, token, keys,
            name=options.name or socket.gethostname(),
            platform=platform.system().lower(),
            daemon_version=__version__,
        )
        store.set_setting("panel_url", panel_url)
        store.set_setting("daemon_id", daemon_id)
        fingerprint = keys.fingerprint()
        grouped = " ".join(fingerprint[index:index + 4] for index in range(0, len(fingerprint), 4))
        print(f"已注册。公钥指纹（请和面板上显示的核对）：\n  {grouped}", flush=True)
    store.close()
    daemon = Daemon(data_dir=data_dir, panel_url=panel_url, daemon_id=daemon_id, allow_insecure_localhost=insecure)
    await daemon.run()


def _status(options: argparse.Namespace) -> None:
    path = options.data_dir / "daemon.sqlite"
    if not path.exists():
        raise SystemExit("还没有本机数据")
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    settings = dict(db.execute("SELECT key, value FROM settings WHERE key IN ('panel_url', 'daemon_id')").fetchall())
    print(f"面板：{settings.get('panel_url', '—')}\ndaemon：{settings.get('daemon_id', '—')}")
    print(f"发件箱里等面板确认的消息：{db.execute('SELECT COUNT(*) FROM outbox').fetchone()[0]} 条")
    print(f"没走完的开打流程：{db.execute('SELECT COUNT(*) FROM starts').fetchone()[0]} 条")
    for printer_id, value in db.execute("SELECT printer_id, value FROM run_seq"):
        print(f"打印机 {printer_id}：运行序号 {value}")


def main() -> None:
    parser = argparse.ArgumentParser(prog="platerelay-daemon")
    parser.add_argument("--data-dir", type=Path, default=_default_data_dir())
    commands = parser.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run", help="启动 daemon；还没注册时先注册")
    run.add_argument("--panel", help="面板地址，如 https://panel.example")
    run.add_argument("--token", help=f"一次性注册令牌；不想让它出现在命令行里就用环境变量 {ENROLL_TOKEN_ENV}")
    run.add_argument("--name", help="在面板上显示的名字，默认用主机名")
    commands.add_parser("status", help="只读查看本机状态")
    options = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    if options.command == "status":
        _status(options)
        return
    try:
        asyncio.run(_run(options))
    except KeyboardInterrupt:
        pass
