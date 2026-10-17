import asyncio
import json
import logging
import time
from typing import Dict, Set, List, Any, Optional
from fastapi import WebSocket

from panel.backend.modules.fleet.schemas import (
    PrinterTelemetry,
    PrinterState,
    FleetSnapshotMessage,
    FleetUpdateMessage,
)

logger = logging.getLogger("panel.fleet_hub")

class FleetHub:
    """Production-grade in-memory fleet telemetry hub.
    Manages active Daemon and Browser WebSocket connections with concurrency safety.
    """
    def __init__(self):
        # printer_id -> PrinterTelemetry
        self._printers: Dict[str, PrinterTelemetry] = {}
        # daemon_id -> set of printer_ids registered by this daemon
        self._daemon_printers: Dict[str, Set[str]] = {}
        # Active Browser WebSocket connections
        self._browser_clients: Set[WebSocket] = set()
        # Active Daemon WebSocket connections
        self._daemon_clients: Set[WebSocket] = set()
        self._lock = asyncio.Lock()
        self._last_broadcast_time: float = 0.0

    async def register_daemon(
        self,
        daemon_id: str,
        printers_data: List[Dict[str, Any]],
        ws: WebSocket
    ) -> None:
        """Register a newly connected daemon and its managed printers."""
        async with self._lock:
            self._daemon_clients.add(ws)
            if daemon_id not in self._daemon_printers:
                self._daemon_printers[daemon_id] = set()

            for item in printers_data:
                try:
                    telemetry = PrinterTelemetry.model_validate(item)
                    pid = telemetry.id
                    self._daemon_printers[daemon_id].add(pid)
                    self._printers[pid] = telemetry
                except Exception as e:
                    logger.error(f"Failed to validate printer telemetry payload: {e}, payload: {item}")

        logger.info(f"Daemon '{daemon_id}' registered successfully with {len(printers_data)} printers.")
        await self.broadcast_to_browsers(force=True)

    async def update_batch(
        self,
        daemon_id: str,
        batch_data: List[Dict[str, Any]]
    ) -> None:
        """Process batch telemetry update from an authenticated daemon."""
        async with self._lock:
            for item in batch_data:
                try:
                    telemetry = PrinterTelemetry.model_validate(item)
                    pid = telemetry.id
                    self._printers[pid] = telemetry
                    if daemon_id in self._daemon_printers:
                        self._daemon_printers[daemon_id].add(pid)
                except Exception as e:
                    logger.warning(f"Malformed telemetry item from daemon '{daemon_id}': {e}")

        await self.broadcast_to_browsers(force=False)

    async def unregister_daemon(
        self,
        daemon_id: str,
        ws: WebSocket
    ) -> None:
        """Handle daemon disconnection by setting all its printers to OFFLINE."""
        async with self._lock:
            self._daemon_clients.discard(ws)
            if daemon_id in self._daemon_printers:
                affected_pids = self._daemon_printers.pop(daemon_id, set())
                now = time.time()
                for pid in affected_pids:
                    if pid in self._printers:
                        p = self._printers[pid]
                        # Retain configuration but flip status
                        self._printers[pid] = p.model_copy(update={
                            "state": PrinterState.OFFLINE,
                            "status_message": "节点探针断开连接 (Daemon Disconnected)",
                            "updated_at": now
                        })
                logger.warning(
                    f"Daemon '{daemon_id}' disconnected. Marked {len(affected_pids)} printers as OFFLINE."
                )

        await self.broadcast_to_browsers(force=True)

    async def register_browser(self, ws: WebSocket) -> None:
        """Register a browser client and send initial snapshot."""
        self._browser_clients.add(ws)
        snapshot = self.get_snapshot()
        msg = FleetSnapshotMessage(printers=snapshot)
        try:
            await ws.send_text(msg.model_dump_json())
        except Exception as e:
            logger.warning(f"Failed to send initial snapshot to browser client: {e}")
            self._browser_clients.discard(ws)

    async def unregister_browser(self, ws: WebSocket) -> None:
        """Remove a disconnected browser client."""
        self._browser_clients.discard(ws)

    def get_snapshot(self) -> List[PrinterTelemetry]:
        """Return a copy of the current fleet telemetry snapshot."""
        return list(self._printers.values())

    async def broadcast_to_browsers(self, force: bool = False) -> None:
        """Broadcast latest fleet state to all connected browsers with optional throttling."""
        if not self._browser_clients:
            return

        now = time.time()
        # Throttling to 100ms for responsiveness while avoiding event loop saturation
        if not force and (now - self._last_broadcast_time < 0.1):
            return

        self._last_broadcast_time = now
        snapshot = self.get_snapshot()
        msg = FleetUpdateMessage(printers=snapshot)
        payload = msg.model_dump_json()

        stale_clients = []
        for ws in self._browser_clients:
            try:
                await ws.send_text(payload)
            except Exception:
                stale_clients.append(ws)

        for stale in stale_clients:
            self._browser_clients.discard(stale)

    async def shutdown(self) -> None:
        """Gracefully close all active connections on shutdown."""
        logger.info("FleetHub shutting down, closing active WebSocket connections...")
        async with self._lock:
            for ws in list(self._browser_clients):
                try:
                    await ws.close(code=1001, reason="Server shutting down")
                except Exception:
                    pass
            self._browser_clients.clear()

            for ws in list(self._daemon_clients):
                try:
                    await ws.close(code=1001, reason="Server shutting down")
                except Exception:
                    pass
            self._daemon_clients.clear()

fleet_hub = FleetHub()
