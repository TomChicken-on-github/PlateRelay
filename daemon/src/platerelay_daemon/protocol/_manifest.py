# 自动生成，不要手改。来源在 packages/shared/schema/daemon/v1/messages.json，用 daemon/scripts/generate_protocol.sh 重新生成。

PROTOCOL_VERSION = "1.0"

# 消息类型 -> (消息体的模型名, 方向, 要不要确认)
MESSAGES: dict[str, tuple[str, str, bool]] = {
    "hello": ("Hello", "daemon-to-panel", False),
    "challenge": ("Challenge", "panel-to-daemon", False),
    "auth": ("Auth", "daemon-to-panel", False),
    "welcome": ("Welcome", "panel-to-daemon", False),
    "ack": ("Ack", "both", False),
    "ping": ("Ping", "both", False),
    "pong": ("Pong", "both", False),
    "printer.snapshot": ("PrinterSnapshot", "daemon-to-panel", False),
    "printer.event": ("PrinterEvent", "daemon-to-panel", True),
    "command.result": ("CommandResult", "daemon-to-panel", True),
    "discovery.report": ("DiscoveryReport", "daemon-to-panel", True),
    "printers.assign": ("PrintersAssign", "panel-to-daemon", True),
    "command": ("Command", "panel-to-daemon", True),
    "config.update": ("ConfigUpdate", "panel-to-daemon", True),
    "token.renew": ("TokenRenew", "panel-to-daemon", True),
    "upgrade_required": ("UpgradeRequired", "panel-to-daemon", False),
}
