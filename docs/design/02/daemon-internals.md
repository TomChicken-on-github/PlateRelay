# 2.5 · daemon 内部结构

> 属于 [文档 2](README.md)。编号 `DAE-`。来自追问 Q250–Q260（2026-11-07）。对外的消息看 [daemon-protocol.md](daemon-protocol.md)（MSG-），适配器接口看 [interfaces.md](interfaces.md)（IF-ADP）；本文只写 daemon 进程里面怎么分块、状态放哪、怎么打包和测试，不新增业务规则。

## 1. 进程模型（DAE-PROC）

| 编号 | 约定 |
| --- | --- |
| DAE-PROC-01 | 一个 daemon 是**一个进程**，asyncio 事件循环（Q250）。 |
| DAE-PROC-02 | 每台分配到的打印机一个受监督的任务（printer worker）。它抛异常只重启它自己，按 MSG-AUTH-06 同样的退避重连，不影响别的打印机。 |
| DAE-PROC-03 | 阻塞的库（pybambu 的 paho 线程、ftplib）放进线程池，每台打印机最多占 2 个线程，回调转回事件循环再处理。 |
| DAE-PROC-04 | 实况转推和截帧用 ffmpeg 子进程（DAE-MED），一个卡死只影响那一路流。 |
| DAE-PROC-05 | 整个进程挂了由服务管理器拉起：systemd、Windows 服务（WinSW）、Docker `restart: unless-stopped`。命令台账在硬盘上（DAE-STO），重启不会重复执行。 |
| DAE-PROC-06 | 以后真需要更强的隔离（某个驱动泄漏内存），再把 printer worker 改成子进程，IF-ADP 接口不变。v1 不做。 |

## 2. 模块（DAE-MOD）

```
platerelay_daemon/
  link/         和面板的连接
  store/        本机持久化（SQLite）
  printers/     每台打印机一个 worker：业务判断都在这里
  jobs/         job.start 流水线、传文件中停止、结束收尾
  media/        实况转推、JPEG 帧、抓拍调度和上传队列
  discovery/    被动 SSDP
  adapter_api/  适配器接口、标准类型、一致性测试（IF-ADP）
  adapters/
    bambu/      拓竹，内置 pybambu（_vendor/）
    fake/       模拟打印机（DAE-TST-01）
  schema/       从 packages/shared/schema/daemon/v1 生成的 pydantic 模型（MSG-SCH-02）
  cli/          run、doctor、status
```

| 编号 | 模块 | 负责 | 对应 |
| --- | --- | --- | --- |
| DAE-MOD-01 | `link` | wss 连接、挑战认证、心跳、重连退避、和面板的时钟差、消息信封、发件箱收发、按 `id` 去重、按 Schema 校验；MSG-HTTP 的下载和上传客户端 | MSG-AUTH、MSG-ENV、MSG-HB、MSG-HTTP、MSG-SCH-03 |
| DAE-MOD-02 | `store` | DAE-STO 的全部内容；所有写入走一个写线程 | MSG-ENV-03、MSG-ENV-04、MSG-JOBREF-02、R-CMD-08 |
| DAE-MOD-03 | `printers` | 拿适配器会话；合并后的快照按 1 次/秒限流发出；编 `bootId` / `seq`；判断系统任务还是外部任务；比较前后两份快照合成 `job.*` 事件并判 `beforeStart`；写结束记录；命令按白名单、过期时间、命令台账执行；对账时提供痕迹 | MSG-SNAPSHOT、MSG-EVT、MSG-CMD-WL、MSG-CMD-TTL、MSG-JOBREF、MSG-RECON |
| DAE-MOD-04 | `jobs` | 下载排队 → 下载 → 核对 → FTPS 上传 → 开打前检查 → 开打；传文件期间的停止；任务结束后删 3mf、收延时摄影、拍结束照片 | MSG-CMD-START、F-PRT-10、F-PRT-11、R-CAM-11 |
| DAE-MOD-05 | `media` | 按需拉流转推、JPEG 帧转发、抓拍频率、错峰、单一上传队列 | MSG-MEDIA、MSG-SNAP |
| DAE-MOD-06 | `discovery` | 被动监听，只听不发，汇总后发 `discovery.report` | F-PRT-12、MSG-DISC |
| DAE-MOD-07 | `adapter_api` / `adapters` | 见 DAE-ADP | IF-ADP |

**依赖方向**：`link` ← `printers` / `jobs` / `media` / `discovery` → `adapter_api` ← `adapters`；`store` 被 `link`、`printers`、`jobs` 共用。`adapters` 只能 import `adapter_api`，`adapter_api` 不 import daemon 的其他部分，CI 用 import-linter 检查（Q251）。

## 3. 适配器和核心的分工（DAE-ADP）

| 编号 | 约定 |
| --- | --- |
| DAE-ADP-01 | 适配器放在 daemon 包里，跟 daemon 一起安装、一起定版本；v1 不用 entry point，"daemon 版本"就是"驱动版本"（Q251）。有了第二个品牌或社区驱动，再把 `adapter_api` 拆成独立的包。 |
| DAE-ADP-02 | **适配器只说"这台打印机现在是什么样"**（Q258）：协议收发、增量合并成完整状态、原始状态换算成标准状态（IF-ADP-04 的左列）、HMS 等换算成 `ActiveError`、`deviceBoot`、当前任务名、存储里的文件列表，以及执行 start / stop / 控制这些动作。它不认识 `jobRef`，只认识文件名和任务名。 |
| DAE-ADP-03 | **业务判断都在核心的 printer worker**：任务名和文件名对文件清单和 MSG-ASSIGN（MSG-JOBREF-02）；合成 `job.started`、`job.finished`、`job.failed`、`job.cancelled`，判 `beforeStart`；结束记录；`bootId` / `seq`；限流；命令台账和"不再开打"标记。这些规则只写一次，所有品牌共用，一致性测试只测适配器报的状态准不准。 |

## 4. 本机持久化（DAE-STO）

| 编号 | 约定 |
| --- | --- |
| DAE-STO-01 | 一个 SQLite 文件，Python 自带的 sqlite3，WAL，`synchronous=FULL`（Q252）。 |
| DAE-STO-02 | 存：发件箱（MSG-ENV-03）、执行过的命令 ID 到过期为止（MSG-ENV-04）、"这个 jobRef 不再开打"标记（MSG-CMD-START）、文件清单（MSG-JOBREF-02）、任务结束记录到面板 `ack`（MSG-RECON）、结束照片待上传记录到面板回 `201`（MSG-HTTP-05，Q319）、文件缓存索引（DAE-STO-05）、面板地址和 `daemonId`。 |
| DAE-STO-03 | 要么都写、要么都不写的放进一个事务：任务结束时的结束记录 + 发件箱里的结束事件 + 清单里"这个 3mf 待删" + 结束照片待上传记录（`jobRef`、拍摄时间、文件路径、sha256；拍照失败也记一条，标明没拍到）。照片 JPEG 在提交事务之前先写到本机目录（写临时文件、fsync、改名），所以重启后要么两样都在、要么都不在。收到 MSG-HTTP-05 的 `201` 才删照片和记录，结束事件被 `ack` 不算（Q319）；收到命令时的命令 ID + 必要的"不再开打"标记，**在执行之前提交**。 |
| DAE-STO-04 | 不进 SQLite：私钥照 MSG-ENR 步骤 3 单独存（Linux / Docker 0600 文件，Windows DPAPI）；访问码只在内存（INV-07）；快照只在内存留最新一份；抓拍不落盘（结束照片除外，见 DAE-STO-03）。 |
| DAE-STO-05 | 打印文件缓存：按 sha256 存，总量上限 CFG-CMD-07（默认 2 GB），满了删最久没用过的；正在用的不删；每次用之前重新核对 sha256（Q255）。**不预取**：v1 不预分配打印机（Q249），排队的单不知道派给谁，还可能被修改或取消。 |

## 5. 传文件排队（DAE-XFER）

| 编号 | 约定 |
| --- | --- |
| DAE-XFER-01 | 一个 daemon 同时最多下载 CFG-CMD-06 个文件（默认 2），其余排队；往打印机的 FTPS 上传每台各自进行（Q254）。 |
| DAE-XFER-02 | 进了下载队列就算开始执行：已回 `accepted`、命令 ID 已落盘，不会因排队过期（MSG-CMD-TTL）。CFG-CMD-02 的单次超时从真正开始传起算。 |
| DAE-XFER-03 | 缓存里已有同一 sha256 的文件，跳过下载，直接上传。 |
| DAE-XFER-04 | 进度步骤是 `queued` → `download` → `upload`，通过 `command.result.data` 报给面板，前端能显示"排队中"。 |

## 6. 媒体（DAE-MED）

| 编号 | 约定 |
| --- | --- |
| DAE-MED-01 | H.264 机型：每路正在推的流一个 ffmpeg 子进程，拉 RTSPS，`-c copy` 推 SRT，连不上退回 RTSPS（MSG-MEDIA-02，Q253）。断了由 `media` 重拉。 |
| DAE-MED-02 | 推流期间的截帧（MSG-SNAP-03）在同一个 ffmpeg 里多开一路输出，`-skip_frame nokey` 只解关键帧。 |
| DAE-MED-03 | JPEG 帧机型（P1、A1）不用 ffmpeg，用适配器自己的实现，走 MSG-MEDIA-03。 |
| DAE-MED-04 | 延时摄影不转码（F-PRT-10），不经过 ffmpeg。 |
| DAE-MED-05 | ffmpeg 跟着安装包走，要带 libsrt：Windows 和原生 Linux 用静态构建（如 BtbN），Docker 用发行版的包。每个构建带不带 libsrt 实现时核实，`doctor` 会检查。 |

## 7. 打包与安装（DAE-PKG）

| 编号 | 约定 |
| --- | --- |
| DAE-PKG-01 | 原生安装（Windows、Linux、树莓派）用 uv：安装脚本装 uv，uv 下载固定版本的独立 Python（python-build-standalone），按 `uv.lock` 装依赖；daemon 的 wheel 和 ffmpeg 从发布页下载，核对 sha256（F-DMN-07，Q256）。不用系统 Python，也不用 PyInstaller（Windows 杀毒误报、arm64 要单独构建）。 |
| DAE-PKG-02 | 服务：Linux 是 systemd unit；Windows 是 WinSW 注册的服务。Windows 服务用什么账户运行（影响 DPAPI 用机器范围还是用户范围）实现时定。 |
| DAE-PKG-03 | Docker：基础镜像 `python:3.12-slim`，依赖按同一个 `uv.lock` 装，buildx 出 amd64 和 arm64，发布到 GHCR，每个版本固定 tag，面板给的命令带镜像 digest。非 root 运行，`network_mode: host`（F-DMN-06），`/data` 卷放 SQLite、私钥、文件缓存。面板生成 compose 片段，注册令牌走环境变量 `PLATERELAY_ENROLL_TOKEN`。 |
| DAE-PKG-04 | Docker 只支持 Linux 主机，含树莓派。Windows 和 macOS 的 Docker Desktop 跑在虚拟机里，host 网络和组播到不了局域网，不支持；Windows 一律装原生服务（Q257）。 |
| DAE-PKG-05 | 升级只由人执行（NG-10、F-DMN-07）：原生是面板给的命令，换 wheel 和锁文件后重启服务；Docker 是 `docker compose pull && docker compose up -d`。文档写明不要用 Watchtower 一类自动更新。 |

## 8. 排查（DAE-OPS）

| 编号 | 约定 |
| --- | --- |
| DAE-OPS-01 | daemon 本机没有网页，界面就是面板（Q259）。 |
| DAE-OPS-02 | 日志是结构化 JSON：systemd 进 journald，Windows 写滚动文件，Docker 写标准输出。自动打码访问码、令牌、签名（INV-07）；每条带上有关的 `printerId`、`commandId`、`jobRef`。 |
| DAE-OPS-03 | `platerelay-daemon doctor`：面板能不能连、时钟差、私钥能不能读、ffmpeg 在不在、带不带 libsrt、磁盘剩余、每台打印机 MQTT 和 FTPS 端口通不通。查打印机只做 TCP 连通，不发任何命令。 |
| DAE-OPS-04 | `platerelay-daemon status`：只读打开 SQLite，显示发件箱积压、最近的命令、每台打印机的连接状态。 |

## 9. 测试（DAE-TST）

| 编号 | 约定 |
| --- | --- |
| DAE-TST-01 | `adapters/fake` 是一台**模拟打印机**，有完整状态机：收下 start 后走准备、打印、完成，时间可加速；暂停、继续、停止、跳过零件都有反应。脚本可注入：报错、断料、断线、断电重启（`deviceBoot` 变）、开打前失败、固件拒绝、FTPS 传到一半断开（Q260）。 |
| DAE-TST-02 | 回放模式：用录下来的真机报文（X2D 等）测拓竹适配器的状态换算（IF-ADP-08、MSG-SCH-04）。 |
| DAE-TST-03 | 假面板：按 JSON Schema 收发消息，daemon 的单元和集成测试对着它跑。 |
| DAE-TST-04 | 崩溃注入：在"命令 ID 写盘"和"真正执行"之间杀进程，重启后断言没执行两次；在"结束记录写盘"之后杀进程，断言重连后补上了事件（DAE-STO-03、R-CMD-08）。 |
| DAE-TST-05 | 面板联调用真 daemon + fake 适配器，可以起多台模拟打印机；面板那边不另写假 daemon，只有一条代码路径。 |
| DAE-TST-06 | 真机上的控制命令只在用户开发驱动、当时明确同意时才验证（项目开发规则）。 |
