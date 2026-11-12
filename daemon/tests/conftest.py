from __future__ import annotations

import asyncio
import contextlib
from pathlib import Path

import pytest_asyncio
from fake_panel import ENROLL_TOKEN, FakePanel

from platerelay_daemon.app import Daemon
from platerelay_daemon.link import DaemonKeys, enroll
from platerelay_sim import SimConfig, SimPrinter, SimPrinterServer


@pytest_asyncio.fixture
async def panel():
    panel = FakePanel()
    await panel.start()
    yield panel
    await panel.stop()


@pytest_asyncio.fixture
async def sim():
    """一台跑得很快的模拟打印机：准备 1.5 秒，打印 1.5 秒。"""
    server = SimPrinterServer(SimPrinter(SimConfig(prepare_seconds=1.5, print_seconds=1.5)))
    await server.start()
    yield server
    await server.stop()


class DaemonHarness:
    """起停 daemon；重启时沿用同一个数据目录，就像进程被拉起来一样。"""

    def __init__(self, panel: FakePanel, data_dir: Path) -> None:
        self.panel = panel
        self.data_dir = data_dir
        self.daemon: Daemon | None = None
        self.daemon_id: str | None = None
        self._task: asyncio.Task | None = None

    async def start(self) -> Daemon:
        if self.daemon_id is None:
            keys = DaemonKeys.load_or_create(self.data_dir / "daemon.key")
            self.daemon_id = await enroll(self.panel.url, ENROLL_TOKEN, keys, name="test", platform="linux", daemon_version="0")
        self.daemon = Daemon(
            data_dir=self.data_dir, panel_url=self.panel.url, daemon_id=self.daemon_id,
            allow_insecure_localhost=True, retry_delays=(0.05, 0.05, 0.05),
        )
        self._task = asyncio.create_task(self.daemon.run())
        await asyncio.wait_for(self.daemon.link.connected.wait(), 10)
        return self.daemon

    async def kill(self) -> None:
        """像进程被杀掉一样停下：不做任何收尾。"""
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._task
            self._task = None


@pytest_asyncio.fixture
async def harness(panel, tmp_path):
    harness = DaemonHarness(panel, tmp_path / "daemon")
    yield harness
    await harness.kill()
