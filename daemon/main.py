import asyncio
import json
import logging
import signal
import sys
import time
from typing import Dict, List
import websockets
from websockets.exceptions import ConnectionClosed

from daemon.config import daemon_settings, PrinterConfig
from daemon.hal.base import BasePrinterDriver
from daemon.hal.simulator import BambuSimulatorDriver
from daemon.hal.passive_bambu import BambuPassiveDriver

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [Daemon] %(message)s"
)
logger = logging.getLogger("daemon.main")

class DaemonClient:
    """Production-grade Daemon Edge Node client.
    Connects to PlateRelay Panel, manages local printer HAL drivers,
    and streams live telemetry batches over an authenticated WebSocket.
    """

    def __init__(self):
        self.settings = daemon_settings
        self.drivers: Dict[str, BasePrinterDriver] = {}
        self._running = False
        self._ws = None

    def initialize_drivers(self):
        logger.info(f"Initializing {len(self.settings.PRINTERS)} printer drivers on node '{self.settings.DAEMON_ID}'...")
        for p_cfg in self.settings.PRINTERS:
            if p_cfg.driver_type == "simulator":
                driver = BambuSimulatorDriver(p_cfg)
            elif p_cfg.driver_type == "passive_bambu":
                driver = BambuPassiveDriver(p_cfg)
            else:
                logger.warning(f"Unknown driver type '{p_cfg.driver_type}', defaulting to simulator.")
                driver = BambuSimulatorDriver(p_cfg)

            self.drivers[p_cfg.id] = driver

    async def start(self):
        self._running = True
        self.initialize_drivers()

        # Start background driver loops
        for pid, driver in self.drivers.items():
            await driver.start()

        logger.info("All printer drivers started. Starting connection loop to Panel...")
        retry_count = 0

        while self._running:
            url = f"{self.settings.PANEL_WS_URL}?token={self.settings.DAEMON_SECRET_TOKEN}"
            try:
                logger.info(f"Connecting to Panel at {self.settings.PANEL_WS_URL}...")
                async with websockets.connect(url) as ws:
                    self._ws = ws
                    retry_count = 0
                    logger.info("Successfully connected to Panel WebSocket gateway.")

                    # 1. Handshake: Send REGISTER message
                    initial_batch = [d.get_telemetry() for d in self.drivers.values()]
                    reg_payload = {
                        "type": "REGISTER",
                        "daemon_id": self.settings.DAEMON_ID,
                        "printers": initial_batch,
                        "timestamp": time.time()
                    }
                    await ws.send(json.dumps(reg_payload))
                    logger.info(f"Registered {len(initial_batch)} printers with Panel.")

                    # 2. Main reporting & listening loops
                    send_task = asyncio.create_task(self._reporting_loop(ws))
                    recv_task = asyncio.create_task(self._receive_loop(ws))

                    done, pending = await asyncio.wait(
                        [send_task, recv_task],
                        return_when=asyncio.FIRST_COMPLETED
                    )
                    for t in pending:
                        t.cancel()

            except (ConnectionClosed, OSError, Exception) as e:
                if not self._running:
                    break
                retry_count += 1
                backoff = min(10.0, 1.0 * (1.5 ** min(retry_count, 6)))
                logger.warning(f"Connection to Panel lost or failed: {e}. Retrying in {backoff:.1f}s...")
                await asyncio.sleep(backoff)

        # Cleanup on exit
        await self.stop()

    async def _reporting_loop(self, ws):
        heartbeat_counter = 0
        while self._running:
            await asyncio.sleep(self.settings.REPORT_INTERVAL_SEC)
            batch = [d.get_telemetry() for d in self.drivers.values()]
            batch_payload = {
                "type": "TELEMETRY_BATCH",
                "daemon_id": self.settings.DAEMON_ID,
                "data": batch,
                "timestamp": time.time()
            }
            await ws.send(json.dumps(batch_payload))

            # Send periodic heartbeat
            heartbeat_counter += 1
            if heartbeat_counter >= 10:
                heartbeat_counter = 0
                await ws.send(json.dumps({
                    "type": "HEARTBEAT",
                    "daemon_id": self.settings.DAEMON_ID,
                    "timestamp": time.time()
                }))

    async def _receive_loop(self, ws):
        while self._running:
            msg = await ws.recv()
            try:
                data = json.loads(msg)
                # Heartbeat ACK or Register ACK
                msg_type = data.get("type")
                if msg_type in ("REGISTER_ACK", "HEARTBEAT_ACK"):
                    pass
                else:
                    logger.debug(f"Received message from Panel: {data}")
            except Exception:
                pass

    async def stop(self):
        logger.info("Stopping Daemon and shutting down all printer drivers...")
        self._running = False
        for pid, driver in self.drivers.items():
            await driver.stop()
        if self._ws and not self._ws.closed:
            await self._ws.close()
        logger.info("Daemon cleanly stopped.")

async def main():
    daemon = DaemonClient()

    loop = asyncio.get_running_loop()
    stop_event = asyncio.Event()

    def _signal_handler():
        logger.info("Received termination signal.")
        stop_event.set()

    # Register signals if available
    try:
        for s in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(s, _signal_handler)
    except NotImplementedError:
        # On Windows, add_signal_handler for SIGINT is not supported in asyncio loop
        pass

    runner_task = asyncio.create_task(daemon.start())

    try:
        await runner_task
    except asyncio.CancelledError:
        await daemon.stop()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
