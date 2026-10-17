# PlateRelay 实施路线图 (ROADMAP.md)

本文档作为 PlateRelay 项目的阶段性垂直切片（Vertical Slice）工程落地指南，基于 `agent.md` 最高架构契约推进。
本项目严格执行**生产级软件工程规范（Production-Grade Engineering）**：拒绝桩函数、拒绝未经跑通的代码、拒绝随意引入未授权第三方依赖。每个里程碑必须具备本地真实可运行的端到端冒烟测试（Smoke Run）作为准入闸门。

---

## 阶段演进概览

| 里程碑 | 核心主题 | 架构边界 | 生产级准入标准 (Definition of Done) | 当前状态 |
| :--- | :--- | :--- | :--- | :--- |
| **Milestone 1** | **多机台只读监控大屏** | Panel (FastAPI + Vue 3 前端) ↔ Daemon (HAL 仿真 + 真实X2D被动挂载) | 双端独立常驻进程拉起，通过认证 WS 管道实现 1s 遥测推流，前端大屏动态呈现高仿真动效，断网自动标记 OFFLINE，重连秒级自愈。 | **进行中 (In Progress)** |
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
  - 当前界面按 [Figma 完整 Dashboard 画板 `7:356`](https://www.figma.com/design/AAcikiA6Rj7N9WMtki3Ttd/PlateRelay-Desktop?node-id=7-356) 复制，暂不沿用旧版大屏的布局约束：
    - 原始画板 1680×1096，200px 侧栏、三张指标卡、三列五张设备卡片；按可用视口宽度整体等比适配，不重新排列卡片。
    - 五张卡片分别保留打印、断料、AMS 阻断、待清台和离线的原稿内容与不同高度；包含原始摄像头示例图、AMS 圆弧、波浪进度条、底部告警与离线模糊遮罩。
    - Figma 原始图像、SVG 和所需字体本地托管，字体授权文本一并保留；不使用设计截图替代 DOM，不在运行时请求临时 Figma 资源地址。
    - 当前为设计稿内容展示：指标、设备名、发起人、画面和时间均来自原稿，不连接模拟 Daemon，也不宣称其为实时机群数据。
    - 设备搜索、视图筛选和原稿导航可本地操作；“申请打印”按原稿 `70:581` 展示，不增加设计中不存在的表单。
  - 后端遥测接口与 Daemon 保留原有契约；上一版为卡片新增的可选遥测字段已撤销。本地构建后由 FastAPI 在 `http://127.0.0.1:8000` 托管。

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
