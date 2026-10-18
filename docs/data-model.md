# PlateRelay 数据模型

本文件保存 PostgreSQL 16 / JSONB 的目标 DDL，不是已应用迁移，也不代表 M2–M5 已实现。物理交接设计在原有实体上扩充预占、任务级清台事实和持久化办理记录；本轮不执行迁移，不变更运行数据库。

业务含义以 [领域规范](domain.md) 为准，技术与事务边界见 [架构](architecture.md)，阶段状态见 [ROADMAP](../ROADMAP.md)。数据库/模型/迁移任务须同时读取这些约束，不能仅凭下面的 SQL 实现业务。

## 设计 DDL

```sql
-- 1. 用户表 (原生账号凭据，去队伍化)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(64) UNIQUE NOT NULL,
    hashed_password VARCHAR(255) NOT NULL,
    display_name VARCHAR(64) NOT NULL,
    avatar_url VARCHAR(512),
    role VARCHAR(32) NOT NULL DEFAULT 'submitter', -- submitter / operator / admin
    contact_phone VARCHAR(32),
    email VARCHAR(128),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. 外部 OAuth 绑定表 (解耦第三方 Passport/飞书)
CREATE TABLE user_oauth_bindings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(32) NOT NULL, -- hackathon_passport, feishu, github
    oauth_sub VARCHAR(128) NOT NULL,
    oauth_raw_claims JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_provider UNIQUE (user_id, provider),
    CONSTRAINT uq_provider_sub UNIQUE (provider, oauth_sub)
);

-- 3. 全局动态配置表
CREATE TABLE system_settings (
    key VARCHAR(64) PRIMARY KEY,
    value JSONB NOT NULL,
    description VARCHAR(255),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. 打印机台表
CREATE TABLE printers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(64) NOT NULL,
    serial_number VARCHAR(64) UNIQUE NOT NULL,
    model VARCHAR(32) NOT NULL, -- X1C, P1S, A1_MINI, MANUAL
    ip_address VARCHAR(45) NOT NULL,
    access_code VARCHAR(64),
    status VARCHAR(32) NOT NULL DEFAULT 'IDLE', -- IDLE, PREPARING, PRINTING, PAUSED, CLEARING_REQUIRED, UNMANAGED_PRINTING, OFFLINE, ERROR
    bed_width_mm INT NOT NULL DEFAULT 256,
    bed_depth_mm INT NOT NULL DEFAULT 256,
    bed_height_mm INT NOT NULL DEFAULT 256,
    nozzle_diameter_mm NUMERIC(3, 2) NOT NULL DEFAULT 0.40,
    rated_power_w INT NOT NULL DEFAULT 150,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_telemetry_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. 线盘耗材库
CREATE TABLE spools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tray_uuid VARCHAR(64) UNIQUE,
    brand VARCHAR(64) NOT NULL DEFAULT 'Bambu',
    material VARCHAR(32) NOT NULL, -- PLA, PETG, ABS, TPU
    color_hex VARCHAR(8) NOT NULL,
    initial_weight_g NUMERIC(8, 2) NOT NULL DEFAULT 1000.0,
    current_weight_g NUMERIC(8, 2) NOT NULL DEFAULT 1000.0,
    unit_price_cny NUMERIC(8, 2) NOT NULL DEFAULT 100.0,
    rfid_raw_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. 打印机料槽挂载表 (AMS / 外部料架)
CREATE TABLE printer_spool_slots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    printer_id UUID NOT NULL REFERENCES printers(id) ON DELETE CASCADE,
    slot_index INT NOT NULL DEFAULT 0, -- 0-3 对应 AMS Tray 0~3, -1 为外挂
    spool_id UUID REFERENCES spools(id) ON DELETE SET NULL,
    ams_reported_remain_percent INT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_printer_slot UNIQUE (printer_id, slot_index)
);

-- 7. 储物盒库位表
CREATE TABLE storage_bins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bin_code VARCHAR(32) UNIQUE NOT NULL, -- 如 BIN-A01, BIN-OVERFLOW
    is_overflow_pool BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(16) NOT NULL DEFAULT 'FREE', -- 实体盒 FREE / RESERVED / OCCUPIED；溢出区域 POOL
    description VARCHAR(128),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_bin_kind_status CHECK (
        (is_overflow_pool AND status = 'POOL')
        OR (NOT is_overflow_pool AND status IN ('FREE', 'RESERVED', 'OCCUPIED'))
    )
);

-- 8. 工单主表 (多盘独立子工单，去队伍化)
CREATE TABLE jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_sn VARCHAR(32) UNIQUE NOT NULL, -- 单盘唯一编号
    batch_sn VARCHAR(32) NOT NULL, -- 同一批次上传工程的共享流水号
    submitter_id UUID NOT NULL REFERENCES users(id),
    assigned_printer_id UUID REFERENCES printers(id),
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING_REVIEW',
    storage_bin_id UUID REFERENCES storage_bins(id),
    target_printer_model VARCHAR(32) NOT NULL, -- 切片锁定的机型
    plate_index INT NOT NULL DEFAULT 1,
    plate_name VARCHAR(64),
    estimated_duration_sec INT,
    estimated_filament_grams NUMERIC(8, 2),
    actual_filament_grams NUMERIC(8, 2),
    estimated_cost_cny NUMERIC(8, 2),
    finish_snapshot_url VARCHAR(512),
    storage_photo_url VARCHAR(512),
    reject_reason TEXT,
    failure_type VARCHAR(32), -- HARDWARE_FAULT, MODEL_DEFECT
    approved_at TIMESTAMPTZ, -- 用于默认 FIFO 排序
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. 工单耗材消耗明细关联表 (多色分账)
CREATE TABLE job_spool_usages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    spool_id UUID REFERENCES spools(id) ON DELETE SET NULL,
    slot_index INT NOT NULL,
    material VARCHAR(32) NOT NULL,
    color_hex VARCHAR(8) NOT NULL,
    estimated_grams NUMERIC(8, 2) NOT NULL DEFAULT 0.0,
    actual_grams NUMERIC(8, 2) NOT NULL DEFAULT 0.0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. 审批与流转过程文件归档表
CREATE TABLE job_artifacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    artifact_type VARCHAR(32) NOT NULL, -- GCODE_3MF, PLATE_PREVIEW, FINISH_SNAPSHOT, STORAGE_PHOTO
    file_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(512) NOT NULL, -- 对象存储 Key
    file_size_bytes BIGINT NOT NULL,
    uploader_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. 不可变操作审计流
CREATE TABLE job_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE, -- 野生任务审计无 job_id，必须关联物理任务
    operator_id UUID REFERENCES users(id),
    operator_display_name VARCHAR(64),
    action VARCHAR(64) NOT NULL,
    from_status VARCHAR(32),
    to_status VARCHAR(32),
    client_type VARCHAR(32) NOT NULL DEFAULT 'web_desktop',
    payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. 一次物理执行的身份、可信终态与清台事实，不以遥测 IDLE 代替清台
CREATE TABLE printer_task_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    printer_id UUID NOT NULL REFERENCES printers(id),
    job_id UUID REFERENCES jobs(id),
    execution_key VARCHAR(128) NOT NULL, -- Panel/HAL 关联的一次执行标识，不是可复用文件名
    origin VARCHAR(16) NOT NULL CHECK (origin IN ('MANAGED', 'UNMANAGED')),
    terminal_result VARCHAR(16) CHECK (terminal_result IN ('SUCCESS', 'FAILED', 'ABORTED')),
    finished_at TIMESTAMPTZ,
    cleared_at TIMESTAMPTZ,
    cleared_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_printer_execution UNIQUE (printer_id, execution_key),
    CONSTRAINT ck_run_origin CHECK (
        (origin = 'MANAGED' AND job_id IS NOT NULL)
        OR (origin = 'UNMANAGED' AND job_id IS NULL)
    ),
    CONSTRAINT ck_run_terminal CHECK ((terminal_result IS NULL) = (finished_at IS NULL)),
    CONSTRAINT ck_run_clearance CHECK (
        (cleared_at IS NULL AND cleared_by IS NULL)
        OR (cleared_at IS NOT NULL AND cleared_by IS NOT NULL AND finished_at IS NOT NULL)
    )
);

ALTER TABLE printers ADD COLUMN current_run_id UUID REFERENCES printer_task_runs(id);

-- 13. 一次办理尝试及其库位/袋占用；取消后可重新办理，完成后只返回原结果
CREATE TABLE physical_handoffs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES printer_task_runs(id),
    kind VARCHAR(16) NOT NULL CHECK (kind IN ('NORMAL', 'EXCEPTION')),
    status VARCHAR(16) NOT NULL DEFAULT 'IN_PROGRESS'
        CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
    operator_id UUID NOT NULL REFERENCES users(id),
    version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
    storage_bin_id UUID REFERENCES storage_bins(id),
    location_kind VARCHAR(16) CHECK (location_kind IN ('BIN', 'OVERFLOW')),
    overflow_package_code VARCHAR(64) UNIQUE
        CHECK (overflow_package_code IS NULL OR length(trim(overflow_package_code)) > 0),
    storage_photo_artifact_id UUID REFERENCES job_artifacts(id),
    verification_method VARCHAR(16) CHECK (verification_method IN ('SCAN', 'ADMIN_MANUAL')),
    verified_location_code VARCHAR(64),
    manual_verified_by UUID REFERENCES users(id),
    manual_verification_reason TEXT,
    bed_cleared_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    material_removed_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    unmanaged_consumables_checked BOOLEAN NOT NULL DEFAULT FALSE,
    disposition TEXT,
    cancellation_location_empty_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    cancellation_reason TEXT,
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    released_at TIMESTAMPTZ, -- 取消释放预占，或正常取件释放已占用物料位置
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_handoff_location CHECK (
        (location_kind IS NULL AND storage_bin_id IS NULL AND overflow_package_code IS NULL)
        OR (location_kind IS NOT NULL AND (
            (location_kind = 'BIN' AND storage_bin_id IS NOT NULL AND overflow_package_code IS NULL)
            OR (location_kind = 'OVERFLOW' AND storage_bin_id IS NOT NULL AND overflow_package_code IS NOT NULL)
        ))
    ),
    CONSTRAINT ck_exception_no_stock CHECK (
        kind <> 'EXCEPTION' OR location_kind IS NULL
    ),
    CONSTRAINT ck_manual_verification CHECK (
        verification_method IS DISTINCT FROM 'ADMIN_MANUAL'
        OR (manual_verified_by IS NOT NULL AND COALESCE(length(trim(manual_verification_reason)), 0) > 0)
    ),
    CONSTRAINT ck_handoff_completed_time CHECK (
        (status = 'COMPLETED') = (completed_at IS NOT NULL)
    ),
    CONSTRAINT ck_handoff_cancelled_time CHECK (
        (status = 'CANCELLED') = (cancelled_at IS NOT NULL)
    ),
    CONSTRAINT ck_normal_handoff_completion CHECK (
        status <> 'COMPLETED' OR kind <> 'NORMAL'
        OR (location_kind IS NOT NULL AND storage_photo_artifact_id IS NOT NULL
            AND verification_method IS NOT NULL AND COALESCE(length(trim(verified_location_code)), 0) > 0
            AND bed_cleared_confirmed)
    ),
    CONSTRAINT ck_exception_handoff_completion CHECK (
        status <> 'COMPLETED' OR kind <> 'EXCEPTION'
        OR (material_removed_confirmed AND bed_cleared_confirmed AND COALESCE(length(trim(disposition)), 0) > 0)
    ),
    CONSTRAINT ck_handoff_cancellation CHECK (
        status <> 'CANCELLED'
        OR (cancellation_location_empty_confirmed AND released_at IS NOT NULL
            AND COALESCE(length(trim(cancellation_reason)), 0) > 0)
    )
);

CREATE UNIQUE INDEX uq_handoff_active_run ON physical_handoffs(run_id)
    WHERE status = 'IN_PROGRESS';
CREATE UNIQUE INDEX uq_handoff_completed_run ON physical_handoffs(run_id)
    WHERE status = 'COMPLETED';
CREATE UNIQUE INDEX uq_handoff_live_bin ON physical_handoffs(storage_bin_id)
    WHERE location_kind = 'BIN' AND status IN ('IN_PROGRESS', 'COMPLETED') AND released_at IS NULL;

ALTER TABLE job_artifacts
    ADD COLUMN physical_run_id UUID REFERENCES printer_task_runs(id),
    ADD COLUMN handoff_id UUID REFERENCES physical_handoffs(id),
    ADD COLUMN captured_at TIMESTAMPTZ;

ALTER TABLE job_audit_logs
    ADD COLUMN physical_run_id UUID REFERENCES printer_task_runs(id),
    ADD COLUMN handoff_id UUID REFERENCES physical_handoffs(id),
    ADD CONSTRAINT ck_audit_subject CHECK (job_id IS NOT NULL OR physical_run_id IS NOT NULL);

CREATE INDEX idx_jobs_submitter_status ON jobs(submitter_id, status);
CREATE INDEX idx_jobs_batch_sn ON jobs(batch_sn);
CREATE INDEX idx_jobs_status_approved ON jobs(status, approved_at);
CREATE INDEX idx_printers_serial ON printers(serial_number);
```

## 交接持久化约束

- `printer_task_runs` 区分一次实际执行与业务工单；同一工单重打必须关联新的执行，野生任务不伪造 `job_id`。`current_run_id` 必须属于该机台，旧终态/清台请求不能覆盖当前任务；终态后未有 `cleared_at` 的任务继续保持清台锁，不能只检查当前指针而漏掉旧锁。
- `physical_handoffs` 是持久化办理/恢复及提交幂等的身份，不是过期即删除的前端会话；进行中无自动租约到期。唯一索引阻止同次物理执行的并行办理与重复完成，实体盒预占至取件结束始终保持独占。已完成的正常交接只有取件核销才写 `released_at`；不能用释放占用字段绕过取消确认。
- 原子预占同时更新实体盒 `FREE` → `RESERVED` 和本交接位置；正常提交再转 `OCCUPIED`。`location_kind` 必须与库位的 `is_overflow_pool` 一致；溢出区域使用 `POOL`，不参与实体盒抢占，每个袋用唯一 `overflow_package_code` 区分。正常工单的 `jobs.storage_bin_id` 及照片地址只在最终交接事务写入。
- 每个变更核验 `operator_id`、期望 `version` 与办理权限；接管记录原/新办理人、原因、时间并推进版本，使旧请求失效。证据关联本次物理任务与交接；更换目标位置使原位置核对/入库照失效，必须重新采集。接管可保留已保存证据，但接管者须重新确认本人实际完成的清台声明。
- SQL 之外的同事务校验不可省略：正常分支必须关联成功终态和待入库工单；异常分支必须匹配失败/中止/野生任务。扫码/人工核对目标必须等于实体盒码或唯一袋码；`job_artifacts.physical_run_id` / `handoff_id` 关联本次任务/交接，`captured_at` 标明拍摄时间，入库资产必须已上传保存、类型正确且工单匹配。野生任务完成需 `unmanaged_consumables_checked`，详细耗材核对值写入审计上下文。
- `ADMIN_MANUAL` 仅允许管理员人工核对目标码，身份/原因必须填写；其他门禁不变。所有领取、预占、核对、接管、取消、正常/异常完成写审计，记录操作人名称快照、版本前后值和结果；无工单的异常审计使用 `physical_run_id`，不捏造工单。
- 字段、外键、局部索引只表达可声明约束，不自动完成[交接事务](architecture.md#交接事务)。提交时锁定并核验工单/执行/交接/库位的关联，重复完成读回原结果；失败不部分写入库位、清台事实或节点 A 额度。物理行为、对象存储与通知不在 SQL 原子性范围内。

## 实施前待决

- **审计保留**：`job_audit_logs` 被描述为“不可变”，但 `job_id` 使用 `ON DELETE CASCADE`。需明确工单能否删除、“不可变”是否包含不可删除及留存要求；本次不擅自更改外键。
- **故障豁免与多盘限额**：正常成功工单等待入库仍持有额度、正常交接提交时释放已经确认；硬件故障重排豁免及多盘提单边界仍见 [领域待决](domain.md#实施前待决)。
- **耗材单位**：`unit_price_cny` 未注明每克/每卷，失败耗材公式也存在进度量纲与零分母问题；裁决在 [领域规范](domain.md#实施前待决) 维护，不从字段默认值猜测。
- **派单事务**：交接事务所有权已明确，派单双状态回滚与硬件实际状态的协调仍见 [架构待决项](architecture.md#实施前待决)，不能将外键关联当作事务实现。
- **防腐数据**：`oauth_raw_claims` 字段不授权保存队伍/赛道/分组信息，必须遵守 [身份防腐规则](domain.md#身份与权限)。

在对应切片落地时，应按已确认的领域契约核对模型与迁移；在有可验证的替代来源前，不删除本设计，也不将其标为数据库现状。
