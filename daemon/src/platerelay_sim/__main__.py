"""启动模拟打印机，或者扮演现场的人对它做一件事。

  python -m platerelay_sim run --count 2 --base-port 7130
  python -m platerelay_sim op 7130 filament_runs_out '{"unit":0,"slot":0}'

访问码从环境变量 PLATERELAY_SIM_ACCESS_CODE 读，不设就不校验。
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import urllib.request

from .printer import SimConfig
from .server import serve


def main() -> None:
    parser = argparse.ArgumentParser(prog="platerelay-sim")
    commands = parser.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run", help="启动模拟打印机")
    run.add_argument("--host", default="127.0.0.1")
    run.add_argument("--base-port", type=int, default=7130)
    run.add_argument("--count", type=int, default=1)
    run.add_argument("--model-id", default="N6")
    run.add_argument("--prepare-seconds", type=float, default=20)
    run.add_argument("--print-seconds", type=float, default=120)
    run.add_argument("--speed", type=float, default=1.0, help="机器时间相对真实时间的倍数")
    op = commands.add_parser("op", help="扮演现场的人")
    op.add_argument("port", type=int)
    op.add_argument("action")
    op.add_argument("args", nargs="?", default="{}")
    op.add_argument("--host", default="127.0.0.1")
    options = parser.parse_args()

    if options.command == "op":
        request = urllib.request.Request(
            f"http://{options.host}:{options.port}/operator/{options.action}",
            data=json.dumps(json.loads(options.args)).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                print(response.read().decode())
        except urllib.error.HTTPError as error:
            print(error.read().decode())
            raise SystemExit(1) from None
        return

    configs = [
        (
            SimConfig(
                serial=f"SIM-{index + 1:04d}",
                model_id=options.model_id,
                access_code=os.environ.get("PLATERELAY_SIM_ACCESS_CODE") or None,
                prepare_seconds=options.prepare_seconds,
                print_seconds=options.print_seconds,
                speed=options.speed,
            ),
            options.base_port + index,
        )
        for index in range(options.count)
    ]
    try:
        asyncio.run(serve(configs, options.host))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
