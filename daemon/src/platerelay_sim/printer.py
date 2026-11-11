"""模拟打印机的"固件"：一台机器自己的状态和行为。

这里的词汇是这台机器自己的（state、phase、alerts、ams……），和 daemon 的标准状态无关。
它不知道面板、订单、jobRef，只知道文件、任务名和面板按钮。
"""

from __future__ import annotations

import copy
import itertools
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

PREPARE_PHASES = ("bed_heat", "nozzle_heat", "home", "level", "purge")
RUNNING_STATES = ("preparing", "printing", "paused")


class Refused(Exception):
    """固件拒绝了一个请求，text 是它给人看的原话。"""

    def __init__(self, text: str, status: int = 409) -> None:
        super().__init__(text)
        self.text = text
        self.status = status


@dataclass
class SimConfig:
    serial: str = "SIM-0001"
    model_id: str = "N6"
    model_name: str = "X2D (simulated)"
    firmware: str = "01.00.00.00"
    access_code: str | None = None
    # 一次打印在"机器时间"里要多久；speed 是机器时间相对真实时间的倍数。
    prepare_seconds: float = 20.0
    print_seconds: float = 120.0
    layers: int = 100
    speed: float = 1.0
    storage_total: int = 8 * 1024**3


def default_ams() -> list[dict[str, Any]]:
    return [
        {
            "unit": 0,
            "slots": [
                {"slot": 0, "material": "PLA", "sub": "PLA Basic", "color": "FFFFFFFF", "tag": "A1B2C3D400000001", "remain": 80, "feeds": [1]},
                {"slot": 1, "material": "PLA", "sub": "PLA Basic", "color": "000000FF", "tag": "A1B2C3D400000002", "remain": 65, "feeds": [1]},
                {"slot": 2, "material": "PETG", "sub": "PETG HF", "color": "F72323FF", "remain": 40, "feeds": [1]},
                {"slot": 3, "empty": True, "feeds": [1]},
            ],
        },
        {
            "unit": 1,
            "slots": [
                {"slot": 0, "material": "PLA", "sub": "PLA Matte", "color": "0A6CF5FF", "tag": "A1B2C3D400000005", "remain": 90, "feeds": [2]},
                {"slot": 1, "material": "PLA", "sub": "PLA Basic", "color": "FFFFFFFF", "tag": "A1B2C3D400000006", "remain": 100, "feeds": [2]},
                {"slot": 2, "empty": True, "feeds": [2]},
                {"slot": 3, "empty": True, "feeds": [2]},
            ],
        },
    ]


@dataclass
class _Run:
    task: str
    file: str | None
    plate: int
    slots: list[dict[str, Any]]
    started_at: float
    prepare_done: float = 0.0
    print_done: float = 0.0
    fail_in_prepare: bool = False
    skipped: list[int] = field(default_factory=list)
    resume_state: str = "printing"


class SimPrinter:
    """机器本体。tick() 推进机器时间；其余方法是机器对外的操作和现场的人对它做的事。"""

    def __init__(self, config: SimConfig | None = None, clock: Callable[[], float] = time.time) -> None:
        self.config = config or SimConfig()
        self._clock = clock
        self._alert_ids = itertools.count(1)
        self.files: dict[str, dict[str, Any]] = {}
        self.history: list[dict[str, Any]] = []
        self.ams = default_ams()
        self.light = True
        self._listeners: list[Callable[[], None]] = []
        # 现场的人预先埋好的故障，下一次对应操作时触发一次
        self.fail_next_prepare = False
        self.reject_next_print: str | None = None
        self.cut_next_upload = False
        self._boot()

    # 开机

    def _boot(self) -> None:
        self.booted_at = self._clock()
        self.state = "idle"
        self.phase: str | None = None
        self.pause_cause: str | None = None
        self.alerts: list[dict[str, Any]] = []
        self._run: _Run | None = None
        self._last_print: dict[str, Any] | None = None
        self._temps = {"nozzle": [{"cur": 25.0, "set": 0.0}, {"cur": 25.0, "set": 0.0}], "bed": {"cur": 25.0, "set": 0.0}, "chamber": {"cur": 26.0}}

    def on_change(self, listener: Callable[[], None]) -> None:
        self._listeners.append(listener)

    def _changed(self) -> None:
        for listener in list(self._listeners):
            listener()

    # 对外看到的状态

    def info(self) -> dict[str, Any]:
        return {
            "serial": self.config.serial,
            "model_id": self.config.model_id,
            "model_name": self.config.model_name,
            "firmware": self.config.firmware,
            "nozzles": [{"index": 0, "diameter": 0.4, "flow": "standard"}, {"index": 1, "diameter": 0.4, "flow": "standard"}],
            "features": {"skip_objects": True, "light": True, "camera": False},
        }

    def status(self) -> dict[str, Any]:
        used = sum(item["size"] for item in self.files.values())
        return {
            "state": self.state,
            "phase": self.phase,
            "pause_cause": self.pause_cause,
            "print": self._print_view(),
            "temps": copy.deepcopy(self._temps),
            "ams": copy.deepcopy(self.ams),
            "alerts": copy.deepcopy(self.alerts),
            "lights": {"chamber": self.light},
            "storage": {"internal": {"total": self.config.storage_total, "free": max(0, self.config.storage_total - used)}},
            "boot_time": int(self.booted_at),
        }

    def _print_view(self) -> dict[str, Any] | None:
        run = self._run
        if run is None:
            return copy.deepcopy(self._last_print)
        total = self.config.print_seconds
        progress = int(min(100, run.print_done / total * 100)) if total else 100
        remaining = (self.config.prepare_seconds - run.prepare_done) + (total - run.print_done)
        return {
            "task": run.task,
            "file": run.file,
            "plate": run.plate,
            "progress": progress,
            "remain_min": int(max(0, remaining) // 60) + (1 if remaining > 0 else 0),
            "layer": int(self.config.layers * progress / 100),
            "layers": self.config.layers,
            "skipped": list(run.skipped),
        }

    # 机器时间往前走

    def tick(self, real_seconds: float) -> None:
        run = self._run
        if run is None or self.state not in ("preparing", "printing"):
            return
        dt = real_seconds * self.config.speed
        before = (self.state, self.phase, self._print_view())
        if self.state == "preparing":
            run.prepare_done += dt
            share = run.prepare_done / self.config.prepare_seconds if self.config.prepare_seconds else 1
            if run.fail_in_prepare and share >= 0.5:
                self._raise_alert("0C00-0300", "fatal", "Build plate not detected. The task was aborted.", [])
                self._end("failed")
                return
            if share >= 1:
                self.state, self.phase = "printing", None
            else:
                self.phase = PREPARE_PHASES[min(len(PREPARE_PHASES) - 1, int(share * len(PREPARE_PHASES)))]
            self._temps["bed"] = {"cur": min(55.0, 25 + share * 30), "set": 55.0}
            for nozzle in self._temps["nozzle"]:
                nozzle.update(cur=min(220.0, 25 + share * 195), set=220.0)
        else:
            run.print_done += dt
            if run.print_done >= self.config.print_seconds:
                self._end("done")
                return
        if before != (self.state, self.phase, self._print_view()):
            self._changed()

    def _end(self, result: str) -> None:
        run = self._run
        assert run is not None
        view = self._print_view() or {}
        if result == "done":
            view.update(progress=100, remain_min=0, layer=self.config.layers)
        self._last_print = view
        self.history.append({"task": run.task, "file": run.file, "started_at": run.started_at, "ended_at": self._clock(), "result": result})
        self._run = None
        self.state, self.phase, self.pause_cause = result, None, None
        self._temps["bed"]["set"] = 0.0
        for nozzle in self._temps["nozzle"]:
            nozzle["set"] = 0.0
        # 卡住任务的报错随任务结束消失；致命报错留着给人看
        self.alerts = [alert for alert in self.alerts if alert["level"] != "pause"]
        self._changed()

    def _raise_alert(self, code: str, level: str, text: str, choices: list[str]) -> dict[str, Any]:
        alert = {"id": next(self._alert_ids), "code": code, "level": level, "text": text, "choices": choices, "at": int(self._clock())}
        self.alerts.append(alert)
        return alert

    # 局域网接口背后的操作

    def store_file(self, name: str, size: int) -> None:
        self.files[name] = {"name": name, "size": size, "mtime": int(self._clock())}
        self._changed()

    def delete_file(self, name: str) -> None:
        if name not in self.files:
            raise Refused("File not found.", 404)
        if self._run is not None and self._run.file == name:
            raise Refused("File is in use by the current task.")
        del self.files[name]
        self._changed()

    def start_print(self, *, file: str | None, task: str, plate: int = 1, slots: list[dict[str, Any]] | None = None) -> None:
        if self.reject_next_print is not None:
            text, self.reject_next_print = self.reject_next_print, None
            raise Refused(text)
        if self.state in RUNNING_STATES or self.state in ("busy", "fault"):
            raise Refused("The printer is busy.")
        if file is not None and file not in self.files:
            raise Refused("File not found.", 404)
        self._run = _Run(task=task, file=file, plate=plate, slots=slots or [], started_at=self._clock(), fail_in_prepare=self.fail_next_prepare)
        self.fail_next_prepare = False
        self.alerts = []
        self.state, self.phase, self.pause_cause = "preparing", PREPARE_PHASES[0], None
        self._changed()

    def pause(self) -> None:
        if self.state not in ("preparing", "printing"):
            raise Refused("Nothing to pause.")
        assert self._run is not None
        self._run.resume_state = self.state
        self.state, self.pause_cause = "paused", "user"
        self._changed()

    def resume(self) -> None:
        if self.state != "paused" or self._run is None:
            raise Refused("Nothing to resume.")
        if self.pause_cause == "filament_out" and not self._feeding_slot_loaded():
            raise Refused("Filament has not been loaded.")
        self.alerts = [alert for alert in self.alerts if alert["level"] != "pause"]
        self.state, self.pause_cause = self._run.resume_state, None
        self._changed()

    def stop(self) -> None:
        if self._run is None:
            raise Refused("Nothing to stop.")
        self._end("stopped")

    def skip_objects(self, object_ids: list[int]) -> None:
        if self._run is None or self.state not in ("printing", "paused"):
            raise Refused("Objects can only be skipped while printing.")
        for object_id in object_ids:
            if object_id not in self._run.skipped:
                self._run.skipped.append(object_id)
        self._changed()

    def set_light(self, on: bool) -> None:
        self.light = on
        self._changed()

    def answer_alert(self, alert_id: int, choice: str) -> None:
        alert = next((item for item in self.alerts if item["id"] == alert_id), None)
        if alert is None:
            raise Refused("Alert not found.", 404)
        if choice not in alert["choices"]:
            raise Refused("Choice not available for this alert.", 400)
        if choice == "stop":
            self.stop()
        elif choice == "resume":
            self.resume()
        else:
            self.alerts.remove(alert)
            self._changed()

    # 现场的人和物理世界对机器做的事（不属于机器的局域网接口）

    def _feeding_slot_loaded(self) -> bool:
        run = self._run
        if run is None or not run.slots:
            return True
        return all(not self._slot(item.get("unit", 0), item.get("slot", 0)).get("empty") for item in run.slots)

    def _slot(self, unit: int, slot: int) -> dict[str, Any]:
        for ams in self.ams:
            if ams["unit"] == unit:
                for item in ams["slots"]:
                    if item["slot"] == slot:
                        return item
        raise Refused("No such slot.", 404)

    def operator_filament_runs_out(self, unit: int = 0, slot: int = 0) -> None:
        item = self._slot(unit, slot)
        feeds = item.get("feeds", [])
        item.clear()
        item.update(slot=slot, empty=True, feeds=feeds)
        if self.state in ("preparing", "printing"):
            assert self._run is not None
            self._run.resume_state = self.state
            self.state, self.pause_cause = "paused", "filament_out"
            self._raise_alert("0700-2000", "pause", f"AMS {unit + 1} slot {slot + 1} filament has run out. Please insert a new filament.", ["resume", "stop"])
        self._changed()

    def operator_loads_filament(self, unit: int, slot: int, material: str = "PLA", sub: str = "PLA Basic", color: str = "FFFFFFFF", tag: str | None = None) -> None:
        item = self._slot(unit, slot)
        feeds = item.get("feeds", [])
        item.clear()
        item.update(slot=slot, material=material, sub=sub, color=color, remain=100, feeds=feeds)
        if tag:
            item["tag"] = tag
        self._changed()

    def operator_raises_alert(self, level: str = "pause", code: str = "0300-4000", text: str = "Nozzle temperature malfunction.") -> None:
        if level == "pause":
            if self.state not in ("preparing", "printing"):
                raise Refused("A pausing alert needs a running task.")
            assert self._run is not None
            self._run.resume_state = self.state
            self.state, self.pause_cause = "paused", "alert"
            self._raise_alert(code, "pause", text, ["resume", "stop"])
        elif level == "fatal":
            if self._run is not None:
                self._raise_alert(code, "fatal", text, [])
                self._end("failed")
                return
            self._raise_alert(code, "fatal", text, [])
            self.state = "fault"
        else:
            self._raise_alert(code, level, text, ["dismiss"])
        self._changed()

    def operator_starts_local_print(self, name: str = "benchy.gcode.3mf") -> None:
        """有人在打印机屏幕上或用别的切片软件直接开打。"""
        self.start_print(file=None, task=name)

    def operator_power_cycle(self) -> None:
        """断电再上电：正在跑的任务没了，机器回到空闲，报错清空。"""
        if self._run is not None:
            run = self._run
            self.history.append({"task": run.task, "file": run.file, "started_at": run.started_at, "ended_at": self._clock(), "result": "power_loss"})
        self._boot()
        self._changed()
