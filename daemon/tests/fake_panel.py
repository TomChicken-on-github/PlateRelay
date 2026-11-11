"""假面板：按契约收发消息，daemon 的集成测试对着它跑。

它真的校验挑战签名、真的按契约解析每一条消息，但没有任何业务：只把收到的东西记下来，
测试自己决定发什么命令。
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from aiohttp import WSMsgType, web
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

from platerelay_daemon.link import new_id
from platerelay_daemon.protocol import needs_ack, parse_message

ENROLL_TOKEN = "test-enroll-token"


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class FakePanel:
    def __init__(self) -> None:
        self.daemons: dict[str, bytes] = {}  # daemonId -> 公钥 DER
        self.printers: list[dict[str, Any]] = []
        self.files: dict[str, bytes] = {}
        self.received: list[tuple[str, dict[str, Any]]] = []
        self.acking = True
        self.download_failures = 0
        self.connections = 0
        self._socket: web.WebSocketResponse | None = None
        self._arrived = asyncio.Condition()
        self._seen_ids: list[str] = []
        self._runner: web.AppRunner | None = None
        self.port = 0

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    async def start(self) -> None:
        app = web.Application()
        app.add_routes([
            web.post("/daemon/v1/enroll", self._enroll),
            web.get("/daemon/v1/ws", self._ws),
            web.get("/daemon/v1/files/{file_id}", self._file),
        ])
        self._runner = web.AppRunner(app)
        await self._runner.setup()
        site = web.TCPSite(self._runner, "127.0.0.1", self.port)
        await site.start()
        self.port = site._server.sockets[0].getsockname()[1]

    async def stop(self) -> None:
        if self._socket is not None:
            await self._socket.close()
        if self._runner is not None:
            await self._runner.cleanup()

    # 测试用的操作

    def add_printer(self, host: str, serial: str, **extra: Any) -> str:
        printer_id = str(uuid.uuid4())
        self.printers.append({
            "printerId": printer_id, "brand": "sim", "serial": serial, "host": host,
            "accessCodeCipher": "unused", "keyFingerprint": "unused",
            "currentJobRef": None, "cleanupJobRefs": [], **extra,
        })
        return printer_id

    def add_file(self, content: bytes) -> dict[str, Any]:
        file_id = str(uuid.uuid4())
        self.files[file_id] = content
        return {"fileId": file_id, "sha256": hashlib.sha256(content).hexdigest(), "sizeBytes": len(content)}

    async def send(self, message_type: str, body: dict[str, Any]) -> str:
        assert self._socket is not None, "daemon 还没连上"
        message_id = new_id()
        await self._socket.send_json({"id": message_id, "type": message_type, "ts": now(), "body": body})
        return message_id

    async def command(self, printer_id: str, kind: str, params: dict[str, Any], *, expires_in: float = 60) -> str:
        command_id = new_id()
        expires = (datetime.now(UTC) + timedelta(seconds=expires_in)).isoformat().replace("+00:00", "Z")
        await self.send("command", {"commandId": command_id, "printerId": printer_id, "kind": kind, "expiresAt": expires, "params": params})
        return command_id

    async def start_job(self, printer_id: str, file: dict[str, Any], *, expected_run_seq: int, job_ref: str | None = None) -> tuple[str, str]:
        job_ref = job_ref or new_id()
        command_id = await self.command(printer_id, "job.start", {
            "jobRef": job_ref, "expectedRunSeq": expected_run_seq, "file": file, "plateIndex": 1,
            "bedType": "textured_pei", "mapping": [{"sliceSlot": 0, "extruder": 1, "unit": 0, "slot": 0}], "timelapse": False,
        })
        return job_ref, command_id

    async def drop_connection(self) -> None:
        if self._socket is not None:
            await self._socket.close()

    def events(self, kind: str | None = None) -> list[dict[str, Any]]:
        return [body for message_type, body in self.received if message_type == "printer.event" and (kind is None or body["kind"] == kind)]

    def results(self, command_id: str) -> list[dict[str, Any]]:
        return [body for message_type, body in self.received if message_type == "command.result" and body["commandId"] == command_id]

    def last_snapshot(self, printer_id: str) -> dict[str, Any] | None:
        for message_type, body in reversed(self.received):
            if message_type == "printer.snapshot" and body["printerId"] == printer_id:
                return body
        return None

    async def wait_for(self, predicate, timeout: float = 10.0):
        async with self._arrived:
            return await asyncio.wait_for(self._arrived.wait_for(predicate), timeout)

    async def wait_event(self, kind: str, timeout: float = 10.0, **match: Any) -> dict[str, Any]:
        def find():
            for body in self.events(kind):
                if all(body.get(key) == value for key, value in match.items()):
                    return body
            return None

        return await self.wait_for(find, timeout)

    async def wait_result(self, command_id: str, status: str, timeout: float = 10.0) -> dict[str, Any]:
        return await self.wait_for(lambda: next((item for item in self.results(command_id) if item["status"] == status), None), timeout)

    async def wait_snapshot(self, printer_id: str, predicate, timeout: float = 10.0) -> dict[str, Any]:
        """等到收到过一份满足条件的快照（不一定是最新的一份）。"""

        def find():
            for message_type, body in reversed(self.received):
                if message_type == "printer.snapshot" and body["printerId"] == printer_id and predicate(body):
                    return body
            return None

        return await self.wait_for(find, timeout)

    # 接口

    async def _enroll(self, request: web.Request) -> web.Response:
        body = await request.json()
        if body["token"] != ENROLL_TOKEN:
            return web.json_response({"title": "invalid token"}, status=401)
        daemon_id = str(uuid.uuid4())
        self.daemons[daemon_id] = base64.b64decode(body["publicKey"])
        return web.json_response({"daemonId": daemon_id}, status=201)

    async def _file(self, request: web.Request) -> web.Response:
        if request.headers.get("Authorization") != "Bearer test-http-token":
            return web.Response(status=401)
        if self.download_failures > 0:
            self.download_failures -= 1
            return web.Response(status=503)
        content = self.files.get(request.match_info["file_id"])
        if content is None or "jobRef" not in request.query:
            return web.Response(status=404)
        return web.Response(body=content)

    async def _ws(self, request: web.Request) -> web.WebSocketResponse:
        socket = web.WebSocketResponse()
        await socket.prepare(request)
        hello = parse_message(json.loads((await socket.receive()).data)).body
        daemon_id = str(hello.daemonId.root)
        nonce = base64.b64encode(os.urandom(32)).decode()
        await socket.send_json({"id": new_id(), "type": "challenge", "ts": now(), "body": {"nonce": nonce, "serverTime": now()}})
        auth = parse_message(json.loads((await socket.receive()).data)).body
        public_key = serialization.load_der_public_key(self.daemons[daemon_id])
        signed = f"platerelay-daemon-auth/v1\n{daemon_id}\n{nonce}\n{self.url}".encode()
        try:
            public_key.verify(base64.b64decode(auth.signature), signed, padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=32), hashes.SHA256())
        except Exception:
            await socket.close(code=4401)
            return socket
        self.connections += 1
        await socket.send_json({"id": new_id(), "type": "welcome", "ts": now(), "body": {
            "sessionId": str(uuid.uuid4()), "protocolVersion": "1.0", "serverTime": now(), "heartbeatSeconds": 15,
            "httpToken": "test-http-token", "httpTokenExpiresAt": now(), "printers": self.printers,
            "config": {
                "snapshot": {"watchedSeconds": 5, "unwatchedSeconds": 60, "staggerSeconds": 1, "uploadKbps": 512},
                "transferTimeoutSeconds": 20, "downloadConcurrency": 2, "discoveryEnabled": False,
            },
        }})
        self._socket = socket
        async for message in socket:
            if message.type != WSMsgType.TEXT:
                continue
            frame = json.loads(message.data)
            parsed = parse_message(frame)  # 不合契约直接让测试失败
            message_type = parsed.envelope.type
            if message_type == "ping":
                await socket.send_json({"id": new_id(), "type": "pong", "ts": now(), "body": {}})
                continue
            if message_type in ("ack", "pong"):
                continue
            if needs_ack(message_type):
                if not self.acking:
                    continue
                await socket.send_json({"id": new_id(), "type": "ack", "ts": now(), "body": {"id": frame["id"]}})
                if any(seen_id == frame["id"] for seen_id in self._seen_ids):
                    continue
                self._seen_ids.append(frame["id"])
            async with self._arrived:
                self.received.append((message_type, frame["body"]))
                self._arrived.notify_all()
        if self._socket is socket:
            self._socket = None
        return socket

