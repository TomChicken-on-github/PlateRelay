"""不连真机的自测：uv run --project daemon --with "mcp>=1.2,<2" --with keyring --with pytest pytest tools/printer_mcp"""

import asyncio
import importlib.util
import json
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
    import threading

    c = object.__new__(srv.PrinterConnection)
    c.serial, c._seq, c._last_pushall, c._client = "SN", 0, 0.0, FakeClient()
    c.name, c.host, c._lock = "x2d", "192.0.2.1", threading.Lock()
    c.state = {"print": {"gcode_state": "RUNNING"}}
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
    assert {t.name for t in tools} == {"printers", "status", "raw_report", "record", "version", "ftp_list", "control"}
    control = next(t for t in tools if t.name == "control")
    # ctx 是注入的，不能出现在给 Claude 的参数里
    assert set(control.inputSchema["properties"]) == {"command", "printer"}


# ---------- 控制 ----------

def test_send_control_whitelist_only():
    c = make_conn()
    for bad in ("project_file", "gcode_line", '{"print": {"command": "stop"}}', ""):
        with pytest.raises(PermissionError):
            c._send_control(bad)
    assert c._client.sent == []
    c._send_control("pause")
    ((topic, payload),) = c._client.sent
    assert topic == "device/SN/request"
    assert json.loads(payload) == {"print": {"command": "pause", "sequence_id": "1"}}
    # 白名单里的原始模板不能被改动
    assert srv.CONTROL_COMMANDS["pause"][1]["print"]["sequence_id"] == "0"


def test_readonly_send_still_blocks_whitelisted_control():
    c = make_conn()
    for _, msg in srv.CONTROL_COMMANDS.values():
        with pytest.raises(PermissionError):
            c._send(msg)
    assert c._client.sent == []


class Answer:
    def __init__(self, action, confirm=None):
        self.action = action
        self.data = None if confirm is None else type("D", (), {"confirm": confirm})()


def run_confirm(command, elicit):
    c = make_conn()
    prompts = []

    async def wrapped(msg):
        prompts.append(msg)
        return await elicit(msg)

    out = asyncio.run(srv.confirm_and_send(c, command, wrapped))
    return c, out, prompts


def answer(a):
    async def elicit(msg):
        return a
    return elicit


def test_confirm_accept_sends_exactly_one():
    c, out, prompts = run_confirm("stop", answer(Answer("accept", True)))
    assert len(c._client.sent) == 1 and "已发送" in out
    assert "x2d" in prompts[0] and "192.0.2.1" in prompts[0] and "RUNNING" in prompts[0] and "stop" in prompts[0]


@pytest.mark.parametrize("res", [
    Answer("accept", False),
    Answer("accept"),
    Answer("decline"),
    Answer("cancel"),
    None,
])
def test_confirm_not_given_sends_nothing(res):
    c, out, _ = run_confirm("pause", answer(res))
    assert c._client.sent == [] and "未发送" in out


@pytest.mark.parametrize("exc", [RuntimeError("Method not found"), NotImplementedError(), ConnectionError()])
def test_elicit_unsupported_sends_nothing(exc):
    async def elicit(msg):
        raise exc
    c, out, _ = run_confirm("pause", elicit)
    assert c._client.sent == [] and "未发送" in out


def test_elicit_timeout_sends_nothing(monkeypatch):
    monkeypatch.setattr(srv, "CONFIRM_TIMEOUT", 0.05)

    async def elicit(msg):
        await asyncio.sleep(10)
    c, out, _ = run_confirm("pause", elicit)
    assert c._client.sent == [] and "未发送" in out


@pytest.mark.parametrize("client_answer, sent", [
    ("no-callback", 0),  # 客户端不支持 elicitation
    ("decline", 0),
    ("accept-unchecked", 0),
    ("accept", 1),
])
def test_control_tool_end_to_end(monkeypatch, client_answer, sent):
    from mcp import types
    from mcp.shared.memory import create_connected_server_and_client_session

    c = make_conn()
    monkeypatch.setattr(srv, "conn", lambda printer: c)

    async def on_elicit(context, params):
        if client_answer == "decline":
            return types.ElicitResult(action="decline")
        return types.ElicitResult(action="accept", content={"confirm": client_answer == "accept"})

    async def go():
        server = srv.build_server()._mcp_server
        cb = None if client_answer == "no-callback" else on_elicit
        async with create_connected_server_and_client_session(server, elicitation_callback=cb) as s:
            return await s.call_tool("control", {"command": "light_on"})

    res = asyncio.run(go())
    assert len(c._client.sent) == sent, res.content[0].text


def test_unknown_command_never_asks():
    c, out, prompts = run_confirm("project_file", answer(Answer("accept", True)))
    assert c._client.sent == [] and prompts == [] and "白名单" in out


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

    # 用随机空闲端口，不碰真实的 1990/2021，免得和用户正在跑的扫描互相串包
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]

    def send():
        time.sleep(0.3)
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.sendto(NOTIFY, ("127.0.0.1", port))

    threading.Thread(target=send).start()
    found = srv.discover(1.0, ports=(port,))
    assert [p["serial"] for p in found] == ["20P6BJTEST0001"]
