"""模拟打印机的驱动：只通过它的局域网接口（HTTP + WebSocket）工作。

和拓竹一样，机器连上先给一份完整状态，之后只推变化的字段，这里负责合并成完整状态。
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, ClassVar

import aiohttp

from platerelay_daemon.adapter_api import (
    OFFLINE_SNAPSHOT,
    ControlSpec,
    DeviceEvent,
    DeviceSnapshot,
    FatalConfigError,
    MachineFaultError,
    ModelDescription,
    PrinterTarget,
    RemoteFile,
    StartJob,
    StorageStatus,
    TransientError,
    UnsupportedError,
)

from .state_map import CHOICES, map_snapshot

LOGGER = logging.getLogger(__name__)

RECONNECT_SECONDS = (0.5, 1, 2, 5)
REQUEST_TIMEOUT = aiohttp.ClientTimeout(total=15)
# 打印机的时钟不一定准，查"断线期间跑没跑过"时留一点余量
CLOCK_MARGIN_SECONDS = 5


def apply_patch(target: dict[str, Any], patch: dict[str, Any]) -> None:
    """把机器推来的增量合并进完整状态：字典递归合并，null 表示字段没了，其余整值替换。"""
    for key, value in patch.items():
        if value is None:
            target.pop(key, None)
        elif isinstance(value, dict) and isinstance(target.get(key), dict):
            apply_patch(target[key], value)
        else:
            target[key] = value


class SimSession:
    def __init__(self, target: PrinterTarget) -> None:
        self._target = target
        self._base = f"http://{target.host}"
        self._http: aiohttp.ClientSession | None = None
        self._listener: asyncio.Task | None = None
        self._events: asyncio.Queue[DeviceEvent] = asyncio.Queue()
        self._status: dict[str, Any] | None = None
        self._info: dict[str, Any] = {}
        self._socket: aiohttp.ClientWebSocketResponse | None = None

    # 连接

    async def connect(self) -> None:
        self._http = aiohttp.ClientSession(timeout=REQUEST_TIMEOUT)
        self._listener = asyncio.create_task(self._listen())

    async def close(self) -> None:
        if self._listener is not None:
            self._listener.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._listener
        if self._http is not None:
            await self._http.close()
        self._status = None

    def _headers(self) -> dict[str, str]:
        code = self._target.access_code()
        return {"X-Access-Code": code} if code else {}

    async def _listen(self) -> None:
        attempt = 0
        while True:
            try:
                assert self._http is not None
                async with self._http.get(f"{self._base}/api/info", headers=self._headers()) as response:
                    if response.status == 401:
                        raise FatalConfigError("access_code_rejected")
                    info = await response.json()
                if info.get("serial") != self._target.serial:
                    # 这个地址上是另一台机器（比如地址被重新分配了），不能把它当成我们的打印机
                    raise FatalConfigError("serial_mismatch")
                self._info = info
                async with self._http.ws_connect(f"{self._base}/api/ws", headers=self._headers(), heartbeat=10, timeout=aiohttp.ClientWSTimeout(ws_close=5)) as socket:
                    self._socket = socket
                    attempt = 0
                    async for message in socket:
                        if message.type != aiohttp.WSMsgType.TEXT:
                            continue
                        self._on_push(json.loads(message.data))
                reason = "connection_closed"
            except FatalConfigError as error:
                reason = str(error)
            except (aiohttp.ClientError, TimeoutError, OSError, json.JSONDecodeError) as error:
                reason = type(error).__name__
            finally:
                self._socket = None
            if self._status is not None:
                self._status = None
                self._events.put_nowait(DeviceEvent("disconnected", reason))
            elif attempt == 0:
                self._events.put_nowait(DeviceEvent("disconnected", reason))
            await asyncio.sleep(RECONNECT_SECONDS[min(attempt, len(RECONNECT_SECONDS) - 1)])
            attempt += 1

    def _on_push(self, push: dict[str, Any]) -> None:
        kind = push.get("t")
        if kind == "full":
            first = self._status is None
            self._status = push["status"]
            self._events.put_nowait(DeviceEvent("connected" if first else "changed"))
        elif kind == "patch" and self._status is not None:
            apply_patch(self._status, push["patch"])
            self._events.put_nowait(DeviceEvent("changed"))

    async def events(self) -> AsyncIterator[DeviceEvent]:
        while True:
            yield await self._events.get()

    def snapshot(self) -> DeviceSnapshot:
        if self._status is None:
            return OFFLINE_SNAPSHOT
        return map_snapshot(self._status, self._info)

    async def refresh(self) -> None:
        if self._socket is None:
            raise TransientError("printer_unreachable")
        await self._socket.send_json({"cmd": "push_all"})

    async def ran_during_gap(self, since: datetime) -> bool | None:
        try:
            history = await self._request("GET", "/api/history")
        except TransientError:
            return None
        threshold = since.timestamp() - CLOCK_MARGIN_SECONDS
        return any(entry.get("started_at", 0) >= threshold or entry.get("ended_at", 0) >= threshold for entry in history)

    # 请求

    async def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        if self._http is None:
            raise TransientError("printer_unreachable")
        try:
            async with self._http.request(method, f"{self._base}{path}", headers=self._headers(), **kwargs) as response:
                body = await response.json(content_type=None)
                if response.status == 401:
                    raise FatalConfigError("access_code_rejected")
                if response.status >= 400:
                    # 固件拒绝：把它的原话带回去给人看
                    raise MachineFaultError(body.get("error") if isinstance(body, dict) else f"HTTP {response.status}")
                return body
        except (aiohttp.ClientError, TimeoutError, OSError, json.JSONDecodeError) as error:
            raise TransientError(f"printer_unreachable: {type(error).__name__}") from error

    async def _command(self, **body: Any) -> None:
        await self._request("POST", "/api/command", json=body)

    # 文件

    async def upload(self, local_file: Path, remote_name: str) -> RemoteFile:
        size = local_file.stat().st_size

        async def chunks():
            with local_file.open("rb") as handle:
                while chunk := await asyncio.to_thread(handle.read, 256 * 1024):
                    yield chunk

        result = await self._upload(remote_name, chunks(), size)
        if result.get("size") != size:
            raise TransientError("upload_size_mismatch")
        return RemoteFile(name=remote_name, size_bytes=size)

    async def _upload(self, remote_name: str, data: Any, size: int) -> dict[str, Any]:
        if self._http is None:
            raise TransientError("printer_unreachable")
        headers = {**self._headers(), "Content-Length": str(size)}
        try:
            async with self._http.put(f"{self._base}/api/files/{remote_name}", data=data, headers=headers, timeout=aiohttp.ClientTimeout(total=None, sock_read=30)) as response:
                body = await response.json(content_type=None)
                if response.status >= 400:
                    raise MachineFaultError(body.get("error", f"HTTP {response.status}"))
                return body
        except (aiohttp.ClientError, TimeoutError, OSError, json.JSONDecodeError) as error:
            raise TransientError(f"upload_interrupted: {type(error).__name__}") from error

    async def list_files(self) -> list[RemoteFile]:
        files = await self._request("GET", "/api/files")
        return [
            RemoteFile(name=item["name"], size_bytes=item.get("size"), modified_at=datetime.fromtimestamp(item["mtime"], UTC) if "mtime" in item else None)
            for item in files
        ]

    async def delete(self, remote_name: str) -> None:
        await self._request("DELETE", f"/api/files/{remote_name}")

    async def storage_status(self) -> list[StorageStatus]:
        return list(self.snapshot().storage)

    # 动作

    async def start(self, job: StartJob) -> None:
        await self._request("POST", "/api/print", json={
            "file": job.remote_file,
            "task": job.task_name,
            "plate": job.plate_index,
            "bed": job.bed_type,
            "timelapse": job.timelapse,
            # 这台机器按"切片里的第几个耗材用哪个料位"收映射
            "slots": [{"filament": item.slice_slot, "unit": item.unit, "slot": item.slot} for item in job.mapping],
        })

    async def stop(self) -> None:
        await self._command(cmd="stop")

    async def skip_parts(self, part_ids: list[int]) -> None:
        await self._command(cmd="skip", objects=part_ids)

    async def resolve_error(self, error_id: str, action: str) -> None:
        choice = next((raw for raw, mapped in CHOICES.items() if mapped[0] == action), None)
        if choice is None or not error_id.startswith("alert-"):
            raise UnsupportedError(f"unsupported error action: {action}")
        await self._command(cmd="alert", id=int(error_id.removeprefix("alert-")), choice=choice)

    async def control(self, action: str, args: dict[str, Any]) -> None:
        if action == "light.set":
            await self._command(cmd="light", on=bool(args.get("on")))
        elif action == "job.pause":
            await self._command(cmd="pause")
        elif action == "job.resume":
            await self._command(cmd="resume")
        else:
            raise UnsupportedError(f"unsupported control: {action}")


class SimAdapter:
    brand: ClassVar[str] = "sim"
    version: ClassVar[str] = "0.1.0"

    @classmethod
    def describe(cls, model_id: str) -> ModelDescription:
        return ModelDescription(
            model_id=model_id,
            model_name="Simulated printer",
            controls=(
                ControlSpec("light.set", "light", {"type": "object", "properties": {"on": {"type": "boolean"}}, "required": ["on"]}),
                ControlSpec("job.pause", "pause", {"type": "object"}),
                ControlSpec("job.resume", "resume", {"type": "object"}),
            ),
            skip_parts=True,
        )

    @classmethod
    def open(cls, target: PrinterTarget) -> SimSession:
        return SimSession(target)
