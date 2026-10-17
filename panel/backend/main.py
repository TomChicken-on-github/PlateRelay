import os
import json
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, status
from fastapi.responses import JSONResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from panel.backend.core.config import settings
from panel.backend.modules.fleet.hub import fleet_hub

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("panel.main")

SERVER_START_TIME = time.time()

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("PlateRelay Panel Backend starting up...")
    yield
    logger.info("PlateRelay Panel Backend shutting down...")
    await fleet_hub.shutdown()

app = FastAPI(
    title="PlateRelay Panel API",
    description="Central Management & Telemetry Hub for PlateRelay 3D Print Fleet",
    version="0.1.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/v1/health")
async def health_check():
    """Health check endpoint providing runtime operational metrics."""
    return {
        "status": "healthy",
        "service": "panel",
        "profile": settings.WORKSPACE_PROFILE,
        "uptime_sec": round(time.time() - SERVER_START_TIME, 2),
        "printers_count": len(fleet_hub._printers),
        "active_daemons": len(fleet_hub._daemon_clients),
        "active_browsers": len(fleet_hub._browser_clients)
    }

@app.get("/api/v1/fleet")
async def get_fleet_snapshot():
    """REST endpoint returning the latest snapshot of all registered printers."""
    return {
        "printers": [p.model_dump() for p in fleet_hub.get_snapshot()]
    }

# -------------------------------------------------------------
# Daemon WebSocket Gateway
# -------------------------------------------------------------
@app.websocket("/daemon/ws")
async def daemon_ws_endpoint(
    websocket: WebSocket,
    token: str = Query(...)
):
    """Internal gateway for hardware daemons to report telemetry."""
    if token != settings.DAEMON_SECRET_TOKEN:
        logger.warning(f"Unauthorized daemon connection attempt with invalid token: {token}")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()
    daemon_id = "unknown_daemon"
    logger.info("Hardware daemon connected to gateway.")

    try:
        while True:
            text = await websocket.receive_text()
            data = json.loads(text)
            msg_type = data.get("type")

            if msg_type == "REGISTER":
                daemon_id = data.get("daemon_id", "default_daemon")
                printers = data.get("printers", [])
                await fleet_hub.register_daemon(daemon_id, printers, websocket)
                await websocket.send_text(json.dumps({
                    "type": "REGISTER_ACK",
                    "status": "ok",
                    "daemon_id": daemon_id
                }))

            elif msg_type == "TELEMETRY_BATCH":
                batch = data.get("data", [])
                await fleet_hub.update_batch(daemon_id, batch)

            elif msg_type == "HEARTBEAT":
                await websocket.send_text(json.dumps({
                    "type": "HEARTBEAT_ACK",
                    "server_time": time.time()
                }))

            else:
                logger.warning(f"Unrecognized message type from daemon '{daemon_id}': {msg_type}")

    except WebSocketDisconnect:
        logger.info(f"Daemon '{daemon_id}' disconnected normally.")
        await fleet_hub.unregister_daemon(daemon_id, websocket)
    except Exception as e:
        logger.error(f"Error on daemon connection '{daemon_id}': {e}", exc_info=True)
        await fleet_hub.unregister_daemon(daemon_id, websocket)

# -------------------------------------------------------------
# Browser Dashboard WebSocket Gateway
# -------------------------------------------------------------
@app.websocket("/api/v1/ws/dashboard")
async def dashboard_ws_endpoint(websocket: WebSocket):
    """Public WebSocket gateway for browser clients to receive live telemetry."""
    await websocket.accept()
    logger.info("Browser dashboard client connected.")
    await fleet_hub.register_browser(websocket)

    try:
        while True:
            text = await websocket.receive_text()
            try:
                msg = json.loads(text)
                if msg.get("type") == "PING":
                    await websocket.send_text(json.dumps({
                        "type": "PONG",
                        "server_time": time.time()
                    }))
            except Exception:
                pass
    except WebSocketDisconnect:
        logger.info("Browser dashboard client disconnected.")
        await fleet_hub.unregister_browser(websocket)
    except Exception as e:
        logger.warning(f"Error on browser client WebSocket: {e}")
        await fleet_hub.unregister_browser(websocket)

# -------------------------------------------------------------
# Static File Hosting for Single Page App (SPA)
# -------------------------------------------------------------
DIST_DIR = Path(__file__).resolve().parent.parent / "backend" / "dist"

if DIST_DIR.exists() and (DIST_DIR / "index.html").exists():
    app.mount("/", StaticFiles(directory=str(DIST_DIR), html=True), name="static")
else:
    @app.get("/")
    async def index_placeholder():
        return HTMLResponse("""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>PlateRelay Panel Backend</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                       background: #0f1115; color: #e6edf3; display: flex; align-items: center;
                       justify-content: center; height: 100vh; margin: 0; }
                .card { background: #161b22; border: 1px solid #30363d; border-radius: 12px;
                        padding: 32px; max-width: 500px; text-align: center; }
                h1 { color: #18a058; font-size: 24px; margin-bottom: 12px; }
                p { color: #8b949e; font-size: 14px; line-height: 1.6; }
                a { color: #38bdf8; text-decoration: none; }
            </style>
        </head>
        <body>
            <div class="card">
                <h1>PlateRelay Panel API 在线</h1>
                <p>后端主控服务运行正常。前端构建产物尚未打包至 <code>dist/</code>。<br>
                   可在 <code>panel/frontend/</code> 目录启动 Vite 开发调试，或执行 <code>npm run build</code> 生成前端。</p>
                <p><a href="/api/v1/health">查看健康状态 (/api/v1/health)</a> | <a href="/api/v1/fleet">查看机群快照 (/api/v1/fleet)</a></p>
            </div>
        </body>
        </html>
        """)
