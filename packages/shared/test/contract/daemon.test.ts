import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { daemonMessages, needsAck, parseDaemonMessage } from "../../src/contract/daemon.js";

const examplesDir = join(import.meta.dirname, "../../schema/daemon/v1/examples");
const examples = readdirSync(examplesDir).filter((name) => name.endsWith(".json"));

function load(name: string): Record<string, any> {
  return JSON.parse(readFileSync(join(examplesDir, name), "utf8"));
}

describe("daemon 协议样例", () => {
  it.each(examples)("%s 合契约", (name) => {
    const result = parseDaemonMessage(load(name));
    expect(result).toMatchObject({ ok: true });
  });

  it("每种消息至少有一个样例", () => {
    const covered = new Set(examples.map((name) => load(name).type));
    expect(daemonMessages.map((message) => message.type).filter((type) => !covered.has(type))).toEqual([]);
  });
});

describe("parseDaemonMessage", () => {
  it("信封缺字段时拒绝", () => {
    expect(parseDaemonMessage({ type: "ping", body: {} })).toMatchObject({ ok: false, reason: "invalid_envelope" });
  });

  it("不认识的消息类型单独报出来，方便回 ack 后忽略", () => {
    const frame = { ...load("ping.json"), type: "future.message" };
    expect(parseDaemonMessage(frame)).toMatchObject({ ok: false, reason: "unknown_type", type: "future.message" });
  });

  it("任务事件必须带 jobRef", () => {
    const frame = load("printer.event.job.started.json");
    delete frame.body.jobRef;
    expect(parseDaemonMessage(frame)).toMatchObject({ ok: false, reason: "invalid_body" });
  });

  it("不认识的事件类型算消息体不合契约", () => {
    const frame = load("printer.event.job.started.json");
    frame.body.kind = "job.teleported";
    expect(parseDaemonMessage(frame)).toMatchObject({ ok: false, reason: "invalid_body" });
  });

  it("不在清单里的命令类型不合契约", () => {
    const frame = load("command.refresh.json");
    frame.body.kind = "gcode.raw";
    expect(parseDaemonMessage(frame)).toMatchObject({ ok: false, reason: "invalid_body" });
  });

  it("多出来的字段被忽略", () => {
    const frame = load("printer.snapshot.offline.json");
    frame.body.addedInLaterVersion = 1;
    expect(parseDaemonMessage(frame)).toMatchObject({ ok: true });
  });

  it("快照不用确认，事件和命令要确认", () => {
    expect(needsAck("printer.snapshot")).toBe(false);
    expect(needsAck("printer.event")).toBe(true);
    expect(needsAck("command")).toBe(true);
  });
});
