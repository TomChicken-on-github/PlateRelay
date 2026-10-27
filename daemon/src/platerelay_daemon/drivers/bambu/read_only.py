"""只读保护：pybambu 里有大量控制命令，PlateRelay 默认一条都不放行。

- MQTT：只放行 pybambu 连接时自动发的三条只读请求（pushall、pushing start、get_version）。
- FTPS：拦下所有写操作命令（上传、删除、建目录、改名等），只允许列目录和下载。

用户在当次任务里明确同意之后，才能用 allow_control=True 放开（见 CLAUDE.md 硬约束）。
"""

from __future__ import annotations

import logging

from platerelay_daemon.driver_api import ControlNotAllowedError

from ._vendor.pybambu.bambu_client import BambuClient, ImplicitFTP_TLS

LOGGER = logging.getLogger(__name__)

READ_ONLY_MQTT_REQUESTS = {
    ("pushing", "pushall"),
    ("pushing", "start"),
    ("info", "get_version"),
}

FTP_WRITE_VERBS = {
    "STOR", "STOU", "APPE", "DELE", "RMD", "XRMD", "MKD", "XMKD",
    "RNFR", "RNTO", "SITE", "MFMT", "MFCT", "MFF",
}


def is_read_only_request(msg: object) -> bool:
    if not isinstance(msg, dict) or len(msg) != 1:
        return False
    ((section, body),) = msg.items()
    return isinstance(body, dict) and (section, body.get("command")) in READ_ONLY_MQTT_REQUESTS


class ReadOnlyFTP(ImplicitFTP_TLS):
    def putcmd(self, line: str) -> None:
        verb = line.split(" ", 1)[0].upper()
        if verb in FTP_WRITE_VERBS:
            raise ControlNotAllowedError(f"只读模式下不允许 FTPS 写操作：{verb}")
        super().putcmd(line)


class ReadOnlyBambuClient(BambuClient):
    """pybambu 的 BambuClient，加上 MQTT 和 FTPS 的只读拦截。"""

    allow_control: bool = False

    def publish(self, msg):
        if not self.allow_control and not is_read_only_request(msg):
            # 不抛异常：pybambu 内部有些地方在后台线程里调 publish，抛出去没人接。
            LOGGER.warning("只读模式，已拦下 MQTT 请求：%s", _describe(msg))
            return False
        return super().publish(msg)

    def ftp_connection(self) -> ImplicitFTP_TLS:
        cls = ImplicitFTP_TLS if self.allow_control else ReadOnlyFTP
        ftp = cls(context=self.local_tls_context)
        ftp.connect(host=self._device.info.ip_address, port=990, timeout=15)
        ftp.login(user="bblp", passwd=self._access_code)
        ftp.prot_p()
        return ftp


def _describe(msg: object) -> str:
    # 只记录命令名，不记录整条消息，免得把参数原样写进日志。
    if isinstance(msg, dict):
        return ", ".join(
            f"{section}.{body.get('command') if isinstance(body, dict) else '?'}"
            for section, body in msg.items()
        )
    return type(msg).__name__
