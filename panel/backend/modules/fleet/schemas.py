import time
from enum import Enum
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field

class PrinterState(str, Enum):
    IDLE = "IDLE"
    PREPARING = "PREPARING"
    PRINTING = "PRINTING"
    PAUSED = "PAUSED"
    CLEARING_REQUIRED = "CLEARING_REQUIRED"
    OFFLINE = "OFFLINE"
    UNMANAGED_PRINTING = "UNMANAGED_PRINTING"

class Temperatures(BaseModel):
    nozzle: float = Field(default=0.0, ge=0.0, le=400.0)
    nozzle_target: float = Field(default=0.0, ge=0.0, le=400.0)
    bed: float = Field(default=0.0, ge=0.0, le=150.0)
    bed_target: float = Field(default=0.0, ge=0.0, le=150.0)
    chamber: Optional[float] = Field(default=None, ge=0.0, le=100.0)

class AmsTray(BaseModel):
    id: int = Field(default=0, ge=0, le=15)
    tray_id_name: Optional[str] = None
    tray_sub_brands: Optional[str] = None
    tray_color: str = Field(default="FFFFFF")
    tray_type: str = Field(default="PLA")
    remain_percent: Optional[int] = Field(default=100, ge=0, le=100)
    is_active: bool = False

class PrinterTelemetry(BaseModel):
    id: str = Field(..., description="Unique hardware or simulation identifier")
    name: str = Field(..., description="Human-friendly printer display name")
    model: str = Field(..., description="Machine model, e.g. Bambu X1-Carbon, X2D")
    serial_number: str = Field(..., description="Hardware serial number")
    ip_address: Optional[str] = None
    state: PrinterState = PrinterState.OFFLINE
    temperatures: Temperatures = Field(default_factory=Temperatures)
    progress: float = Field(default=0.0, ge=0.0, le=100.0)
    remaining_time_min: int = Field(default=0, ge=0)
    current_layer: int = Field(default=0, ge=0)
    total_layers: int = Field(default=0, ge=0)
    ams_trays: List[AmsTray] = Field(default_factory=list)
    status_message: Optional[str] = None
    task_name: Optional[str] = None
    wifi_signal: Optional[int] = None
    updated_at: float = Field(default_factory=time.time)

class FleetSnapshotMessage(BaseModel):
    type: str = "FLEET_SNAPSHOT"
    timestamp: float = Field(default_factory=time.time)
    printers: List[PrinterTelemetry]

class FleetUpdateMessage(BaseModel):
    type: str = "FLEET_UPDATE"
    timestamp: float = Field(default_factory=time.time)
    printers: List[PrinterTelemetry]
