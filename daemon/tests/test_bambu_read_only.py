import pytest

from platerelay_daemon.driver_api import ControlNotAllowedError
from platerelay_daemon.drivers.bambu._vendor.pybambu.commands import (
    GET_VERSION,
    PAUSE,
    PRINT_PROJECT_FILE_TEMPLATE,
    PUSH_ALL,
    START_PUSH,
    STOP,
)
from platerelay_daemon.drivers.bambu.read_only import (
    ReadOnlyBambuClient,
    ReadOnlyFTP,
    is_read_only_request,
)


def test_only_read_requests_pass():
    assert is_read_only_request(PUSH_ALL)
    assert is_read_only_request(START_PUSH)
    assert is_read_only_request(GET_VERSION)
    for msg in (PAUSE, STOP, PRINT_PROJECT_FILE_TEMPLATE, {"system": {"command": "ledctrl"}}):
        assert not is_read_only_request(msg)
    assert not is_read_only_request({**PUSH_ALL, **STOP})


class FakeMqtt:
    def __init__(self):
        self.sent = []

    def publish(self, topic, payload):
        self.sent.append(payload)

        class Result:
            rc = 0

        return Result()


def make_client(tmp_path):
    client = ReadOnlyBambuClient({
        "host": "192.0.2.1",
        "serial": "TEST",
        "access_code": "",
        "device_type": "X2D",
        "local_mqtt": True,
        "file_cache_path": str(tmp_path),
    })
    client.client = FakeMqtt()
    return client


def test_client_blocks_control_commands(tmp_path):
    client = make_client(tmp_path)
    assert client.publish(PUSH_ALL) is True
    assert client.publish(STOP) is False
    assert client.publish(PAUSE) is False
    assert len(client.client.sent) == 1


def test_pybambu_control_helpers_are_blocked(tmp_path):
    client = make_client(tmp_path)
    device = client.get_device()
    device.lights.TurnChamberLightOn()
    device.speed.SetSpeed("ludicrous")
    assert client.client.sent == []


@pytest.mark.parametrize("line", ["STOR a.3mf", "DELE a.3mf", "MKD x", "RNFR a", "stor a"])
def test_ftp_write_commands_are_blocked(line):
    ftp = ReadOnlyFTP()
    with pytest.raises(ControlNotAllowedError):
        ftp.putcmd(line)
