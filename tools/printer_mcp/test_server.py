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


NOTIFY = (
    "NOTIFY * HTTP/1.1\r\nHOST: 239.255.255.250:1990\r\nServer: UPnP/1.0\r\nLocation: 192.168.0.103\r\n"
    "NT: urn:bambulab-com:device:3dprinter:1\r\nUSN: 20P6BJTEST0001\r\nDevModel.bambu.com: N6\r\n"
    "DevName.bambu.com: My X2D\r\nDevConnect.bambu.com: lan\r\n\r\n"
).encode()


def test_parse_ssdp():
    info = srv.parse_ssdp(NOTIFY, "10.0.0.9")
    assert info == {"serial": "20P6BJTEST0001", "host": "192.168.0.103", "model": "N6", "name": "My X2D", "connect": "lan"}
    assert srv.parse_ssdp(b"NOTIFY * HTTP/1.1\r\nNT: upnp:rootdevice\r\nUSN: x\r\n", "1.2.3.4") is None
    assert srv._slug("My X2D", "x") == "my-x2d"


def test_discover_loopback():
    import socket
    import threading
    import time

    def send():
        time.sleep(0.3)
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.sendto(NOTIFY, ("127.0.0.1", 2021))

    threading.Thread(target=send).start()
    found = srv.discover(1.0)
    assert [p["serial"] for p in found] == ["20P6BJTEST0001"]
