from abc import ABC, abstractmethod
from typing import Dict, Any

class BasePrinterDriver(ABC):
    """Abstract base class for printer hardware abstraction layer (HAL)."""

    @abstractmethod
    async def start(self) -> None:
        """Initialize driver and background polling/listeners."""
        pass

    @abstractmethod
    async def stop(self) -> None:
        """Clean up connections and background tasks."""
        pass

    @abstractmethod
    def get_telemetry(self) -> Dict[str, Any]:
        """Return standardized telemetry dict conforming to PrinterTelemetry schema."""
        pass
