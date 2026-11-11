"""每台打印机一个 worker。业务判断都在这里，所有品牌共用：

- 把适配器给的状态转成发给面板的快照，同一台最多每秒一份；
- 比较前后两份状态，判断任务的开始、暂停、恢复、结束，以及它是系统派的还是外部的；
- 维护运行序号：每看到打印机开始一次运行加一；有一段时间看不到它、又证明不了它没跑过的也加一；
- 执行面板的命令：先查过期和台账，再交给适配器。
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from platerelay_daemon.adapter_api import (
    ENDED_STATES,
    OFFLINE_SNAPSHOT,
    RUNNING_STATES,
    Adapter,
    AdapterError,
    DeviceError,
    DeviceSnapshot,
    NormalizedState,
    PrinterSession,
    PrinterTarget,
)
from platerelay_daemon.protocol import v1

if TYPE_CHECKING:
    from platerelay_daemon.app import Daemon
    from platerelay_daemon.jobs.start import StartPipeline

LOGGER = logging.getLogger(__name__)

SNAPSHOT_MIN_INTERVAL = 1.0
LAST_SEEN_WRITE_INTERVAL = 10.0
FILE_SUFFIX = ".gcode.3mf"
SYSTEM_NAME = re.compile(r"^pr-([0-9a-f]{12})(?:\.gcode\.3mf)?$")
PAUSED_STATES = (NormalizedState.PAUSED, NormalizedState.ERROR_PAUSED)


def task_name(job_ref: str) -> str:
    """系统任务在打印机上的名字。用 jobRef 的后 12 位：那是随机部分，前面的时间戳一分钟内会撞。"""
    return f"pr-{job_ref.replace('-', '')[-12:]}"


def file_name(job_ref: str) -> str:
    return task_name(job_ref) + FILE_SUFFIX


@dataclass
class Run:
    """打印机上正在跑的一次运行。"""

    name: str | None
    job_ref: str | None  # None = 外部任务
    started_reported: bool = False
    paused: bool = False
    skipped: tuple[int, ...] = ()

    @property
    def external(self) -> bool:
        return self.job_ref is None


@dataclass
class _Sight:
    """看不看得到这台打印机。epoch 每断一次加一，别处用它判断"这段时间一直看得到"。"""

    connected: bool = False
    epoch: int = 0
    lost_at: datetime | None = None
    last_seen_written: float = 0.0


@dataclass
class _StopRequests:
    by_job: dict[str, str] = field(default_factory=dict)  # jobRef -> 面板停止命令的 ID


class PrinterWorker:
    def __init__(self, daemon: Daemon, assignment: v1.AssignedPrinter, adapter: type[Adapter]) -> None:
        self.daemon = daemon
        self.assignment = assignment
        self.printer_id = str(assignment.printerId.root)
        self._adapter = adapter
        self.session: PrinterSession | None = None
        self.snap: DeviceSnapshot = OFFLINE_SNAPSHOT
        self.run: Run | None = None
        self._ended_run: Run | None = None  # 刚结束的那次运行，打印机还停在它的结局上
        self.sight = _Sight()
        self.pipelines: dict[str, StartPipeline] = {}
        self._stops = _StopRequests()
        self._resolved_errors: set[str] = set()
        self._errors: dict[str, DeviceError] = {}
        self._seq = 0
        self._first_contact = True
        self._first_state = True
        self._task: asyncio.Task | None = None
        self._snapshot_task: asyncio.Task | None = None
        self._snapshot_dirty = False
        self._last_snapshot_at = 0.0
        self._cleanup_task: asyncio.Task | None = None

        store = daemon.store
        stored = store.run_seq(self.printer_id)
        if stored is None:
            # 没有本地记录（新打印机，或 daemon 丢了状态）：从比面板见过的更大的数开始
            known = assignment.knownRunSeq
            stored = known + 1 if known is not None else 0
            store.run_seq_set(self.printer_id, stored)
        self.run_seq = stored

    # 生命周期

    def start(self) -> None:
        self._recover_unfinished_starts()
        self._task = asyncio.create_task(self._supervise(), name=f"printer-{self.printer_id}")

    async def stop(self) -> None:
        for pipeline in list(self.pipelines.values()):
            pipeline.abort()
        for task in (self._task, self._snapshot_task, self._cleanup_task):
            if task is not None:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await task
        if self.session is not None:
            with contextlib.suppress(Exception):
                await self.session.close()

    def _target(self) -> PrinterTarget:
        return PrinterTarget(
            host=self.assignment.host,
            serial=self.assignment.serial,
            access_code=lambda: self.daemon.access_code(self.assignment),
        )

    async def _supervise(self) -> None:
        """这台打印机出了没料到的错只重启它自己，不影响别的打印机。"""
        delay = 1.0
        while True:
            try:
                await self._serve()
            except asyncio.CancelledError:
                raise
            except Exception:
                LOGGER.exception("打印机 %s 的 worker 出错，%s 秒后重启", self.printer_id, delay)
            if self.session is not None:
                with contextlib.suppress(Exception):
                    await self.session.close()
                self.session = None
            if self.sight.connected:
                self._on_disconnected("worker_restarted")
            await asyncio.sleep(delay)
            delay = min(delay * 2, 60)

    async def _serve(self) -> None:
        if not self.daemon.key_matches(self.assignment):
            # 访问码是用别的公钥加密的（daemon 换过密钥），解不开，要人重填
            self._emit("connection.down", data={"reason": "access_code_key_mismatch"})
            await asyncio.Event().wait()
        self.session = self._adapter.open(self._target())
        await self.session.connect()
        async for event in self.session.events():
            if event.kind == "disconnected":
                if self.sight.connected or self._first_contact:
                    self._on_disconnected(event.reason or "unreachable")
            else:
                await self._on_state(self.session.snapshot())

    # 状态变化

    def _on_disconnected(self, reason: str) -> None:
        was_connected = self.sight.connected
        self.sight.connected = False
        if was_connected:
            self.sight.epoch += 1
            self.sight.lost_at = datetime.now(UTC)
        self.snap = OFFLINE_SNAPSHOT
        if was_connected or self._first_contact:
            self._emit("connection.down", data={"reason": reason})
        self.request_snapshot()

    async def _on_state(self, cur: DeviceSnapshot) -> None:
        if not cur.connected:
            return
        if not self.sight.connected:
            await self._on_connected()
        self._track_run(cur)
        self._first_state = False
        self._track_errors(cur)
        self.snap = cur
        self._remember_seen()
        self.request_snapshot()

    async def _on_connected(self) -> None:
        store = self.daemon.store
        since = self.sight.lost_at
        if since is None and self._first_contact:
            # daemon 刚启动：上次看到这台打印机是什么时候，按落盘的时间算
            written = store.get_setting(f"last_seen:{self.printer_id}")
            since = datetime.fromisoformat(written) if written else None
        if since is not None:
            assert self.session is not None
            ran = await self.session.ran_during_gap(since)
            if ran is not False:
                # 证明不了这段时间它没跑过东西，就按跑过算：派单时看到的板子可能已经不是现在的板子
                self._bump_run_seq()
        self._first_contact = False
        self.sight.connected = True
        self.sight.lost_at = None
        self._emit("connection.up")
        self._schedule_cleanup()

    def _remember_seen(self) -> None:
        now = asyncio.get_running_loop().time()
        if now - self.sight.last_seen_written >= LAST_SEEN_WRITE_INTERVAL:
            self.sight.last_seen_written = now
            self.daemon.store.set_setting(f"last_seen:{self.printer_id}", datetime.now(UTC).isoformat())

    def _bump_run_seq(self) -> None:
        self.run_seq += 1
        self.daemon.store.run_seq_set(self.printer_id, self.run_seq)  # 先写盘，再上报

    def _track_run(self, cur: DeviceSnapshot) -> None:
        running = cur.state in RUNNING_STATES
        name = cur.job.name if cur.job else None
        run = self.run
        new_run = running and (run is None or run.name != name)

        if run is not None and (not running or new_run):
            same_task_ended = not new_run and cur.state in ENDED_STATES and name == run.name
            self._run_ended(run, cur.state if same_task_ended else None, cur)
            self._ended_run = run
            self.run = run = None

        if new_run:
            self._bump_run_seq()
            job_ref = self._job_ref_of(name)
            if job_ref is not None and (self.daemon.store.job_end_kind(job_ref) or self.daemon.store.no_start_has(job_ref)):
                # 一个已经结束的任务又跑了起来：当外部任务，不挂回原来的订单
                job_ref = None
            run = self.run = Run(name=name, job_ref=job_ref)
            if run.external:
                self._emit("external.started", data={"name": name or ""})
            else:
                pending = self.daemon.store.start_get(job_ref)
                run.started_reported = bool(pending and pending.started_seen)
                self.pipelines.pop(job_ref, None)
        elif run is None and cur.state is NormalizedState.FINISHED and self._first_state:
            self._report_finish_seen_late(name)

        if run is None or not running:
            return
        if not run.external:
            assert run.job_ref is not None
            if cur.state is NormalizedState.PRINTING and not run.started_reported:
                run.started_reported = True
                self.daemon.store.start_mark_seen(run.job_ref)
                self._emit("job.started", job_ref=run.job_ref)
            paused = cur.state in PAUSED_STATES
            if paused and not run.paused:
                reason = "USER"
                if cur.state is NormalizedState.ERROR_PAUSED:
                    reason = "RUNOUT" if any(error.runout for error in cur.errors) else "ERROR"
                self._emit("job.paused", job_ref=run.job_ref, data={"reason": reason})
            elif not paused and run.paused:
                self._emit("job.resumed", job_ref=run.job_ref)
            run.paused = paused
            skipped = cur.job.skipped_parts if cur.job else ()
            if skipped != run.skipped:
                run.skipped = skipped
                self._emit("job.parts_skipped", job_ref=run.job_ref, data={"partIds": list(skipped)})

    def _run_ended(self, run: Run, result: NormalizedState | None, cur: DeviceSnapshot) -> None:
        if run.external:
            self._emit("external.ended", data={"result": result.value if result else "UNKNOWN"})
            return
        assert run.job_ref is not None
        if result is None:
            # 任务不见了但打印机没给结局（比如断电重启后回到空闲）：不下结论，留给面板对账或人判
            LOGGER.warning("任务 %s 没有结局就消失了", run.job_ref)
            return
        before_start = not run.started_reported
        if result is NormalizedState.FINISHED:
            self._end_job(run.job_ref, "job.finished", None)
        elif result is NormalizedState.FAILED:
            fatal = next((error for error in cur.errors if error.severity == "fatal"), None)
            reason = (fatal.message or fatal.vendor_code) if fatal else "printer_reported_failure"
            self._end_job(run.job_ref, "job.failed", {"reason": reason, "beforeStart": before_start})
        else:
            data: dict[str, Any] = {"beforeStart": before_start}
            command_id = self._stops.by_job.pop(run.job_ref, None)
            if command_id is not None:
                data["commandId"] = command_id  # 是面板的停止生效了；没有就是有人在打印机上停的
            self._end_job(run.job_ref, "job.cancelled", data)

    def _report_finish_seen_late(self, name: str | None) -> None:
        """daemon 重启后第一眼看到打印机停在"打完"，而面板还把这个任务当作当前任务：补报一次。

        失败和取消不补报：没看到过程，分不清是开打前还是开打后，留给人判。
        """
        job_ref = self._job_ref_of(name)
        current = self.assignment.currentJobRef
        if job_ref is None or current is None or str(current.root) != job_ref:
            return
        if self.daemon.store.job_end_kind(job_ref) or self.daemon.store.no_start_has(job_ref):
            return
        self._end_job(job_ref, "job.finished", None)

    def _end_job(self, job_ref: str, kind: str, data: dict[str, Any] | None) -> bool:
        """记下任务的结局并报给面板。结束记录、待发的事件、"文件待删"在一个事务里。一个任务只结束一次。"""
        store = self.daemon.store
        if store.job_end_kind(job_ref) is not None:
            return False
        message = self.daemon.link.prepare("printer.event", self._event_body(kind, job_ref, data))
        with store.transaction():
            store.job_end_add(job_ref, self.printer_id, kind, message.id)
            store.outbox_add(message)
            store.file_mark_delete(self.printer_id, job_ref)
            store.start_remove(job_ref)
        self.daemon.link.deliver(message)
        self.pipelines.pop(job_ref, None)
        self._schedule_cleanup()
        return True

    def _track_errors(self, cur: DeviceSnapshot) -> None:
        current = {error.error_id: error for error in cur.errors}
        job_ref = self.run.job_ref if self.run else None
        for error_id, error in current.items():
            if error_id not in self._errors:
                self._emit("error.raised", job_ref=job_ref, data={"error": _error_body(error)})
        for error_id in self._errors.keys() - current.keys():
            cleared_by = "PANEL" if error_id in self._resolved_errors else "UNKNOWN"
            self._resolved_errors.discard(error_id)
            self._emit("error.cleared", job_ref=job_ref, data={"errorId": error_id, "clearedBy": cleared_by})
        self._errors = current

    def _job_ref_of(self, name: str | None) -> str | None:
        """打印机上的任务名对不对得上系统任务。本机清单只是缓存，面板下发的才算数。"""
        match = SYSTEM_NAME.match(name or "")
        if match is None:
            return None
        store = self.daemon.store
        remote = f"pr-{match.group(1)}{FILE_SUFFIX}"
        job_ref = store.file_job_ref(self.printer_id, remote)
        if job_ref is not None:
            return job_ref
        candidates = [self.assignment.currentJobRef, *self.assignment.cleanupJobRefs]
        for candidate in candidates:
            if candidate is not None and task_name(str(candidate.root)) == f"pr-{match.group(1)}":
                # 面板认它、清单里没有（打印机刚移过来，或清单丢了）：收进清单
                store.file_add(self.printer_id, remote, str(candidate.root))
                return str(candidate.root)
        return None

    # 往面板发

    def _next_seq(self) -> int:
        self._seq += 1
        return self._seq

    def _event_body(self, kind: str, job_ref: str | None, data: dict[str, Any] | None) -> dict[str, Any]:
        body: dict[str, Any] = {"printerId": self.printer_id, "bootId": self.daemon.boot_id, "seq": self._next_seq(), "kind": kind}
        if job_ref is not None:
            body["jobRef"] = job_ref
        if data is not None:
            body["data"] = data
        return body

    def _emit(self, kind: str, *, job_ref: str | None = None, data: dict[str, Any] | None = None) -> None:
        self.daemon.link.send("printer.event", self._event_body(kind, job_ref, data))

    def emit_job_event(self, kind: str, job_ref: str, data: dict[str, Any] | None = None) -> None:
        self._emit(kind, job_ref=job_ref, data=data)

    def end_job(self, job_ref: str, kind: str, data: dict[str, Any] | None) -> bool:
        return self._end_job(job_ref, kind, data)

    def result(self, command_id: str, status: str, *, code: str | None = None, message: str | None = None, data: dict[str, Any] | None = None) -> None:
        body: dict[str, Any] = {"commandId": command_id, "status": status}
        if code is not None:
            body["code"] = code
        if message is not None:
            body["message"] = message
        if data is not None:
            body["data"] = data
        self.daemon.link.send("command.result", body)

    def request_snapshot(self) -> None:
        """有变化就要发快照，但同一台最多每秒一份；中间的变化合并成最新的一份。"""
        self._snapshot_dirty = True
        if self._snapshot_task is None or self._snapshot_task.done():
            self._snapshot_task = asyncio.create_task(self._flush_snapshots())

    async def _flush_snapshots(self) -> None:
        loop = asyncio.get_running_loop()
        while self._snapshot_dirty:
            wait = self._last_snapshot_at + SNAPSHOT_MIN_INTERVAL - loop.time()
            if wait > 0:
                await asyncio.sleep(wait)
            self.send_snapshot_now()

    def send_snapshot_now(self) -> None:
        self._snapshot_dirty = False
        self._last_snapshot_at = asyncio.get_running_loop().time()
        self.daemon.link.send("printer.snapshot", self.snapshot_body())

    def snapshot_body(self) -> dict[str, Any]:
        snap = self.snap
        body: dict[str, Any] = {
            "printerId": self.printer_id,
            "bootId": self.daemon.boot_id,
            "seq": self._next_seq(),
            "connected": snap.connected,
            "state": snap.state.value,
            "runSeq": self.run_seq,
        }
        pending = [
            {"jobRef": job_ref, "stage": pipeline.stage}
            for job_ref, pipeline in self.pipelines.items()
            if pipeline.stage in ("QUEUED", "DOWNLOADING", "UPLOADING")
        ]
        if pending:
            body["pendingStarts"] = pending
        if not snap.connected:
            return body
        if snap.substage is not None:
            body["substage"] = snap.substage.value
        if snap.job is not None and snap.state is not NormalizedState.IDLE:
            job = snap.job
            known = next((run for run in (self.run, self._ended_run) if run is not None and run.name == job.name), None)
            job_ref = known.job_ref if known is not None else self._job_ref_of(job.name)
            entry: dict[str, Any] = {"external": job_ref is None}
            if job_ref is not None:
                entry["jobRef"] = job_ref
            for key, value in (
                ("name", job.name),
                ("percent", job.percent),
                ("remainingSeconds", job.remaining_seconds),
                ("layer", job.layer),
                ("totalLayers", job.total_layers),
            ):
                if value is not None:
                    entry[key] = value
            if job.skipped_parts:
                entry["skippedParts"] = list(job.skipped_parts)
            body["job"] = entry
        if snap.temps:
            body["temps"] = {
                key: {"current": value.current, **({"target": value.target} if value.target is not None else {})}
                for key, value in snap.temps.items()
            }
        if snap.nozzles:
            body["nozzles"] = [
                {"extruder": nozzle.extruder, "diameterMm": nozzle.diameter_mm, **({"flow": nozzle.flow} if nozzle.flow else {})}
                for nozzle in snap.nozzles
            ]
        if snap.trays:
            body["trays"] = [_tray_body(tray) for tray in snap.trays]
        if snap.bed_type is not None:
            body["bedType"] = snap.bed_type
        if snap.storage:
            body["storage"] = [
                {key: value for key, value in (("medium", item.medium), ("present", item.present), ("writable", item.writable), ("freeBytes", item.free_bytes)) if value is not None}
                for item in snap.storage
            ]
        body["activeErrors"] = [_error_body(error) for error in snap.errors]
        if snap.controls:
            body["controls"] = dict(snap.controls)
        body["camera"] = {"stream": snap.camera_stream, "snapshot": snap.camera_snapshot}
        if snap.device_boot is not None:
            body["deviceBoot"] = snap.device_boot
        return body

    # 开打流程的重启收尾

    def _recover_unfinished_starts(self) -> None:
        """daemon 重启后，上次没走完的开打流程不接着做。

        没"发起打印"的，开打指令一定没发过：写下不再开打，传了一半的文件待删，按下发失败回给面板。
        已经"发起打印"的，说不清指令发没发出去：不重发、不下结论，等打印机上报或面板对账。
        """
        store = self.daemon.store
        for pending in store.starts_for(self.printer_id):
            if pending.start_issued_at is not None:
                continue
            with store.transaction():
                store.no_start_add(pending.job_ref)
                store.file_mark_delete(self.printer_id, pending.job_ref)
                store.start_remove(pending.job_ref)
            self.result(pending.command_id, "failed", code="daemon_restarted")

    # 收尾：只删 daemon 自己放上去的文件

    def _schedule_cleanup(self) -> None:
        if self._cleanup_task is None or self._cleanup_task.done():
            self._cleanup_task = asyncio.create_task(self._cleanup())

    async def _cleanup(self) -> None:
        store = self.daemon.store
        for name in store.files_to_delete(self.printer_id):
            if self.session is None or not self.sight.connected:
                return
            try:
                await self.session.delete(name)
            except AdapterError as error:
                if error.error_class == "transient":
                    return
                # 机器说删不了（多半是已经不在了）：不再惦记它
            store.file_forget(self.printer_id, name)

    # 命令

    async def handle_command(self, command: Any) -> None:
        """一条已经登记进台账、没过期的命令。"""
        from platerelay_daemon.jobs.start import StartPipeline

        command_id = str(command.commandId.root)
        kind = command.kind
        try:
            if kind == "job.start":
                pipeline = StartPipeline(self, command)
                self.pipelines[pipeline.job_ref] = pipeline
                pipeline.begin()
            elif kind == "job.stop":
                await self._stop(command_id, command.params)
            elif kind == "job.skip_parts":
                job_ref = str(command.params.jobRef.root)
                if self.run is None or self.run.job_ref != job_ref:
                    self.result(command_id, "rejected", code="job_not_running")
                    return
                await self._session().skip_parts(list(command.params.partIds))
                self.result(command_id, "accepted")
            elif kind == "error.resolve":
                await self._resolve_error(command_id, command.params.errorId, command.params.action.value)
            elif kind == "control":
                await self._control(command_id, command.params.action, command.params.args or {})
            elif kind == "refresh":
                await self._session().refresh()
                self.result(command_id, "done")
            elif kind == "storage.list":
                await self._storage_list(command_id)
            elif kind in ("snapshot.mode", "snapshot.now", "camera.close"):
                self.result(command_id, "done")  # 抓拍和实况还没做，这几条收下即可
            elif kind == "camera.open":
                self.result(command_id, "failed", code="stream_unavailable")
            elif kind == "timelapse.collect":
                self.result(command_id, "done", data={"files": []})
            else:
                self.result(command_id, "rejected", code="unsupported_command")
        except AdapterError as error:
            self._result_for_error(command_id, error)

    def _session(self) -> PrinterSession:
        if self.session is None or not self.sight.connected:
            raise AdapterError("printer_unreachable")
        return self.session

    def _result_for_error(self, command_id: str, error: AdapterError) -> None:
        if error.error_class == "unsupported":
            self.result(command_id, "rejected", code="unsupported", message=str(error))
        elif error.error_class == "transient":
            self.result(command_id, "failed", code="printer_unreachable", message=str(error))
        else:
            # 固件或打印机的原话，原样带给人看
            self.result(command_id, "failed", code=error.error_class, message=str(error))

    async def _stop(self, command_id: str, params: Any) -> None:
        run = self.run
        if isinstance(params, v1.StopExternalParams):
            if run is None or not run.external:
                self.result(command_id, "rejected", code="no_external_job")
                return
            await self._session().stop()
            self.result(command_id, "accepted")
            return

        job_ref = str(params.jobRef.root)
        store = self.daemon.store
        if run is not None and run.job_ref == job_ref:
            # 只有打印机正在跑的就是这个任务时，才把停止发给打印机：
            # 有的打印机的停止不分任务，发了会停掉正在跑的别的任务。
            self._stops.by_job[job_ref] = command_id
            try:
                await self._session().stop()
            except AdapterError:
                self._stops.by_job.pop(job_ref, None)
                raise
            self.result(command_id, "accepted")
            return

        pipeline = self.pipelines.get(job_ref)
        if pipeline is not None and not pipeline.start_issued:
            # 开打指令只有 daemon 会发，还没发就以 daemon 为准，不用等打印机
            await pipeline.cancel(command_id)
            self.result(command_id, "accepted")
            return

        store.no_start_add(job_ref)
        if pipeline is not None and pipeline.can_prove_not_started():
            # 文件放上去之后一直看得到打印机，它也什么都没跑过：删掉文件，迟到的开打指令也就打不起来
            await pipeline.withdraw(command_id)
            self.result(command_id, "accepted")
            return
        # 其余情况不下结论：只记下不再开打，什么都不发给打印机
        self.result(command_id, "done", code="not_running")

    async def _resolve_error(self, command_id: str, error_id: str, action: str) -> None:
        if error_id not in self._errors:
            self.result(command_id, "rejected", code="error_not_active")
            return
        if action == "STOP" and self.run is not None and self.run.job_ref is not None:
            self._stops.by_job[self.run.job_ref] = command_id
        self._resolved_errors.add(error_id)
        try:
            await self._session().resolve_error(error_id, action)
        except AdapterError:
            self._resolved_errors.discard(error_id)
            raise
        self.result(command_id, "accepted")

    async def _control(self, command_id: str, action: str, args: dict[str, Any]) -> None:
        description = self._adapter.describe(self.snap.model_id or "")
        if action not in {control.action for control in description.controls}:
            # 只执行这个机型静态清单里的动作
            self.result(command_id, "rejected", code="unsupported_control")
            return
        await self._session().control(action, args)
        self.result(command_id, "accepted")

    async def _storage_list(self, command_id: str) -> None:
        session = self._session()
        media = await session.storage_status()
        files = await session.list_files()
        self.result(command_id, "done", data={
            "media": [
                {key: value for key, value in (("medium", item.medium), ("present", item.present), ("freeBytes", item.free_bytes), ("totalBytes", item.total_bytes)) if value is not None}
                for item in media
            ],
            "files": [
                {
                    "medium": item.medium,
                    "name": item.name,
                    **({"sizeBytes": item.size_bytes} if item.size_bytes is not None else {}),
                    **({"modifiedAt": item.modified_at.isoformat().replace("+00:00", "Z")} if item.modified_at else {}),
                    "system": self._job_ref_of(item.name) is not None,
                }
                for item in files
            ],
        })


def _tray_body(tray: Any) -> dict[str, Any]:
    body: dict[str, Any] = {"unit": tray.unit, "slot": tray.slot}
    for key, value in (
        ("label", tray.label),
        ("material", tray.material),
        ("subType", tray.sub_type),
        ("colour", tray.colour),
        ("rfidUid", tray.rfid_uid),
        ("remainingPercent", tray.remaining_percent),
    ):
        if value is not None:
            body[key] = value
    if tray.extruders:
        body["extruders"] = list(tray.extruders)
    return body


def _error_body(error: DeviceError) -> dict[str, Any]:
    body: dict[str, Any] = {
        "errorId": error.error_id,
        "vendorCode": error.vendor_code,
        "channel": error.channel,
        "severity": error.severity,
        "blocksJob": error.blocks_job,
        "actions": [
            {
                "action": action.action,
                "label": action.label,
                "requiresOnSite": action.requires_on_site,
                "destructive": action.destructive,
                **({"vendorActionId": action.vendor_action_id} if action.vendor_action_id is not None else {}),
            }
            for action in error.actions
        ],
        "raisedAt": error.raised_at.isoformat().replace("+00:00", "Z"),
    }
    if error.module is not None:
        body["module"] = error.module
    if error.message is not None:
        body["message"] = error.message
    return body
