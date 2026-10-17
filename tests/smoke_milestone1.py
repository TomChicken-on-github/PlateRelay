import asyncio
import json
import logging
import subprocess
import sys
import time
import httpx
import websockets

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] [SmokeTest] %(message)s")
logger = logging.getLogger("smoke_test")

PANEL_URL = "http://127.0.0.1:8000"
PANEL_WS_URL = "ws://127.0.0.1:8000/api/v1/ws/dashboard"
PYTHON_EXE = sys.executable

async def wait_for_http(url: str, timeout: float = 10.0):
    start = time.time()
    async with httpx.AsyncClient() as client:
        while time.time() - start < timeout:
            try:
                resp = await client.get(url)
                if resp.status_code == 200:
                    return resp
            except Exception:
                pass
            await asyncio.sleep(0.3)
    raise TimeoutError(f"HTTP service at {url} did not become ready within {timeout}s")

async def run_smoke_verification():
    logger.info("==================================================================")
    logger.info(">>> STARTING MILESTONE 1 PRODUCTION SMOKE VERIFICATION <<<")
    logger.info("==================================================================")

    # 1. Start Panel Server
    logger.info("Step 1: Launching Panel Backend on port 8000...")
    panel_proc = subprocess.Popen(
        [PYTHON_EXE, "-m", "uvicorn", "panel.backend.main:app", "--host", "127.0.0.1", "--port", "8000"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True
    )

    daemon_proc = None

    try:
        # Verify /api/v1/health
        health_resp = await wait_for_http(f"{PANEL_URL}/api/v1/health")
        logger.info(f"Panel Health Check OK: {health_resp.json()}")

        # Verify Static SPA hosting at /
        root_resp = await wait_for_http(f"{PANEL_URL}/")
        assert "PlateRelay" in root_resp.text, "Root page did not serve PlateRelay SPA"
        logger.info("Panel Static SPA Delivery OK: index.html served at '/' with status 200")

        # 2. Connect Browser WebSocket client
        logger.info("Step 2: Connecting simulated Browser client to /api/v1/ws/dashboard...")
        async with websockets.connect(PANEL_WS_URL) as browser_ws:
            # Initial snapshot should be empty before daemon registers
            initial_msg = json.loads(await browser_ws.recv())
            logger.info(f"Received initial snapshot before daemon: {initial_msg['type']}, printers count: {len(initial_msg['printers'])}")

            # 3. Launch Daemon Node
            logger.info("Step 3: Launching Daemon Node process...")
            daemon_proc = subprocess.Popen(
                [PYTHON_EXE, "-m", "daemon.main"],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True
            )

            # Wait for registration and fleet update in browser WS
            logger.info("Step 4: Waiting for Daemon registration & telemetry streaming...")
            received_printers = {}
            for _ in range(5):
                frame = json.loads(await asyncio.wait_for(browser_ws.recv(), timeout=5.0))
                msg_type = frame.get("type")
                printers = frame.get("printers", [])
                logger.info(f"Browser received frame [{msg_type}]: {len(printers)} printers reporting.")
                for p in printers:
                    received_printers[p["id"]] = p

            assert "mock-x1c-01" in received_printers, "mock-x1c-01 missing from telemetry"
            assert "real-x2d-04" in received_printers, "real-x2d-04 missing from telemetry"

            x1c = received_printers["mock-x1c-01"]
            x2d = received_printers["real-x2d-04"]

            logger.info(f"Verified x1c: state={x1c['state']}, nozzle={x1c['temperatures']['nozzle']}C, progress={x1c['progress']}%, AMS count={len(x1c['ams_trays'])}")
            logger.info(f"Verified x2d (Passive Holder): state={x2d['state']}, msg='{x2d['status_message']}'")
            assert x1c["state"] == "PRINTING", f"Expected x1c state PRINTING, got {x1c['state']}"
            assert x2d["state"] == "OFFLINE", f"Expected x2d state OFFLINE, got {x2d['state']}"

            # Test Ping/Pong latency
            logger.info("Step 5: Testing Browser Keepalive Ping/Pong...")
            await browser_ws.send(json.dumps({"type": "PING"}))
            pong = json.loads(await asyncio.wait_for(browser_ws.recv(), timeout=3.0))
            assert pong["type"] == "PONG", f"Expected PONG, got {pong}"
            logger.info(f"Browser Ping/Pong OK: {pong}")

            # 4. Test Disconnection Resilience (Kill Daemon)
            logger.info("Step 6: Testing Disconnection Resilience (Killing Daemon process)...")
            daemon_proc.terminate()
            daemon_proc.wait(timeout=3)
            daemon_proc = None

            # Wait for Panel to broadcast OFFLINE flip
            offline_detected = False
            for _ in range(5):
                frame = json.loads(await asyncio.wait_for(browser_ws.recv(), timeout=4.0))
                printers = frame.get("printers", [])
                for p in printers:
                    if p["id"] == "mock-x1c-01" and p["state"] == "OFFLINE":
                        offline_detected = True
                        logger.info(f"Resilience Verified: mock-x1c-01 flipped to OFFLINE after daemon loss! msg='{p['status_message']}'")
                        break
                if offline_detected:
                    break

            assert offline_detected, "Panel failed to flip printers to OFFLINE upon daemon disconnect"

            # 5. Test Reconnection Resilience (Restart Daemon)
            logger.info("Step 7: Testing Reconnection Resilience (Restarting Daemon process)...")
            daemon_proc = subprocess.Popen(
                [PYTHON_EXE, "-m", "daemon.main"],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True
            )

            # Wait for Panel to broadcast recovered active state
            recovery_detected = False
            for _ in range(8):
                frame = json.loads(await asyncio.wait_for(browser_ws.recv(), timeout=4.0))
                printers = frame.get("printers", [])
                for p in printers:
                    if p["id"] == "mock-x1c-01" and p["state"] == "PRINTING":
                        recovery_detected = True
                        logger.info(f"Recovery Verified: mock-x1c-01 recovered to PRINTING! progress={p['progress']}%")
                        break
                if recovery_detected:
                    break

            assert recovery_detected, "Daemon failed to reconnect and recover fleet state"

    finally:
        logger.info("Cleaning up background test processes...")
        if daemon_proc and daemon_proc.poll() is None:
            daemon_proc.terminate()
            daemon_proc.wait(timeout=3)
        if panel_proc and panel_proc.poll() is None:
            panel_proc.terminate()
            panel_proc.wait(timeout=3)

    logger.info("==================================================================")
    logger.info(">>> ALL MILESTONE 1 PRODUCTION SMOKE CHECKS PASSED SUCCESSFULLY! <<<")
    logger.info("==================================================================")

if __name__ == "__main__":
    asyncio.run(run_smoke_verification())
