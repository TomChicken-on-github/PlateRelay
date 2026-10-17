import asyncio
import time
from typing import Dict, Any
from daemon.hal.base import BasePrinterDriver
from daemon.config import PrinterConfig

class BambuPassiveDriver(BasePrinterDriver):
    """Passive holder & read-only listener for real Bambu machines (e.g. Bambu X2D).
    STRICT SAFETY: Zero downward write/print commands.
    """

    def __init__(self, config: PrinterConfig):
        self.config = config
        self.state = "OFFLINE"
        self.status_message = "局域网待配对：请在机床触屏开启局域网模式并配置 Access Code"
        self._running = False

    async def start(self) -> None:
        self._running = True
        # In Milestone 1, since the machine does not have LAN mode enabled,
        # it maintains passive safe standby and reports OFFLINE.

    async def stop(self) -> None:
        self._running = False

    def get_telemetry(self) -> Dict[str, Any]:
        return {
            "id": self.config.id,
            "name": self.config.name,
            "model": self.config.model,
            "serial_number": self.config.serial_number,
            "ip_address": self.config.ip_address,
            "state": self.state,
            "temperatures": {
                "nozzle": 0.0,
                "nozzle_target": 0.0,
                "bed": 0.0,
                "bed_target": 0.0,
                "chamber": 0.0
            },
            "progress": 0.0,
            "remaining_time_min": 0,
            "current_layer": 0,
            "total_layers": 0,
            "ams_trays": [
                {
                    "id": 0,
                    "tray_id_name": "待同步",
                    "tray_sub_brands": "Bambu Lab",
                    "tray_color": "808080",
                    "tray_type": "UNKNOWN",
                    "remain_percent": 0,
                    "is_active": False
                }
            ],
            "status_message": self.status_message,
            "task_name": "",
            "wifi_signal": 0,
            "updated_at": time.time()
        }
