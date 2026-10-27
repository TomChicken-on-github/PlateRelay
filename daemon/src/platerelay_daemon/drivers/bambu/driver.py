"""拓竹 driver：底层用 ha-bambulab 的 pybambu 收发 MQTT / FTPS，这里只做归一和事件桥接。

目前只读：收状态、出快照、推事件。派单、暂停、报错处理等控制命令还没接，
调用会抛 ControlNotAllowedError。
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from pathlib import Path

from platerelay_daemon.driver_api import (
    ConnectionEvent,
    ControlNotAllowedError,
    DeviceInfo,
    DeviceSnapshot,
    DeviceStatus,
    Envelope,
    NormalizedState,
    Progress,
    ProgressEvent,
    StatusEvent,
)

from .read_only import ReadOnlyBambuClient
from .state_map import map_state, stage_name

LOGGER = logging.getLogger(__name__)

Handler = Callable[[Envelope], None]


class BambuDriver:
    brand = "bambu"

    def __init__(
        self,
        *,
        printer_id: str,
        host: str,
        serial: str,
        access_code: str,
        model: str,
        cache_dir: str | Path,
        user_language: str = "zh-CN",
    ) -> None:
        # access_code 由 daemon 运行时传入，不落盘、不进日志。
        self._printer_id = printer_id
        self._config = {
            "host": host,
            "serial": serial,
            "access_code": access_code,
            "device_type": model,
            "local_mqtt": True,
            "enable_camera": False,
            "file_cache_path": str(cache_dir),
            "user_language": user_language,
        }
        self._client: ReadOnlyBambuClient | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._handlers: list[Handler] = []
        self._seq = 0
        self._last_connected: bool | None = None
        self._last_status: DeviceStatus | None = None
        self._last_progress: Progress | None = None

    # 连接

    async def connect(self) -> None:
        self._loop = asyncio.get_running_loop()
        self._client = ReadOnlyBambuClient(self._config)
        await self._client.connect(callback=self._on_client_event)

    async def disconnect(self) -> None:
        client, self._client = self._client, None
        if client is not None:
            await asyncio.get_running_loop().run_in_executor(None, client.disconnect)
        self._publish_changes(force_offline=True)

    # 查询

    def info(self) -> DeviceInfo:
        nozzles = []
        if self._client is not None:
            device_info = self._client.get_device().info
            for index, diameter in device_info.nozzle_diameters.items():
                if diameter:
                    nozzles.append({
                        "index": index,
                        "diameterMm": diameter,
                        "type": device_info.nozzle_types.get(index),
                    })
        return DeviceInfo(
            printer_id=self._printer_id,
            brand=self.brand,
            model=self._config["device_type"],
            nozzles=nozzles,
        )

    def snapshot(self) -> DeviceSnapshot:
        return DeviceSnapshot(
            info=self.info(),
            connected=self._connected(),
            status=self._status(),
            progress=self._progress(),
        )

    def subscribe(self, handler: Handler) -> Callable[[], None]:
        self._handlers.append(handler)
        return lambda: self._handlers.remove(handler)

    # 控制命令：等用户同意接控制之后再实现

    async def start(self, *args, **kwargs):
        raise ControlNotAllowedError("拓竹 driver 目前只读，尚未实现派单")

    async def pause(self, command_id: str):
        raise ControlNotAllowedError("拓竹 driver 目前只读，尚未实现暂停")

    async def resume(self, command_id: str):
        raise ControlNotAllowedError("拓竹 driver 目前只读，尚未实现继续")

    async def cancel(self, command_id: str):
        raise ControlNotAllowedError("拓竹 driver 目前只读，尚未实现取消")

    # 内部

    def _connected(self) -> bool:
        client = self._client
        return bool(client and client.connected and client.get_device().info.online)

    def _status(self) -> DeviceStatus:
        if not self._connected():
            return DeviceStatus(state=NormalizedState.OFFLINE)
        device = self._client.get_device()
        gcode_state = device.print_job.gcode_state
        stg_cur = device.stage._id
        print_error = device.print_job.print_error or 0
        state, substage = map_state(gcode_state, stg_cur, print_error)
        return DeviceStatus(
            state=state,
            substage=substage,
            raw_substage=stage_name(stg_cur),
            raw={
                "gcode_state": gcode_state,
                "stg_cur": stg_cur,
                "print_error": print_error,
                "hms": list(device.hms._hms_list),
            },
        )

    def _progress(self) -> Progress:
        if not self._connected():
            return Progress()
        device = self._client.get_device()
        job = device.print_job
        temps = {"bed": device.temperature.bed_temp, "chamber": device.temperature.chamber_temp}
        for index, value in device.temperature.nozzle_temps.items():
            if index in device.info.nozzle_diameters and device.info.nozzle_diameters[index]:
                temps[f"nozzle{index}"] = value
        return Progress(
            percent=job.print_percentage,
            remaining_sec=job.remaining_time * 60 if job.remaining_time is not None else None,
            layer=job.current_layer,
            total_layers=job.total_layers,
            temps=temps,
        )

    def _on_client_event(self, event: str) -> None:
        # pybambu 在自己的 MQTT 线程里回调，转回 asyncio 线程再处理。
        if self._loop is not None and not self._loop.is_closed():
            self._loop.call_soon_threadsafe(self._publish_changes)

    def _publish_changes(self, force_offline: bool = False) -> None:
        connected = False if force_offline else self._connected()
        if connected != self._last_connected:
            self._last_connected = connected
            self._emit(ConnectionEvent(state="connected" if connected else "disconnected"))

        status = DeviceStatus(state=NormalizedState.OFFLINE) if force_offline else self._status()
        if status != self._last_status:
            self._last_status = status
            self._emit(StatusEvent(status=status))

        progress = Progress() if force_offline else self._progress()
        if connected and progress != self._last_progress:
            self._last_progress = progress
            self._emit(ProgressEvent(progress=progress))

    def _emit(self, event) -> None:
        self._seq += 1
        envelope = Envelope(printer_id=self._printer_id, seq=self._seq, event=event)
        for handler in list(self._handlers):
            try:
                handler(envelope)
            except Exception:
                LOGGER.exception("driver 事件处理出错")
