#!/usr/bin/env bash
# 从 packages/shared 合成的 daemon 协议 Schema 生成 pydantic 模型。
# Schema 改了之后先跑 `pnpm --filter @platerelay/shared generate`，再跑这个脚本；CI 会检查两边一致。
set -euo pipefail
cd "$(dirname "$0")/../.."
uv run --project daemon datamodel-codegen \
  --input packages/shared/src/generated/daemon-protocol.bundle.json \
  --input-file-type jsonschema \
  --output daemon/src/platerelay_daemon/protocol/v1.py \
  --output-model-type pydantic_v2.BaseModel \
  --target-python-version 3.12 \
  --formatters ruff-format \
  --use-title-as-name \
  --use-standard-collections \
  --use-union-operator \
  --use-annotated \
  --field-constraints \
  --use-schema-description \
  --disable-timestamp \
  --custom-file-header '# 自动生成，不要手改。来源在 packages/shared/schema/daemon/v1/，用 daemon/scripts/generate_protocol.sh 重新生成。'

uv run --project daemon python - <<'PY'
import json
from pathlib import Path

manifest = json.loads(Path("packages/shared/schema/daemon/v1/messages.json").read_text(encoding="utf-8"))
lines = [
    "# 自动生成，不要手改。来源在 packages/shared/schema/daemon/v1/messages.json，用 daemon/scripts/generate_protocol.sh 重新生成。",
    "",
    f'PROTOCOL_VERSION = "{manifest["protocolVersion"]}"',
    "",
    "# 消息类型 -> (消息体的模型名, 方向, 要不要确认)",
    "MESSAGES: dict[str, tuple[str, str, bool]] = {",
]
for message in manifest["messages"]:
    lines.append(f'    "{message["type"]}": ("{message["title"]}", "{message["direction"]}", {message["needsAck"]}),')
lines.append("}")
Path("daemon/src/platerelay_daemon/protocol/_manifest.py").write_text("\n".join(lines) + "\n", encoding="utf-8")
PY
