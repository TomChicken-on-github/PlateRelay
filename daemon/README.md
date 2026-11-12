# PlateRelay daemon

站在打印机所在的局域网里，主动连面板，替面板和打印机说话。这个目录里有两样东西：

| 包 | 是什么 |
| --- | --- |
| `platerelay_daemon` | daemon 本体 |
| `platerelay_sim` | 一台模拟打印机。它是独立的设备，不 import daemon，也不知道面板协议 |

## daemon 的结构

```
platerelay_daemon/
  link/         和面板的连接：挑战认证、心跳、退避重连、发件箱、文件下载
  store/        本机持久化（SQLite）：发件箱、命令台账、不再开打、文件清单、运行序号、没走完的开打流程
  printers/     每台打印机一个 worker：快照、任务事件的判断、运行序号、命令执行
  jobs/         开打流程：排队 → 下载 → 传到打印机 → 开打前检查 → 发起打印 → 发指令
  adapter_api/  适配器接口和标准类型
  adapters/
    sim/        模拟打印机的驱动
    bambu/      拓竹：目前只有只读的状态换算和只读保护，还没接成完整适配器
  protocol/     从 packages/shared/schema/daemon/v1 生成的消息类型
  cli/          run、status
```

适配器只回答"这台打印机现在是什么样"并执行动作；哪个任务是系统派的、什么时候算开始和结束，
都在 `printers/` 里比较前后两份状态判断，所有品牌共用。

## 模拟打印机

它有自己的固件状态（`idle` / `preparing` / `printing` / `paused` / `done` / `failed` / `stopped` …）、
自己的局域网接口（HTTP + WebSocket，连上先给完整状态，之后只推变化的字段）和自己的报错码，
接口说明在 `src/platerelay_sim/server.py` 开头。daemon 像对接真机一样，只通过这套接口工作。

另有一组"现场接口"（`/operator/...`），代表站在机器旁的人和物理世界，驱动不用它：

```bash
# 起两台，机器时间 10 倍速
PYTHONPATH=src uv run python -m platerelay_sim run --count 2 --speed 10

# 扮演现场的人
PYTHONPATH=src uv run python -m platerelay_sim op 7130 starts_local_print        # 在屏幕上直接开打
PYTHONPATH=src uv run python -m platerelay_sim op 7130 filament_runs_out '{"unit":0,"slot":0}'
PYTHONPATH=src uv run python -m platerelay_sim op 7130 loads_filament '{"unit":0,"slot":0}'
PYTHONPATH=src uv run python -m platerelay_sim op 7130 press_pause               # press_resume / press_stop
PYTHONPATH=src uv run python -m platerelay_sim op 7130 raises_alert '{"level":"pause"}'
PYTHONPATH=src uv run python -m platerelay_sim op 7130 unplug_network '{"seconds":20}'
PYTHONPATH=src uv run python -m platerelay_sim op 7130 power_cycle
PYTHONPATH=src uv run python -m platerelay_sim op 7130 fail_next_prepare         # 下一次开打在准备阶段失败
PYTHONPATH=src uv run python -m platerelay_sim op 7130 reject_next_print         # 下一次开打被固件拒绝
PYTHONPATH=src uv run python -m platerelay_sim op 7130 cut_next_upload           # 下一次上传传到一半断开
```

面板里添加模拟打印机时：品牌 `sim`，地址填 `127.0.0.1:7130`，序列号 `SIM-0001`（第二台 `SIM-0002`，依此类推）。
默认不校验访问码；要校验就在启动前设环境变量 `PLATERELAY_SIM_ACCESS_CODE`。

## 启动 daemon

```bash
# 第一次：用面板生成的一次性注册令牌
export PLATERELAY_ENROLL_TOKEN=...          # 也可以用 --token
export PLATERELAY_DEV_INSECURE=1            # 只在开发时：允许明文连本机的面板
PYTHONPATH=src uv run python -m platerelay_daemon --data-dir ./.daemon-data run --panel http://localhost:3000

# 之后直接启动
PYTHONPATH=src uv run python -m platerelay_daemon --data-dir ./.daemon-data run

# 看本机状态（只读）
PYTHONPATH=src uv run python -m platerelay_daemon --data-dir ./.daemon-data status
```

数据目录里有 `daemon.sqlite` 和私钥 `daemon.key`（权限 0600）。访问码只在内存里。

## 测试

```bash
uv run pytest
```

集成测试起的是真 daemon、真的模拟打印机进程内实例和一个假面板（`tests/fake_panel.py`，按契约收发、校验签名，没有业务）。

## 还没做

实况和抓拍、结束照片、延时摄影、局域网发现、`doctor`、Windows 上私钥的系统加密、
固件自动续料事件、拓竹的完整适配器（要用户在场、明确同意后才对真机发命令）。
