"""daemon 和面板之间的控制通道协议。

消息结构在 `v1` 里，从 `packages/shared/schema/daemon/v1/` 的 JSON Schema 生成，
和面板那边用的是同一份。两边收到消息都先按它校验。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ValidationError

from . import v1
from ._manifest import MESSAGES, PROTOCOL_VERSION

__all__ = [
    "PROTOCOL_VERSION",
    "InvalidBody",
    "InvalidEnvelope",
    "ParsedMessage",
    "UnknownType",
    "needs_ack",
    "parse_message",
    "v1",
]


@dataclass(frozen=True)
class ParsedMessage:
    """一条已经校验过的消息。"""

    envelope: v1.Envelope
    body: BaseModel


class InvalidEnvelope(ValueError):
    """信封本身不对，连 id 都不可信。"""


class UnknownType(ValueError):
    """不认识的消息类型：回 ack 后忽略，不算错。"""

    def __init__(self, message_id: str, message_type: str) -> None:
        super().__init__(f"unknown message type: {message_type}")
        self.message_id = message_id
        self.message_type = message_type


class InvalidBody(ValueError):
    """消息体不合契约：回 ack 并记日志，不处理，免得一条坏消息卡住整个队列。"""

    def __init__(self, message_id: str, message_type: str, error: ValidationError) -> None:
        super().__init__(f"invalid body for {message_type}: {error.error_count()} error(s)")
        self.message_id = message_id
        self.message_type = message_type
        self.error = error


def parse_message(frame: Any) -> ParsedMessage:
    """校验控制通道上收到的一帧（已经从 JSON 解析出来的值）。"""
    try:
        envelope = v1.Envelope.model_validate(frame)
    except ValidationError as error:
        raise InvalidEnvelope(str(error)) from error
    message_id = str(envelope.id.root)
    entry = MESSAGES.get(envelope.type)
    if entry is None:
        raise UnknownType(message_id, envelope.type)
    model: type[BaseModel] = getattr(v1, entry[0])
    try:
        body = model.model_validate(envelope.body)
    except ValidationError as error:
        raise InvalidBody(message_id, envelope.type, error) from error
    return ParsedMessage(envelope=envelope, body=body)


def needs_ack(message_type: str) -> bool:
    """这种消息要不要对方回 ack。"""
    entry = MESSAGES.get(message_type)
    return entry[2] if entry else False
