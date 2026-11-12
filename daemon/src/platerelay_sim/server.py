"""模拟打印机的局域网接口，以及"现场"接口。

局域网接口（/api/...）是这台机器给外部软件用的全部能力：
  GET  /api/info                 机器信息
  GET  /api/status               完整状态
  GET  /api/ws                   WebSocket：连上先收一份完整状态 {"t":"full"}，之后只推变化的字段 {"t":"patch"}
                                 （值为 null 表示这个字段没了）；发 {"cmd":"push_all"} 再要一份完整的
  GET  /api/files                存储里的文件
  PUT  /api/files/{name}         上传
  DELETE /api/files/{name}       删除
  POST /api/print                开打已上传的文件
  POST /api/command              pause / resume / stop / skip / light / alert
  GET  /api/history              最近的任务记录
设了访问码时，/api 下的请求都要带请求头 X-Access-Code。

现场接口（/operator/...）代表站在机器旁的人和物理世界：在屏幕上开打、抽掉耗材、断电、拔网线。
它不属于机器的对外接口，驱动不能用。
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import time
from typing import Any

from aiohttp import WSMsgType, web

from .printer import Refused, SimConfig, SimPrinter

TICK_SECONDS = 0.2


def merge_patch_diff(old: Any, new: Any) -> Any:
    """算出把 old 变成 new 的最小补丁；只对字典递归，别的整值替换。"""
    if not isinstance(old, dict) or not isinstance(new, dict):
        return new
    patch: dict[str, Any] = {}
    for key in old.keys() - new.keys():
        patch[key] = None
    for key, value in new.items():
        if key not in old:
            patch[key] = value
        elif old[key] != value:
            patch[key] = merge_patch_diff(old[key], value)
    return patch


class SimPrinterServer:
    def __init__(self, printer: SimPrinter, host: str = "127.0.0.1", port: int = 0) -> None:
        self.printer = printer
        self.host = host
        self.port = port
        self._runner: web.AppRunner | None = None
        self._sockets: set[web.WebSocketResponse] = set()
        self._sent: dict[web.WebSocketResponse, dict[str, Any]] = {}
        self._push_seq = 0
        self._dirty = asyncio.Event()
        self._tasks: list[asyncio.Task] = []
        self._unplugged_until = 0.0
        self._uploads_in_flight: set[asyncio.Task] = set()
        printer.on_change(self._dirty.set)

    @property
    def address(self) -> str:
        return f"{self.host}:{self.port}"

    # 生命周期

    async def start(self) -> None:
        await self._listen()
        self._tasks = [asyncio.create_task(self._tick_loop()), asyncio.create_task(self._push_loop())]

    async def stop(self) -> None:
        for task in self._tasks:
            task.cancel()
        for task in self._tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await task
        await self._unlisten()

    async def _listen(self) -> None:
        app = web.Application(client_max_size=1024**3)
        app.add_routes([
            web.get("/api/info", self._guard(self._info)),
            web.get("/api/status", self._guard(self._status)),
            web.get("/api/ws", self._guard(self._ws)),
            web.get("/api/files", self._guard(self._files)),
            web.put("/api/files/{name}", self._guard(self._upload)),
            web.delete("/api/files/{name}", self._guard(self._delete)),
            web.post("/api/print", self._guard(self._print)),
            web.post("/api/command", self._guard(self._command)),
            web.get("/api/history", self._guard(self._history)),
            web.post("/operator/{action}", self._operator),
        ])
        self._runner = web.AppRunner(app)
        await self._runner.setup()
        site = web.TCPSite(self._runner, self.host, self.port)
        await site.start()
        self.port = site._server.sockets[0].getsockname()[1]  # type: ignore[union-attr]

    async def _unlisten(self) -> None:
        for socket in list(self._sockets):
            if socket._req is not None and socket._req.transport is not None:
                socket._req.transport.abort()
        self._sockets.clear()
        self._sent.clear()
        if self._runner is not None:
            await self._runner.cleanup()
            self._runner = None

    async def _tick_loop(self) -> None:
        last = time.monotonic()
        while True:
            await asyncio.sleep(TICK_SECONDS)
            now = time.monotonic()
            self.printer.tick(now - last)
            last = now
            if self._runner is None and now >= self._unplugged_until:
                await self._listen()

    async def _push_loop(self) -> None:
        while True:
            await self._dirty.wait()
            self._dirty.clear()
            status = self.printer.status()
            for socket in list(self._sockets):
                patch = merge_patch_diff(self._sent.get(socket, {}), status)
                if not patch:
                    continue
                self._sent[socket] = status
                self._push_seq += 1
                with contextlib.suppress(Exception):
                    await socket.send_json({"t": "patch", "n": self._push_seq, "patch": patch})

    # 局域网接口

    def _guard(self, handler):
        async def guarded(request: web.Request) -> web.StreamResponse:
            code = self.printer.config.access_code
            if code and request.headers.get("X-Access-Code") != code:
                return web.json_response({"ok": False, "error": "Wrong access code."}, status=401)
            try:
                return await handler(request)
            except Refused as refusal:
                return web.json_response({"ok": False, "error": refusal.text}, status=refusal.status)
            except (json.JSONDecodeError, KeyError, TypeError, ValueError):
                return web.json_response({"ok": False, "error": "Malformed request."}, status=400)

        return guarded

    async def _info(self, request: web.Request) -> web.Response:
        return web.json_response(self.printer.info())

    async def _status(self, request: web.Request) -> web.Response:
        return web.json_response(self.printer.status())

    async def _history(self, request: web.Request) -> web.Response:
        return web.json_response(self.printer.history[-20:])

    async def _ws(self, request: web.Request) -> web.WebSocketResponse:
        socket = web.WebSocketResponse(heartbeat=10)
        await socket.prepare(request)
        await self._send_full(socket)
        self._sockets.add(socket)
        try:
            async for message in socket:
                if message.type == WSMsgType.TEXT:
                    with contextlib.suppress(json.JSONDecodeError):
                        if json.loads(message.data).get("cmd") == "push_all":
                            await self._send_full(socket)
        finally:
            self._sockets.discard(socket)
            self._sent.pop(socket, None)
        return socket

    async def _send_full(self, socket: web.WebSocketResponse) -> None:
        status = self.printer.status()
        self._sent[socket] = status
        self._push_seq += 1
        await socket.send_json({"t": "full", "n": self._push_seq, "status": status})

    async def _files(self, request: web.Request) -> web.Response:
        return web.json_response(sorted(self.printer.files.values(), key=lambda item: item["name"]))

    async def _upload(self, request: web.Request) -> web.Response:
        name = request.match_info["name"]
        if "/" in name or name.startswith("."):
            raise Refused("Bad file name.", 400)
        size = 0
        cut_after = (request.content_length or 2) // 2 if self.printer.cut_next_upload else None
        async for chunk in request.content.iter_chunked(64 * 1024):
            size += len(chunk)
            if cut_after is not None and size >= cut_after:
                # 传到一半连接断了：文件没存下来
                self.printer.cut_next_upload = False
                if request.transport is not None:
                    request.transport.abort()
                raise asyncio.CancelledError
        free = self.printer.status()["storage"]["internal"]["free"]
        if size > free:
            raise Refused("Not enough storage space.", 507)
        self.printer.store_file(name, size)
        return web.json_response({"ok": True, "name": name, "size": size})

    async def _delete(self, request: web.Request) -> web.Response:
        self.printer.delete_file(request.match_info["name"])
        return web.json_response({"ok": True})

    async def _print(self, request: web.Request) -> web.Response:
        body = await request.json()
        self.printer.start_print(
            file=str(body["file"]),
            task=str(body.get("task") or body["file"]),
            plate=int(body.get("plate", 1)),
            slots=list(body.get("slots", [])),
        )
        return web.json_response({"ok": True})

    async def _command(self, request: web.Request) -> web.Response:
        body = await request.json()
        command = body["cmd"]
        if command == "pause":
            self.printer.pause()
        elif command == "resume":
            self.printer.resume()
        elif command == "stop":
            self.printer.stop()
        elif command == "skip":
            self.printer.skip_objects([int(item) for item in body["objects"]])
        elif command == "light":
            self.printer.set_light(bool(body["on"]))
        elif command == "alert":
            self.printer.answer_alert(int(body["id"]), str(body["choice"]))
        else:
            raise Refused("Unknown command.", 400)
        return web.json_response({"ok": True})

    # 现场接口

    async def _operator(self, request: web.Request) -> web.Response:
        action = request.match_info["action"]
        body = await request.json() if request.can_read_body else {}
        try:
            await self.operate(action, **body)
        except Refused as refusal:
            return web.json_response({"ok": False, "error": refusal.text}, status=refusal.status)
        except (TypeError, AttributeError):
            return web.json_response({"ok": False, "error": f"Unknown operator action: {action}"}, status=400)
        return web.json_response({"ok": True})

    async def operate(self, action: str, **args: Any) -> None:
        """现场的人做一件事。测试里也直接调它。"""
        printer = self.printer
        if action == "unplug_network":
            await self.unplug_network(float(args.get("seconds", 10)))
        elif action == "power_cycle":
            printer.operator_power_cycle()
            await self.unplug_network(float(args.get("seconds", 5)))
        elif action == "fail_next_prepare":
            printer.fail_next_prepare = True
        elif action == "reject_next_print":
            printer.reject_next_print = str(args.get("text", "Print request rejected by firmware."))
        elif action == "cut_next_upload":
            printer.cut_next_upload = True
        elif action == "set_speed":
            printer.config.speed = float(args["speed"])
        elif action == "press_pause":
            printer.pause()
        elif action == "press_resume":
            printer.resume()
        elif action == "press_stop":
            printer.stop()
        else:
            getattr(printer, f"operator_{action}")(**args)

    async def unplug_network(self, seconds: float) -> None:
        self._unplugged_until = time.monotonic() + seconds
        await self._unlisten()

    async def plug_network(self) -> None:
        self._unplugged_until = 0.0
        if self._runner is None:
            await self._listen()


async def serve(configs: list[tuple[SimConfig, int]], host: str) -> None:
    servers = [SimPrinterServer(SimPrinter(config), host, port) for config, port in configs]
    for server in servers:
        await server.start()
        print(f"模拟打印机 {server.printer.config.serial} 在 http://{server.address}", flush=True)
    try:
        await asyncio.Event().wait()
    finally:
        for server in servers:
            await server.stop()
