"""用 pybambu 自带的 MOCK-X2D 录制数据跑一遍 driver，不连真机。"""

import asyncio

from platerelay_daemon.driver_api import (
    ConnectionEvent,
    ControlNotAllowedError,
    NormalizedState,
    ProgressEvent,
    StatusEvent,
)
from platerelay_daemon.drivers.bambu import BambuDriver


async def wait_for(predicate, timeout=5.0):
    deadline = asyncio.get_running_loop().time() + timeout
    while not predicate():
        if asyncio.get_running_loop().time() > deadline:
            raise TimeoutError
        await asyncio.sleep(0.05)


def test_mock_x2d_reports_normalized_status(tmp_path):
    async def run():
        driver = BambuDriver(
            printer_id="p1",
            host="127.0.0.1",
            serial="MOCK-X2D",
            access_code="",
            model="X2D",
            cache_dir=tmp_path,
        )
        events = []
        driver.subscribe(events.append)
        await driver.connect()
        await wait_for(lambda: any(isinstance(e.event, ProgressEvent) for e in events))

        snap = driver.snapshot()
        await driver.disconnect()
        return snap, events, driver

    snap, events, driver = asyncio.run(run())

    assert snap.connected
    assert snap.info.brand == "bambu"
    assert snap.info.model == "X2D"
    assert {n["index"] for n in snap.info.nozzles} == {0, 1}
    assert snap.status.state is NormalizedState.PRINTING
    assert snap.status.raw["gcode_state"] == "RUNNING"
    assert snap.progress.percent == 98
    assert snap.progress.remaining_sec == 2 * 60
    assert set(snap.progress.temps) >= {"bed", "nozzle0", "nozzle1"}

    seqs = [e.seq for e in events]
    assert seqs == sorted(seqs) and len(set(seqs)) == len(seqs)
    assert events[0].event == ConnectionEvent(state="connected")
    assert events[-1].event == StatusEvent(status=driver.snapshot().status)
    assert driver.snapshot().status.state is NormalizedState.OFFLINE


def test_control_commands_are_not_available(tmp_path):
    driver = BambuDriver(
        printer_id="p1", host="127.0.0.1", serial="MOCK-X2D", access_code="",
        model="X2D", cache_dir=tmp_path,
    )

    async def run():
        for call in (driver.pause("c1"), driver.resume("c2"), driver.cancel("c3"), driver.start()):
            try:
                await call
            except ControlNotAllowedError:
                continue
            raise AssertionError("控制命令不应可用")

    asyncio.run(run())
