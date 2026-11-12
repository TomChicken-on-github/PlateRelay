"""和面板的控制通道：永远是 daemon 主动连出去。

负责：握手和挑战认证、心跳、断线后退避重连、和面板的时钟差、发件箱（没被确认的消息落盘，
重连后按原顺序重发）、收到的消息先按契约校验再交给上层。
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import random
import uuid
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import urlsplit

import aiohttp
from pydantic import BaseModel

from platerelay_daemon.protocol import (
    PROTOCOL_VERSION,
    InvalidBody,
    InvalidEnvelope,
    UnknownType,
    needs_ack,
    parse_message,
    v1,
)
from platerelay_daemon.store import OutboxMessage, Store

from .keys import DaemonKeys

LOGGER = logging.getLogger(__name__)

CLOSE_BAD_SIGNATURE = 4401
CLOSE_REVOKED = 4403
CLOSE_REPLACED = 4409
CLOSE_UPGRADE_REQUIRED = 4426
HANDSHAKE_TIMEOUT = 30
RECONNECT_MAX_SECONDS = 60
REMEMBERED_IDS = 5000


def new_id() -> str:
    """UUIDv7：前 48 位是毫秒时间戳，其余随机。"""
    millis = int(datetime.now(UTC).timestamp() * 1000)
    value = (millis << 80) | (0x7 << 76) | (random.getrandbits(12) << 64) | (0b10 << 62) | random.getrandbits(62)
    return str(uuid.UUID(int=value))


def origin_of(panel_url: str) -> str:
    parts = urlsplit(panel_url)
    return f"{parts.scheme}://{parts.netloc}"


def check_panel_url(panel_url: str, allow_insecure_localhost: bool) -> None:
    parts = urlsplit(panel_url)
    if parts.scheme == "https":
        return
    if parts.scheme == "http" and allow_insecure_localhost and parts.hostname in ("localhost", "127.0.0.1", "::1"):
        return
    raise ValueError("面板地址必须是 https；明文只允许开发时连本机")


class LinkHandler(Protocol):
    async def on_welcome(self, welcome: v1.Welcome) -> None: ...
    async def on_message(self, message_type: str, body: BaseModel) -> None: ...
    async def on_disconnected(self) -> None: ...


class PanelLink:
    def __init__(
        self,
        *,
        panel_url: str,
        daemon_id: str,
        keys: DaemonKeys,
        store: Store,
        hello: Callable[[], dict[str, Any]],
        allow_insecure_localhost: bool = False,
    ) -> None:
        check_panel_url(panel_url, allow_insecure_localhost)
        self.panel_url = panel_url.rstrip("/")
        self.daemon_id = daemon_id
        self._keys = keys
        self._store = store
        self._hello = hello
        self.handler: LinkHandler | None = None
        self._http: aiohttp.ClientSession | None = None
        self._socket: aiohttp.ClientWebSocketResponse | None = None
        self._ready = False
        self._clock_offset = timedelta(0)
        self._http_token: str | None = None
        self._seen: OrderedDict[str, None] = OrderedDict()
        self._stopped = False
        self.connected = asyncio.Event()

    # 时间：命令过不过期按面板的钟算

    def panel_now(self) -> datetime:
        return datetime.now(UTC) + self._clock_offset

    # 发送

    def send(self, message_type: str, body: dict[str, Any]) -> str:
        """发一条消息。要确认的先落盘进发件箱，连着就马上发；不要确认的没连上就丢掉。"""
        message = OutboxMessage(id=new_id(), type=message_type, ts=_timestamp(), body=body)
        if needs_ack(message_type):
            self._store.outbox_add(message)
        self._write(message.frame())
        return message.id

    def prepare(self, message_type: str, body: dict[str, Any]) -> OutboxMessage:
        """只生成消息、不发：调用方要把它和别的记录放进同一个事务，之后再 deliver。"""
        return OutboxMessage(id=new_id(), type=message_type, ts=_timestamp(), body=body)

    def deliver(self, message: OutboxMessage) -> None:
        self._write(message.frame())

    def _write(self, frame: dict[str, Any]) -> None:
        socket = self._socket
        if socket is None or not self._ready or socket.closed:
            return
        task = asyncio.ensure_future(socket.send_str(json.dumps(frame)))
        task.add_done_callback(lambda done: done.exception() if not done.cancelled() else None)

    # 连接循环

    async def run(self) -> None:
        delay = 1.0
        async with aiohttp.ClientSession() as http:
            self._http = http
            while not self._stopped:
                try:
                    close_code = await self._session(http)
                except (aiohttp.ClientError, TimeoutError, OSError) as error:
                    LOGGER.warning("连不上面板：%s", type(error).__name__)
                    close_code = None
                finally:
                    was_ready = self._ready
                    self._ready, self._socket = False, None
                    self.connected.clear()
                    if was_ready and self.handler is not None:
                        await self.handler.on_disconnected()
                if close_code == CLOSE_REVOKED:
                    LOGGER.error("这个 daemon 已被面板吊销，不再重连")
                    return
                if close_code == CLOSE_UPGRADE_REQUIRED:
                    LOGGER.error("协议版本太老，升级后再启动")
                    return
                if was_ready:
                    delay = 1.0
                await asyncio.sleep(delay * random.uniform(0.8, 1.2))
                delay = min(delay * 2, RECONNECT_MAX_SECONDS)

    def stop(self) -> None:
        self._stopped = True
        if self._socket is not None:
            asyncio.ensure_future(self._socket.close())

    async def _session(self, http: aiohttp.ClientSession) -> int | None:
        url = self.panel_url.replace("http", "ws", 1) + "/daemon/v1/ws"
        async with http.ws_connect(url, heartbeat=None, max_msg_size=8 * 1024 * 1024) as socket:
            self._socket = socket
            await socket.send_str(json.dumps(_frame("hello", self._hello())))
            challenge = await self._expect(socket, v1.Challenge)
            if challenge is None:
                return socket.close_code
            signature = self._keys.sign_challenge(self.daemon_id, challenge.nonce, origin_of(self.panel_url))
            await socket.send_str(json.dumps(_frame("auth", {"signature": signature})))
            welcome = await self._expect(socket, v1.Welcome)
            if welcome is None:
                return socket.close_code
            if welcome.serverTime is not None:
                self._clock_offset = welcome.serverTime.root - datetime.now(UTC)
            self._http_token = welcome.httpToken
            self._ready = True
            LOGGER.info("已连上面板，会话 %s", welcome.sessionId.root)
            # 先让每台打印机报一份快照给面板对账，再补发断线期间攒下的消息
            if self.handler is not None:
                await self.handler.on_welcome(welcome)
            dropped = self._store.outbox_trim()
            if dropped:
                LOGGER.warning("发件箱太旧或太满，丢掉了最老的 %d 条", dropped)
            for message in self._store.outbox_pending():
                await socket.send_str(json.dumps(message.frame()))
            self.connected.set()
            heartbeat = asyncio.create_task(self._heartbeat(socket, welcome.heartbeatSeconds))
            try:
                await self._read(socket, welcome.heartbeatSeconds)
            finally:
                heartbeat.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await heartbeat
            return socket.close_code

    async def _expect(self, socket: aiohttp.ClientWebSocketResponse, model: type[BaseModel]) -> Any:
        while True:
            message = await socket.receive(timeout=HANDSHAKE_TIMEOUT)
            if message.type != aiohttp.WSMsgType.TEXT:
                return None
            try:
                parsed = parse_message(json.loads(message.data))
            except (ValueError, InvalidEnvelope, UnknownType, InvalidBody):
                continue
            if isinstance(parsed.body, v1.UpgradeRequired):
                # 只记下来给人看，daemon 不自动升级
                LOGGER.error("面板要求升级 daemon：%s", parsed.body.upgradeCommand)
                continue
            if isinstance(parsed.body, model):
                return parsed.body

    async def _heartbeat(self, socket: aiohttp.ClientWebSocketResponse, seconds: int) -> None:
        while True:
            await asyncio.sleep(seconds)
            await socket.send_str(json.dumps(_frame("ping", {})))

    async def _read(self, socket: aiohttp.ClientWebSocketResponse, heartbeat_seconds: int) -> None:
        while True:
            try:
                # 三个心跳周期什么都没收到，就当连接已经断了
                message = await socket.receive(timeout=heartbeat_seconds * 3)
            except TimeoutError:
                LOGGER.warning("面板没有响应，断开重连")
                await socket.close()
                return
            if message.type != aiohttp.WSMsgType.TEXT:
                return
            try:
                await self._on_frame(socket, json.loads(message.data))
            except json.JSONDecodeError:
                LOGGER.warning("收到不是 JSON 的帧，已忽略")

    async def _on_frame(self, socket: aiohttp.ClientWebSocketResponse, frame: Any) -> None:
        try:
            parsed = parse_message(frame)
        except InvalidEnvelope:
            LOGGER.warning("收到信封不对的消息，已忽略")
            return
        except UnknownType as error:
            # 不认识的消息类型：确认后忽略，新版面板不会被老 daemon 卡住
            await self._ack(socket, error.message_id)
            return
        except InvalidBody as error:
            LOGGER.warning("消息 %s（%s）不合契约，确认后不处理", error.message_id, error.message_type)
            await self._ack(socket, error.message_id)
            return
        message_type = parsed.envelope.type
        message_id = str(parsed.envelope.id.root)
        if isinstance(parsed.body, v1.Ack):
            self._store.outbox_ack(str(parsed.body.id.root))
            return
        if message_type == "ping":
            await socket.send_str(json.dumps(_frame("pong", {})))
            return
        if message_type == "pong":
            return
        if isinstance(parsed.body, v1.TokenRenew):
            self._http_token = parsed.body.httpToken
        elif message_id in self._seen:
            pass  # 重复投递：只确认，不再处理
        elif self.handler is not None:
            await self.handler.on_message(message_type, parsed.body)
        if needs_ack(message_type):
            self._seen[message_id] = None
            while len(self._seen) > REMEMBERED_IDS:
                self._seen.popitem(last=False)
            await self._ack(socket, message_id)

    async def _ack(self, socket: aiohttp.ClientWebSocketResponse, message_id: str) -> None:
        await socket.send_str(json.dumps(_frame("ack", {"id": message_id})))

    # 大文件不走控制通道

    async def download(self, file_id: str, job_ref: str, destination: Path, timeout_seconds: float) -> None:
        if self._http is None or self._http_token is None:
            raise ConnectionError("not connected to panel")
        url = f"{self.panel_url}/daemon/v1/files/{file_id}"
        headers = {"Authorization": f"Bearer {self._http_token}"}
        timeout = aiohttp.ClientTimeout(total=timeout_seconds)
        async with self._http.get(url, params={"jobRef": job_ref}, headers=headers, timeout=timeout) as response:
            response.raise_for_status()
            with destination.open("wb") as handle:
                async for chunk in response.content.iter_chunked(256 * 1024):
                    handle.write(chunk)


def _timestamp() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _frame(message_type: str, body: dict[str, Any]) -> dict[str, Any]:
    return {"id": new_id(), "type": message_type, "ts": _timestamp(), "body": body}


async def enroll(panel_url: str, token: str, keys: DaemonKeys, *, name: str, platform: str, daemon_version: str) -> str:
    """用一次性令牌注册，换回 daemonId。令牌用完就作废，不写进配置或日志。"""
    request = v1.EnrollRequest(
        token=token,
        publicKey=keys.public_key_base64(),
        name=name,
        platform=platform,
        daemonVersion=daemon_version,
        protocolVersion=PROTOCOL_VERSION,
    )
    async with aiohttp.ClientSession() as http:
        async with http.post(f"{panel_url.rstrip('/')}/daemon/v1/enroll", json=request.model_dump(mode="json")) as response:
            if response.status >= 400:
                raise RuntimeError(f"注册失败（HTTP {response.status}）：{(await response.text())[:200]}")
            return str(v1.EnrollResponse.model_validate(await response.json()).daemonId.root)


Sender = Callable[[str, dict[str, Any]], Awaitable[None]]
