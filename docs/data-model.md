# PlateRelay 数据模型

本文件保存 PostgreSQL 16 / JSONB 的目标 DDL，不是已应用迁移，也不代表 M2–M5 已实现。原设计的 11 张表、外键、唯一约束、默认值与索引完整保留；本次只迁移文档，不修改字段或修复设计分歧。

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
    status VARCHAR(16) NOT NULL DEFAULT 'FREE', -- FREE, OCCUPIED
    description VARCHAR(128),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    operator_id UUID REFERENCES users(id),
    operator_display_name VARCHAR(64),
    action VARCHAR(64) NOT NULL,
    from_status VARCHAR(32),
    to_status VARCHAR(32),
    client_type VARCHAR(32) NOT NULL DEFAULT 'web_desktop',
    payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_jobs_submitter_status ON jobs(submitter_id, status);
CREATE INDEX idx_jobs_batch_sn ON jobs(batch_sn);
CREATE INDEX idx_jobs_status_approved ON jobs(status, approved_at);
CREATE INDEX idx_printers_serial ON printers(serial_number);
```

## 实施前待决

- **审计保留**：`job_audit_logs` 被描述为“不可变”，但 `job_id` 使用 `ON DELETE CASCADE`。需明确工单能否删除、“不可变”是否包含不可删除及留存要求；本次不擅自更改外键。
- **并发与故障豁免**：当前 DDL 没有明确表达“入库才释放额度”与硬件故障重排豁免，实施前须先完成 [并发语义裁决](domain.md#实施前待决)，不能从状态枚举推定额度规则。
- **耗材单位**：`unit_price_cny` 未注明每克/每卷，失败耗材公式也存在进度量纲与零分母问题；裁决在 [领域规范](domain.md#实施前待决) 维护，不从字段默认值猜测。
- **模块事务**：派单双状态回滚、核销和库位释放需满足原子性；具体事务所有权见 [架构待决项](architecture.md#实施前待决)，不能将外键关联当作事务实现。
- **防腐数据**：`oauth_raw_claims` 字段不授权保存队伍/赛道/分组信息，必须遵守 [身份防腐规则](domain.md#身份与权限)。

在对应切片落地时，应按已确认的领域契约核对模型与迁移；在有可验证的替代来源前，不删除本设计，也不将其标为数据库现状。
