"""daemon 进程：把连接、存储和每台打印机的 worker 接在一起。"""

from __future__ import annotations

import asyncio
import logging
import platform
import uuid
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from platerelay_daemon import __version__
from platerelay_daemon.link import DaemonKeys, PanelLink
from platerelay_daemon.printers import PrinterWorker
from platerelay_daemon.protocol import PROTOCOL_VERSION, v1
from platerelay_daemon.registry import ADAPTERS
from platerelay_daemon.store import Store

LOGGER = logging.getLogger(__name__)

# 同时最多下载几个文件；往打印机上传是每台各自进行
DOWNLOAD_CONCURRENCY = 2
# 下载和上传各自最多试 3 次，中间隔这么久
RETRY_DELAYS = (5.0, 15.0, 45.0)
DEFAULT_TRANSFER_TIMEOUT = 180.0


class Daemon:
    def __init__(
        self,
        *,
        data_dir: Path,
        panel_url: str,
        daemon_id: str,
        allow_insecure_localhost: bool = False,
        retry_delays: tuple[float, ...] = RETRY_DELAYS,
    ) -> None:
        self.data_dir = data_dir
        self.work_dir = data_dir / "transfers"
        self.work_dir.mkdir(parents=True, exist_ok=True)
        # 上次没传完的临时文件用不上了
        for leftover in self.work_dir.iterdir():
            leftover.unlink(missing_ok=True)
        self.store = Store(data_dir / "daemon.sqlite")
        self.keys = DaemonKeys.load_or_create(data_dir / "daemon.key")
        self.boot_id = str(uuid.uuid4())
        self.daemon_id = daemon_id
        self.retry_delays = retry_delays
        self.transfer_timeout_seconds = DEFAULT_TRANSFER_TIMEOUT
        self.download_slots = asyncio.Semaphore(DOWNLOAD_CONCURRENCY)
        self.workers: dict[str, PrinterWorker] = {}
        self._commands: set[asyncio.Task] = set()
        self.link = PanelLink(
            panel_url=panel_url,
            daemon_id=daemon_id,
            keys=self.keys,
            store=self.store,
            hello=self._hello,
            allow_insecure_localhost=allow_insecure_localhost,
        )
        self.link.handler = self

    def _hello(self) -> dict[str, Any]:
        return {
            "daemonId": self.daemon_id,
            "protocolVersion": PROTOCOL_VERSION,
            "daemonVersion": __version__,
            "platform": platform.system().lower(),
            "bootId": self.boot_id,
            "adapters": [{"brand": adapter.brand, "version": adapter.version} for adapter in ADAPTERS.values()],
        }

    async def run(self) -> None:
        try:
            await self.link.run()
        finally:
            await self.close()

    async def close(self) -> None:
        self.link.stop()
        for task in list(self._commands):
            task.cancel()
        for worker in list(self.workers.values()):
            await worker.stop()
        self.workers.clear()
        self.store.close()

    # 开打流程在"发起打印"落盘之后、发指令之前会调一下，测试用它模拟进程在这一刻被杀
    def before_start_command(self, pipeline: Any) -> None:
        return None

    # 访问码：只在内存里解，不落盘、不进日志

    def key_matches(self, assignment: v1.AssignedPrinter) -> bool:
        if assignment.brand == "sim":
            return True  # 模拟打印机默认不校验访问码
        return assignment.keyFingerprint == self.keys.fingerprint()

    def access_code(self, assignment: v1.AssignedPrinter) -> str:
        try:
            return self.keys.decrypt(assignment.accessCodeCipher)
        except Exception:
            if assignment.brand == "sim":
                return ""
            raise

    # 面板来的消息

    async def on_welcome(self, welcome: v1.Welcome) -> None:
        self._apply_config(welcome.config)
        await self._apply_assignment(welcome.printers)
        # 每台打印机先报一份快照，面板拿它对账
        for worker in self.workers.values():
            worker.send_snapshot_now()

    async def on_disconnected(self) -> None:
        return None

    async def on_message(self, message_type: str, body: BaseModel) -> None:
        if isinstance(body, v1.PrintersAssign):
            await self._apply_assignment(body.printers)
        elif isinstance(body, v1.ConfigUpdate):
            self._apply_config(body.root)
        elif isinstance(body, v1.Command):
            self._on_command(body.root)

    def _apply_config(self, config: v1.DaemonConfig) -> None:
        self.transfer_timeout_seconds = float(config.transferTimeoutSeconds)

    async def _apply_assignment(self, printers: list[v1.AssignedPrinter]) -> None:
        """面板每次发的都是完整列表：不在列表里的打印机断开并忘掉。"""
        wanted = {str(printer.printerId.root): printer for printer in printers}
        for printer_id in self.workers.keys() - wanted.keys():
            await self.workers.pop(printer_id).stop()
            self.store.forget_printer(printer_id)
        for printer_id, assignment in wanted.items():
            worker = self.workers.get(printer_id)
            if worker is not None:
                old = worker.assignment
                same_target = (old.host, old.serial, old.brand, old.accessCodeCipher) == (
                    assignment.host, assignment.serial, assignment.brand, assignment.accessCodeCipher,
                )
                if same_target:
                    worker.assignment = assignment
                    continue
                await worker.stop()  # 地址或访问码变了：按新的重连，本地状态留着
            adapter = ADAPTERS.get(assignment.brand)
            if adapter is None:
                LOGGER.error("没有 %s 品牌的适配器，打印机 %s 不接管", assignment.brand, printer_id)
                self.workers.pop(printer_id, None)
                continue
            worker = self.workers[printer_id] = PrinterWorker(self, assignment, adapter)
            worker.start()

    def _on_command(self, command: Any) -> None:
        command_id = str(command.commandId.root)
        printer_id = str(command.printerId.root)
        worker = self.workers.get(printer_id)
        # 执行之前先把命令 ID 写进硬盘：同一条命令最多执行一次，重启也一样
        if not self.store.command_claim(command_id, command.expiresAt.root):
            return
        if worker is None:
            self.link.send("command.result", {"commandId": command_id, "status": "rejected", "code": "unknown_printer"})
            return
        if self.link.panel_now() > command.expiresAt.root:
            # 过期的命令永远不再执行：断线很久之后，积压的旧"开打"不会突然被执行
            worker.result(command_id, "expired")
            return
        task = asyncio.create_task(worker.handle_command(command), name=f"command-{command_id}")
        self._commands.add(task)
        task.add_done_callback(self._command_done)

    def _command_done(self, task: asyncio.Task) -> None:
        self._commands.discard(task)
        if not task.cancelled() and task.exception() is not None:
            LOGGER.error("执行命令出错", exc_info=task.exception())
