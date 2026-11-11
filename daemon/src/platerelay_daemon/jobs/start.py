"""一条"开打"命令在 daemon 里的全过程：

    排队 → 下载 → 核对 → 传到打印机 → 开打前检查 → 发起打印（落盘）→ 发开打指令

"发起打印"是分界线：之前出任何事，开打指令一定没发过，可以干净地退回；
之后不再重试任何一步，结果只看打印机上报。
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from platerelay_daemon.adapter_api import RUNNING_STATES, AdapterError, SlotMapping, StartJob

if TYPE_CHECKING:
    from platerelay_daemon.printers.worker import PrinterWorker

LOGGER = logging.getLogger(__name__)


class _StepFailed(Exception):
    pass


class StartPipeline:
    def __init__(self, worker: PrinterWorker, command: Any) -> None:
        from platerelay_daemon.printers.worker import file_name, task_name

        self.worker = worker
        self.command_id = str(command.commandId.root)
        self.params = command.params
        self.job_ref = str(command.params.jobRef.root)
        self.remote_name = file_name(self.job_ref)
        self.task_name = task_name(self.job_ref)
        self.stage = "QUEUED"
        self.start_issued = False
        self.attempts: list[dict[str, Any]] = []
        self._task: asyncio.Task | None = None
        self._uploaded = False
        self._sight_epoch: int | None = None
        self._run_seq_at_issue: int | None = None
        self._withdrawn = False

    @property
    def _daemon(self):
        return self.worker.daemon

    def begin(self) -> None:
        store = self._daemon.store
        if store.no_start_has(self.job_ref) or store.job_end_kind(self.job_ref):
            self.worker.pipelines.pop(self.job_ref, None)
            self.worker.result(self.command_id, "rejected", code="job_already_ended")
            return
        store.start_add(self.job_ref, self.worker.printer_id, self.command_id, self.params.model_dump(mode="json"))
        # 进了队列就算开始执行，之后不会因为排队而过期
        self._progress("queued")
        self._task = asyncio.create_task(self._run(), name=f"start-{self.job_ref}")

    def abort(self) -> None:
        """daemon 要退出了：只停下协程，收尾留给下次启动。"""
        if self._task is not None:
            self._task.cancel()

    def _progress(self, step: str) -> None:
        data: dict[str, Any] = {"step": step}
        if self.attempts:
            data["attempts"] = self.attempts
        self.worker.result(self.command_id, "accepted", data=data)
        self.worker.request_snapshot()

    # 主流程

    async def _run(self) -> None:
        local = self._daemon.work_dir / f"{self.job_ref}.3mf"
        try:
            async with self._daemon.download_slots:
                self.stage = "DOWNLOADING"
                self._progress("download")
                await self._with_retries("download", lambda: self._download(local))
            self.stage = "UPLOADING"
            self._progress("upload")
            await self._with_retries("upload", lambda: self._upload(local))
            await self._issue_start()
        except _StepFailed:
            await self._give_up("failed", "transfer_failed")
        except asyncio.CancelledError:
            raise
        except Exception:
            LOGGER.exception("开打流程出错：%s", self.job_ref)
            if not self.start_issued:
                await self._give_up("failed", "internal_error")
        finally:
            with contextlib.suppress(OSError):
                local.unlink()

    async def _with_retries(self, step: str, action) -> None:
        delays = self._daemon.retry_delays
        for attempt in range(len(delays) + 1):
            try:
                async with asyncio.timeout(self._daemon.transfer_timeout_seconds):
                    await action()
                return
            except asyncio.CancelledError:
                raise
            except Exception as error:
                # 每次失败都记下来给面板看；下一次重试会覆盖没传完的文件
                self.attempts.append({"step": step, "error": _describe(error), "at": datetime.now(UTC).isoformat().replace("+00:00", "Z")})
                if attempt == len(delays):
                    raise _StepFailed from error
                self._progress(step)
                await asyncio.sleep(delays[attempt])

    async def _download(self, local: Path) -> None:
        file = self.params.file
        await self._daemon.link.download(str(file.fileId.root), self.job_ref, local, self._daemon.transfer_timeout_seconds)
        digest = hashlib.sha256()
        size = 0
        with local.open("rb") as handle:
            while chunk := await asyncio.to_thread(handle.read, 1024 * 1024):
                digest.update(chunk)
                size += len(chunk)
        if size != file.sizeBytes or digest.hexdigest() != file.sha256.lower():
            raise ValueError("downloaded file does not match size or sha256")

    async def _upload(self, local: Path) -> None:
        worker = self.worker
        if worker.session is None or not worker.sight.connected:
            raise ConnectionError("printer_unreachable")
        if self._sight_epoch is None:
            self._sight_epoch = worker.sight.epoch
        # 先记进清单再传：传到一半失败留下的残片也算我们的，之后才能删
        self._daemon.store.file_add(worker.printer_id, self.remote_name, self.job_ref)
        self._uploaded = True
        remote = await worker.session.upload(local, self.remote_name)
        if remote.size_bytes is not None and remote.size_bytes != self.params.file.sizeBytes:
            raise ValueError("uploaded file size mismatch")

    async def _issue_start(self) -> None:
        worker = self.worker
        store = self._daemon.store
        if store.no_start_has(self.job_ref):
            return
        if worker.snap.state in RUNNING_STATES:
            # 打印机正在跑别的任务：什么都不发
            await self._give_up("rejected", "printer_busy")
            return
        seen_all_along = worker.sight.connected and worker.sight.epoch == self._sight_epoch
        if worker.run_seq != self.params.expectedRunSeq or not seen_all_along:
            # 派单之后打印机跑过东西，或者传文件期间有一段时间看不到它：
            # 板子可能没清，不能开打
            await self._give_up("rejected", "printer_used")
            return
        mapping = tuple(SlotMapping(item.sliceSlot, item.extruder, item.unit, item.slot) for item in self.params.mapping)
        job = StartJob(
            remote_file=self.remote_name,
            task_name=self.task_name,
            plate_index=self.params.plateIndex,
            bed_type=self.params.bedType,
            mapping=mapping,
            timelapse=self.params.timelapse,
        )
        # 先落盘"发起打印"，再发指令：重启后据此知道指令可能已经发出，不能重发
        store.start_mark_issued(self.job_ref)
        self.start_issued = True
        self.stage = "ISSUED"
        self._run_seq_at_issue = worker.run_seq
        self._daemon.before_start_command(self)
        try:
            assert worker.session is not None
            await worker.session.start(job)
        except AdapterError as error:
            if error.error_class == "transient":
                # 说不清打印机收没收到：不重发、不下结论，等它上报
                LOGGER.warning("开打指令的结果不明：%s", self.job_ref)
            else:
                # 打印机明确拒绝了，任务没有开始
                await self._give_up("failed", "start_rejected", message=str(error))
                return
        worker.emit_job_event("job.staged", self.job_ref)
        worker.request_snapshot()

    # 各种退出

    async def _give_up(self, status: str, code: str, message: str | None = None) -> None:
        """这条开打到此为止：写下不再开打，删掉自己传上去的文件，把原因回给面板。"""
        store = self._daemon.store
        with store.transaction():
            store.no_start_add(self.job_ref)
            store.file_mark_delete(self.worker.printer_id, self.job_ref)
            store.start_remove(self.job_ref)
        self.worker.pipelines.pop(self.job_ref, None)
        data = {"attempts": self.attempts} if self.attempts else None
        self.worker.result(self.command_id, status, code=code, message=message, data=data)
        self.worker._schedule_cleanup()
        self.worker.request_snapshot()

    async def cancel(self, stop_command_id: str) -> None:
        """传文件期间被停止：中止传输，之后永远不再为这个任务发开打。"""
        self._daemon.store.no_start_add(self.job_ref)
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._task
        self.worker.end_job(self.job_ref, "job.cancelled", {"commandId": stop_command_id, "beforeStart": True})
        self.worker.request_snapshot()

    def can_prove_not_started(self) -> bool:
        worker = self.worker
        return (
            self.start_issued
            and not self._withdrawn
            and worker.sight.connected
            and worker.sight.epoch == self._sight_epoch
            and worker.run_seq == self._run_seq_at_issue
        )

    async def withdraw(self, stop_command_id: str) -> None:
        """开打指令发了但打印机没跑起来，而且能证明它什么都没跑过：撤掉文件，报"开打前停下"。"""
        self._withdrawn = True
        self.worker.end_job(self.job_ref, "job.cancelled", {"commandId": stop_command_id, "beforeStart": True})


def _describe(error: Exception) -> str:
    text = str(error)
    return f"{type(error).__name__}: {text}" if text else type(error).__name__
