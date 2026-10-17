import asyncio
import random
import time
from typing import Dict, Any, List
from daemon.hal.base import BasePrinterDriver
from daemon.config import PrinterConfig

class BambuSimulatorDriver(BasePrinterDriver):
    """High-fidelity simulator emulating Bambu Lab 3D printer telemetry."""

    def __init__(self, config: PrinterConfig):
        self.config = config
        self.state = config.initial_state
        self.progress = config.initial_progress
        self.task_name = config.task_name
        self.total_layers = config.total_layers
        self.current_layer = int((self.progress / 100.0) * self.total_layers) if self.total_layers > 0 else 0
        
        # Temperature states
        if self.state == "PRINTING":
            self.nozzle_target = 220.0
            self.nozzle_actual = 220.0
            self.bed_target = 60.0
            self.bed_actual = 60.0
            self.chamber = 38.0
        else:
            self.nozzle_target = 0.0
            self.nozzle_actual = 28.0
            self.bed_target = 0.0
            self.bed_actual = 26.0
            self.chamber = 27.0

        # AMS Trays (Standard Bambu 4-slot setup)
        self.ams_trays: List[Dict[str, Any]] = [
            {
                "id": 0,
                "tray_id_name": "PLA Basic",
                "tray_sub_brands": "Bambu Lab",
                "tray_color": "00AE42", # Bambu Green
                "tray_type": "PLA",
                "remain_percent": 82,
                "is_active": self.state == "PRINTING"
            },
            {
                "id": 1,
                "tray_id_name": "PLA Matte",
                "tray_sub_brands": "Bambu Lab",
                "tray_color": "FFFFFF", # White
                "tray_type": "PLA",
                "remain_percent": 65,
                "is_active": False
            },
            {
                "id": 2,
                "tray_id_name": "PETG Basic",
                "tray_sub_brands": "Bambu Lab",
                "tray_color": "1A1A1A", # Charcoal Black
                "tray_type": "PETG",
                "remain_percent": 94,
                "is_active": False
            },
            {
                "id": 3,
                "tray_id_name": "PLA Silk",
                "tray_sub_brands": "Bambu Lab",
                "tray_color": "DFAC42", # Silk Gold
                "tray_type": "PLA",
                "remain_percent": 40,
                "is_active": False
            }
        ]

        self._running = False
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        self._running = True
        self._task = asyncio.create_task(self._simulation_loop())

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _simulation_loop(self) -> None:
        while self._running:
            try:
                await asyncio.sleep(1.0)
                if self.state == "PRINTING":
                    # Advance progress ~0.25% per second
                    step = random.uniform(0.18, 0.32)
                    self.progress = min(100.0, self.progress + step)
                    
                    if self.total_layers > 0:
                        self.current_layer = int((self.progress / 100.0) * self.total_layers)
                    
                    # Realistic temperature jitter (PID control simulation)
                    self.nozzle_actual = self.nozzle_target + random.uniform(-0.6, 0.6)
                    self.bed_actual = self.bed_target + random.uniform(-0.3, 0.3)
                    
                    # Active AMS tray slight consumption
                    if random.random() < 0.1 and self.ams_trays[0]["remain_percent"] > 5:
                        self.ams_trays[0]["remain_percent"] -= 1

                    # Complete transition check
                    if self.progress >= 100.0:
                        self.state = "CLEARING_REQUIRED"
                        self.nozzle_target = 0.0
                        self.bed_target = 0.0
                        self.ams_trays[0]["is_active"] = False

                elif self.state == "CLEARING_REQUIRED":
                    # Cool down
                    self.nozzle_actual = max(30.0, self.nozzle_actual - 1.5)
                    self.bed_actual = max(26.0, self.bed_actual - 0.8)

                elif self.state == "IDLE":
                    # Keep idle temperatures
                    self.nozzle_actual = max(26.0, min(32.0, self.nozzle_actual + random.uniform(-0.2, 0.2)))
                    self.bed_actual = max(24.0, min(28.0, self.bed_actual + random.uniform(-0.1, 0.1)))

            except asyncio.CancelledError:
                break
            except Exception:
                pass

    def get_telemetry(self) -> Dict[str, Any]:
        remaining_min = 0
        if self.state == "PRINTING":
            remaining_pct = max(0.0, 100.0 - self.progress)
            # ~4 seconds per percent -> convert to minutes
            remaining_min = max(1, int((remaining_pct * 4.0) / 60.0))

        status_msg = "正常运行"
        if self.state == "IDLE":
            status_msg = "机台待命中 · 热床已清理"
        elif self.state == "CLEARING_REQUIRED":
            status_msg = "打印已完工 · 等待志愿者清台铲件"
        elif self.state == "PRINTING":
            status_msg = f"正在打印: {self.task_name}"

        return {
            "id": self.config.id,
            "name": self.config.name,
            "model": self.config.model,
            "serial_number": self.config.serial_number,
            "ip_address": self.config.ip_address,
            "state": self.state,
            "temperatures": {
                "nozzle": round(self.nozzle_actual, 1),
                "nozzle_target": round(self.nozzle_target, 1),
                "bed": round(self.bed_actual, 1),
                "bed_target": round(self.bed_target, 1),
                "chamber": round(self.chamber, 1)
            },
            "progress": round(self.progress, 1),
            "remaining_time_min": remaining_min,
            "current_layer": self.current_layer,
            "total_layers": self.total_layers,
            "ams_trays": self.ams_trays,
            "status_message": status_msg,
            "task_name": self.task_name,
            "wifi_signal": -52,
            "updated_at": time.time()
        }
