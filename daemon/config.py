import os
from typing import List, Dict, Any
from pydantic import Field, BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict

class PrinterConfig(BaseModel):
    id: str
    name: str
    model: str
    serial_number: str
    driver_type: str = "simulator" # "simulator" or "passive_bambu"
    ip_address: str = "127.0.0.1"
    access_code: str = ""
    initial_state: str = "IDLE"
    task_name: str = ""
    total_layers: int = 200
    initial_progress: float = 0.0

class DaemonSettings(BaseSettings):
    DAEMON_ID: str = Field(default="daemon_node_01", description="Unique daemon node ID")
    DAEMON_SECRET_TOKEN: str = Field(
        default="platerelay_daemon_secret_token_123",
        description="Pre-shared token for authenticating with Panel"
    )
    PANEL_WS_URL: str = Field(
        default="ws://127.0.0.1:8000/daemon/ws",
        description="Panel backend WebSocket endpoint"
    )
    REPORT_INTERVAL_SEC: float = Field(
        default=1.0,
        description="Interval between batch telemetry reports"
    )

    # Configured printers on this node
    PRINTERS: List[PrinterConfig] = [
        PrinterConfig(
            id="mock-x1c-01",
            name="拓竹 X1-Carbon #01",
            model="Bambu X1-Carbon",
            serial_number="00M00A381500001",
            driver_type="simulator",
            ip_address="192.168.1.101",
            initial_state="PRINTING",
            task_name="Plate_Trophy_Hex.gcode",
            total_layers=350,
            initial_progress=48.5
        ),
        PrinterConfig(
            id="mock-p1s-02",
            name="拓竹 P1S #02",
            model="Bambu P1S",
            serial_number="01P00A492600002",
            driver_type="simulator",
            ip_address="192.168.1.102",
            initial_state="IDLE",
            task_name="",
            total_layers=0,
            initial_progress=0.0
        ),
        PrinterConfig(
            id="mock-a1m-03",
            name="拓竹 A1-Mini #03",
            model="Bambu A1-Mini",
            serial_number="03A00C503700003",
            driver_type="simulator",
            ip_address="192.168.1.103",
            initial_state="CLEARING_REQUIRED",
            task_name="Keycap_Batch_A.gcode",
            total_layers=120,
            initial_progress=100.0
        ),
        PrinterConfig(
            id="real-x2d-04",
            name="真实拓竹 X2D (机房机台)",
            model="Bambu X2D",
            serial_number="02X2D999900004",
            driver_type="passive_bambu",
            ip_address="192.168.1.150",
            access_code="", # Pending LAN mode activation on printer screen
            initial_state="OFFLINE",
            task_name="",
            total_layers=0,
            initial_progress=0.0
        )
    ]

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="DAEMON_",
        extra="ignore"
    )

daemon_settings = DaemonSettings()
