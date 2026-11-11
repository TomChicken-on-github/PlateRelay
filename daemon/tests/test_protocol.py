"""协议一致性：面板那边校验用的同一组样例，这边生成的模型也要能解析。"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from platerelay_daemon.protocol import InvalidBody, InvalidEnvelope, UnknownType, needs_ack, parse_message, v1
from platerelay_daemon.protocol._manifest import MESSAGES

EXAMPLES = Path(__file__).resolve().parents[2] / "packages/shared/schema/daemon/v1/examples"


def load(name: str) -> dict:
    return json.loads((EXAMPLES / name).read_text(encoding="utf-8"))


@pytest.mark.parametrize("path", sorted(EXAMPLES.glob("*.json")), ids=lambda path: path.name)
def test_example_parses(path: Path) -> None:
    parsed = parse_message(json.loads(path.read_text(encoding="utf-8")))
    assert parsed.envelope.type in MESSAGES


def test_every_message_type_has_a_model() -> None:
    for title, _direction, _ack in MESSAGES.values():
        assert hasattr(v1, title), title


def test_event_is_parsed_into_its_own_kind() -> None:
    parsed = parse_message(load("printer.event.job.cancelled.json"))
    event = parsed.body.root
    assert isinstance(event, v1.JobCancelledEvent)
    assert event.data.beforeStart is True


def test_envelope_missing_fields_is_rejected() -> None:
    with pytest.raises(InvalidEnvelope):
        parse_message({"type": "ping", "body": {}})


def test_unknown_type_is_reported_separately() -> None:
    frame = load("ping.json") | {"type": "future.message"}
    with pytest.raises(UnknownType):
        parse_message(frame)


def test_job_event_requires_job_ref() -> None:
    frame = copy.deepcopy(load("printer.event.job.started.json"))
    del frame["body"]["jobRef"]
    with pytest.raises(InvalidBody):
        parse_message(frame)


def test_command_kind_outside_the_list_is_rejected() -> None:
    frame = copy.deepcopy(load("command.refresh.json"))
    frame["body"]["kind"] = "gcode.raw"
    with pytest.raises(InvalidBody):
        parse_message(frame)


def test_extra_fields_are_ignored() -> None:
    frame = copy.deepcopy(load("printer.snapshot.offline.json"))
    frame["body"]["addedInLaterVersion"] = 1
    parse_message(frame)


def test_ack_rules() -> None:
    assert needs_ack("printer.snapshot") is False
    assert needs_ack("printer.event") is True
    assert needs_ack("command") is True
