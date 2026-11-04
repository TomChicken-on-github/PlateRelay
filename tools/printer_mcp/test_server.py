"""不连真机的自测：uv run --project daemon --with "mcp>=1.2,<2" --with keyring --with pytest pytest tools/printer_mcp"""

import asyncio
import importlib.util
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location("printer_mcp_server", Path(__file__).with_name("server.py"))
srv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(srv)


def test_deep_merge_and_diff():
    before = {"print": {"gcode_state": "IDLE", "ams": {"ams": [{"id": "0", "tray": [{"id": "0", "state": 3}]}]}}}
    msgs = [
        (100.0, {"print": {"gcode_state": "RUNNING"}}),
        (101.0, {"print": {"ams": {"ams": [{"id": "0", "tray": [{"id": "0", "state": 11}]}]}}}),
    ]
    out = srv.diff_messages(before, msgs, None)
    assert any("print.gcode_state" in l and '"RUNNING"' in l for l in out)
    assert any("print.ams.ams[0].tray[0].state: 3 → 11" in l for l in out)
    only_ams = srv.diff_messages(before, msgs, "print.ams")
    assert len(only_ams) == 1


def test_get_path():
    obj = {"print": {"device": {"extruder": {"info": [{"temp": 1}, {"temp": 2}]}}}}
    assert srv.get_path(obj, "print.device.extruder.info[1].temp") == 2
    with pytest.raises(KeyError):
        srv.get_path(obj, "print.nope")


class FakeClient:
    def __init__(self):
        self.sent = []

    def publish(self, topic, payload):
        self.sent.append((topic, payload))


def make_conn():
    c = object.__new__(srv.PrinterConnection)
    c.serial, c._seq, c._last_pushall, c._client = "SN", 0, 0.0, FakeClient()
    return c


@pytest.mark.parametrize("msg", [
    {"print": {"command": "pause"}},
    {"print": {"command": "project_file", "url": "x"}},
    {"system": {"command": "ledctrl"}},
    {"pushing": {"command": "pushall"}, "print": {"command": "stop"}},
])
def test_send_blocks_control(msg):
    c = make_conn()
    with pytest.raises(PermissionError):
        c._send(msg)
    assert c._client.sent == []


def test_send_allows_readonly_and_throttles_pushall():
    c = make_conn()
    assert c._send({"pushing": {"command": "pushall"}})
    assert not c._send({"pushing": {"command": "pushall"}})
    assert c._send({"info": {"command": "get_version"}})
    assert len(c._client.sent) == 2


def test_tools_registered():
    tools = asyncio.run(srv.build_server().list_tools())
    assert {t.name for t in tools} == {"printers", "status", "raw_report", "record", "version", "ftp_list"}
