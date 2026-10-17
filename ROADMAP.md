# PlateRelay 实施路线图 (ROADMAP.md)

本文档作为 PlateRelay 项目的阶段性垂直切片（Vertical Slice）工程落地指南，基于 `agent.md` 最高架构契约推进。
本项目严格执行**生产级软件工程规范（Production-Grade Engineering）**：拒绝桩函数、拒绝未经跑通的代码、拒绝随意引入未授权第三方依赖。每个里程碑必须具备本地真实可运行的端到端冒烟测试（Smoke Run）作为准入闸门。

---

## 阶段演进概览

| 里程碑 | 核心主题 | 架构边界 | 生产级准入标准 (Definition of Done) | 当前状态 |
| :--- | :--- | :--- | :--- | :--- |
| **Milestone 1** | **多机台只读监控大屏** | Panel (FastAPI + Naive UI 前端) ↔ Daemon (HAL 仿真 + 真实X2D被动挂载) | 双端独立常驻进程拉起，通过认证 WS 管道实现 1s 遥测推流，前端大屏动态呈现高仿真动效，断网自动标记 OFFLINE，重连秒级自愈。 | **进行中 (In Progress)** |
| **Milestone 2** | **3MF 切片解析与拆盘微内核** | Panel Backend (`modules/jobs/unpacker.py`) | 内存安全解包 `.gcode.3mf`，提取元数据，自动拆分子盘工单与料槽预估，真实 3MF 文件测试覆盖。 | 待开始 |
| **Milestone 3** | **去队伍化账户与动态并发排单** | Panel Backend (`identity`, `jobs` 状态机) | 自然人 JWT 鉴权、动态并发限额锁（节点 A 判定）、FIFO 待排队列及审核流转。 | 待开始 |
| **Milestone 4** | **拓竹硬件协议驱动与双状态机** | Daemon (`hal/bambu_mqtt.py`, `hal/bambu_ftps.py`) | 真实/模拟拓竹机床 MQTT TLS 8883 与 FTPS 990 握手、派单原子回滚、清台打卡防线、SD 卡自愈清理。 | 待开始 |
| **Milestone 5** | **仓储履约与动态短效凭证核销** | Panel (`storage`) + Web UI 领料核销台 | 实体/溢出储物盒独占锁定、10分钟动态 QR 核销、双照留底归档、端到端全链路闭环。 | 待开始 |

---

## Milestone 1 生产级详细设计（当前执行）

### 1. 面板端架构 (Panel)
- **`panel/backend/`**：
  - 基于 FastAPI + AsyncIO 的单一主控常驻服务。
  - Pydantic v2 `BaseSettings` 强类型环境配置与优雅停机（Graceful Shutdown）。
  - `FleetHub` 协程安全状态机容器：支持并发写锁、Daemon 注册鉴权、多租户浏览器客户端广播、心跳保活检测。
  - 生产静态资产挂载：直接挂载 `panel/backend/dist` 编译产物，具备 SPA 路由 Fallback 兜底。
- **`panel/frontend/`**：
  - 独立 Vue 3 + Tailwind CSS + TypeScript 工程。
  - UI 深度参考 **Komari / Naive UI 卡片样式**：
    - 机型徽章、高信息密度排版、状态呼吸指示灯（PRINTING 蓝绿呼吸、IDLE 翠绿、CLEARING 琥珀橙、OFFLINE 灰雾）。
    - 喷头与热床实时双温仪表盘（含设定目标温与动态波形/微动效）。
    - 进度条平滑过度（平滑插值，避免跳帧）、实时层高（`Layer X / Y`）、预估剩余时长。
    - AMS 4 槽位料盘可视化色块（支持十六进制真彩渲染、料盘材质标签与正在供料高亮环）。
    - 真实 X2D 机台被动挂载卡片（优雅呈现 `OFFLINE·等待开启局域网模式`，贴心显示指引提示）。
    - 顶部导航栏统计胶囊（总机台、打印中、就绪空闲、离线台数、网络心跳延迟）。
  - 具备指数退避自动重连的生产级 WebSocket Client。

### 2. 节点端架构 (Daemon)
- **`daemon/`**：
  - 独立的纯异步 Python 3.12+ 硬件网关常驻服务。
  - **Zero Database**：完全脱离数据库，纯内存无状态流转。
  - **高仿真 HAL 模拟器 (`Simulator`)**：
    - 精确模拟热床/喷头升温曲线、层高递增、打印进度推进、AMS 耗材余量递减与完工转入 `CLEARING_REQUIRED` 状态机。
  - **真实 X2D 机台被动挂载 (`BambuPassive`)**：
    - 预留配置文件（IP、Serial、Access Code）。
    - 严格只读监听，端口未开启时优雅保持 `OFFLINE` 状态，坚决不发送任何写控制指令。
  - **自愈通信链路**：
    - 主动通过 `ws://panel:8000/daemon/ws?token=SECRET` 握手。
    - 1 秒滑动窗口批量节流上报，断线指数退避重连。

### 3. 验收门禁 (Verification Gate)
1. Panel 与 Daemon 协同启动，日志整洁无未捕获异常。
2. 自动化冒烟脚本模拟前端连接，捕获完整的 `FLEET_SNAPSHOT` 与 `FLEET_UPDATE` 数据帧。
3. 模拟节点突然下线（Kill Daemon），Panel 瞬间将机台状态转为 `OFFLINE` 并向大屏广播。
4. 模拟节点恢复上线，机台状态秒级恢复，数据不丢不卡。
5. 前端静态页面通过 Vite 构建输出至 `dist/`，FastAPI 根路由 `http://localhost:8000` 正常渲染大屏。
