"""daemon 的本机持久化：一个 SQLite 文件。

存的都是"重启后不能忘"的东西：还没被面板确认的消息、执行过的命令、不再开打的任务、
放到打印机上的文件清单、每台打印机的运行序号、还没结束的开打流程。
访问码、私钥、快照都不进这里。

写入都很小，直接在事件循环线程里同步做；每个公开方法是一个事务。
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

OUTBOX_MAX_ROWS = 10_000
OUTBOX_MAX_AGE = timedelta(hours=24)

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS outbox (
    position INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    ts TEXT NOT NULL,
    body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS commands (
    command_id TEXT PRIMARY KEY,
    expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS no_start (job_ref TEXT PRIMARY KEY, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS files (
    printer_id TEXT NOT NULL,
    name TEXT NOT NULL,
    job_ref TEXT NOT NULL,
    delete_pending INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (printer_id, name)
);
CREATE TABLE IF NOT EXISTS job_ends (
    job_ref TEXT PRIMARY KEY,
    printer_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    message_id TEXT NOT NULL,
    at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS run_seq (printer_id TEXT PRIMARY KEY, value INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS starts (
    job_ref TEXT PRIMARY KEY,
    printer_id TEXT NOT NULL,
    command_id TEXT NOT NULL,
    params TEXT NOT NULL,
    start_issued_at TEXT,
    started_seen INTEGER NOT NULL DEFAULT 0
);
"""


def _now() -> str:
    return datetime.now(UTC).isoformat()


@dataclass(frozen=True)
class OutboxMessage:
    id: str
    type: str
    ts: str
    body: dict[str, Any]

    def frame(self) -> dict[str, Any]:
        return {"id": self.id, "type": self.type, "ts": self.ts, "body": self.body}


@dataclass(frozen=True)
class PendingStart:
    job_ref: str
    printer_id: str
    command_id: str
    params: dict[str, Any]
    start_issued_at: str | None
    started_seen: bool


class Store:
    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(self.path, isolation_level=None)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA synchronous=FULL")
        self._db.executescript(SCHEMA)

    def close(self) -> None:
        self._db.close()

    @contextmanager
    def transaction(self):
        """把几步写入放进一个事务：要么都写，要么都不写。可以嵌套，只有最外层提交。"""
        if self._db.in_transaction:
            yield
            return
        self._db.execute("BEGIN IMMEDIATE")
        try:
            yield
        except BaseException:
            self._db.execute("ROLLBACK")
            raise
        self._db.execute("COMMIT")

    # 设置（面板地址、daemonId，不含秘密）

    def get_setting(self, key: str) -> str | None:
        row = self._db.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        return row[0] if row else None

    def set_setting(self, key: str, value: str) -> None:
        with self.transaction():
            self._db.execute("INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, value))

    # 发件箱：面板确认之前一直留着，重连后按原顺序重发

    def outbox_add(self, message: OutboxMessage) -> None:
        with self.transaction():
            self._db.execute(
                "INSERT INTO outbox (id, type, ts, body) VALUES (?, ?, ?, ?)",
                (message.id, message.type, message.ts, json.dumps(message.body)),
            )

    def outbox_pending(self) -> list[OutboxMessage]:
        rows = self._db.execute("SELECT id, type, ts, body FROM outbox ORDER BY position").fetchall()
        return [OutboxMessage(row[0], row[1], row[2], json.loads(row[3])) for row in rows]

    def outbox_ack(self, message_id: str) -> None:
        with self.transaction():
            self._db.execute("DELETE FROM outbox WHERE id = ?", (message_id,))

    def outbox_trim(self) -> int:
        """太旧或太多的消息丢掉最老的，返回丢了几条。"""
        cutoff = (datetime.now(UTC) - OUTBOX_MAX_AGE).isoformat()
        with self.transaction():
            dropped = self._db.execute("DELETE FROM outbox WHERE ts < ?", (cutoff,)).rowcount
            count = self._db.execute("SELECT COUNT(*) FROM outbox").fetchone()[0]
            if count > OUTBOX_MAX_ROWS:
                dropped += self._db.execute(
                    "DELETE FROM outbox WHERE position IN (SELECT position FROM outbox ORDER BY position LIMIT ?)",
                    (count - OUTBOX_MAX_ROWS,),
                ).rowcount
        return dropped

    # 命令台账：同一条命令最多执行一次，重启也一样

    def command_claim(self, command_id: str, expires_at: datetime) -> bool:
        """执行之前先登记。返回 False 说明这条命令已经登记过，不能再执行。"""
        with self.transaction():
            self._db.execute("DELETE FROM commands WHERE expires_at < ?", ((datetime.now(UTC) - timedelta(hours=24)).isoformat(),))
            try:
                self._db.execute("INSERT INTO commands VALUES (?, ?)", (command_id, expires_at.isoformat()))
            except sqlite3.IntegrityError:
                return False
        return True

    # "这个任务不再开打"

    def no_start_add(self, job_ref: str) -> None:
        with self.transaction():
            self._db.execute("INSERT OR IGNORE INTO no_start VALUES (?, ?)", (job_ref, _now()))

    def no_start_has(self, job_ref: str) -> bool:
        return self._db.execute("SELECT 1 FROM no_start WHERE job_ref = ?", (job_ref,)).fetchone() is not None

    # 文件清单：daemon 只删自己放上去的文件

    def file_add(self, printer_id: str, name: str, job_ref: str) -> None:
        with self.transaction():
            self._db.execute(
                "INSERT INTO files (printer_id, name, job_ref) VALUES (?, ?, ?) ON CONFLICT(printer_id, name) DO UPDATE SET job_ref = excluded.job_ref, delete_pending = 0",
                (printer_id, name, job_ref),
            )

    def file_job_ref(self, printer_id: str, name: str) -> str | None:
        row = self._db.execute("SELECT job_ref FROM files WHERE printer_id = ? AND name = ?", (printer_id, name)).fetchone()
        return row[0] if row else None

    def file_mark_delete(self, printer_id: str, job_ref: str) -> None:
        with self.transaction():
            self._db.execute("UPDATE files SET delete_pending = 1 WHERE printer_id = ? AND job_ref = ?", (printer_id, job_ref))

    def files_to_delete(self, printer_id: str) -> list[str]:
        rows = self._db.execute("SELECT name FROM files WHERE printer_id = ? AND delete_pending = 1", (printer_id,)).fetchall()
        return [row[0] for row in rows]

    def file_forget(self, printer_id: str, name: str) -> None:
        with self.transaction():
            self._db.execute("DELETE FROM files WHERE printer_id = ? AND name = ?", (printer_id, name))

    # 任务结束记录：一个任务只结束一次。面板确认之后也留着，
    # 这样打印机一直停在"打完"时，daemon 重启也不会把同一个结局再报一遍。

    def job_end_add(self, job_ref: str, printer_id: str, kind: str, message_id: str) -> None:
        with self.transaction():
            self._db.execute("INSERT INTO job_ends VALUES (?, ?, ?, ?, ?)", (job_ref, printer_id, kind, message_id, _now()))

    def job_end_kind(self, job_ref: str) -> str | None:
        row = self._db.execute("SELECT kind FROM job_ends WHERE job_ref = ?", (job_ref,)).fetchone()
        return row[0] if row else None

    # 运行序号：只增不减，先写盘再上报

    def run_seq(self, printer_id: str) -> int | None:
        row = self._db.execute("SELECT value FROM run_seq WHERE printer_id = ?", (printer_id,)).fetchone()
        return row[0] if row else None

    def run_seq_set(self, printer_id: str, value: int) -> None:
        with self.transaction():
            self._db.execute(
                "INSERT INTO run_seq VALUES (?, ?) ON CONFLICT(printer_id) DO UPDATE SET value = MAX(value, excluded.value)",
                (printer_id, value),
            )

    # 还没结束的开打流程

    def start_add(self, job_ref: str, printer_id: str, command_id: str, params: dict[str, Any]) -> None:
        with self.transaction():
            self._db.execute(
                "INSERT INTO starts (job_ref, printer_id, command_id, params) VALUES (?, ?, ?, ?)",
                (job_ref, printer_id, command_id, json.dumps(params)),
            )

    def start_mark_issued(self, job_ref: str) -> None:
        """"发起打印"：在发开打指令之前提交。有了它，就说不清指令发没发出去。"""
        with self.transaction():
            self._db.execute("UPDATE starts SET start_issued_at = ? WHERE job_ref = ?", (_now(), job_ref))

    def start_mark_seen(self, job_ref: str) -> None:
        with self.transaction():
            self._db.execute("UPDATE starts SET started_seen = 1 WHERE job_ref = ?", (job_ref,))

    def start_remove(self, job_ref: str) -> None:
        with self.transaction():
            self._db.execute("DELETE FROM starts WHERE job_ref = ?", (job_ref,))

    def start_get(self, job_ref: str) -> PendingStart | None:
        rows = self._starts("WHERE job_ref = ?", (job_ref,))
        return rows[0] if rows else None

    def starts_for(self, printer_id: str | None = None) -> list[PendingStart]:
        if printer_id is None:
            return self._starts("", ())
        return self._starts("WHERE printer_id = ?", (printer_id,))

    def _starts(self, where: str, args: tuple) -> list[PendingStart]:
        rows = self._db.execute(f"SELECT job_ref, printer_id, command_id, params, start_issued_at, started_seen FROM starts {where}", args).fetchall()
        return [PendingStart(row[0], row[1], row[2], json.loads(row[3]), row[4], bool(row[5])) for row in rows]

    # 打印机被移走

    def forget_printer(self, printer_id: str) -> None:
        with self.transaction():
            for table in ("files", "run_seq", "starts"):
                self._db.execute(f"DELETE FROM {table} WHERE printer_id = ?", (printer_id,))
