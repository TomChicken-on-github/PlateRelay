import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { daemonMessages, daemonProtocolSchema, daemonProtocolVersion } from "../generated/daemon-protocol-schema.js";
import type { DaemonMessageBodies, DaemonMessageType, Envelope } from "../generated/daemon-protocol.js";
import { toIssues, type ContractIssue } from "./http.js";

export type * from "../generated/daemon-protocol.js";
export { daemonMessages, daemonProtocolVersion };

/** 一条已经按契约校验过的消息。 */
export type DaemonMessage = {
  [T in DaemonMessageType]: Omit<Envelope, "type" | "body"> & { type: T; body: DaemonMessageBodies[T] };
}[DaemonMessageType];

export type ParsedDaemonMessage =
  | { ok: true; message: DaemonMessage }
  /** 信封本身不对，连 id 都不可信。 */
  | { ok: false; reason: "invalid_envelope"; issues: ContractIssue[] }
  /** 不认识的消息类型：回 ack 后忽略，不算错。 */
  | { ok: false; reason: "unknown_type"; id: string; type: string }
  /** 消息体不合契约：回 ack 并记日志，不处理，免得一条坏消息卡住整个队列。 */
  | { ok: false; reason: "invalid_body"; id: string; type: string; issues: ContractIssue[] };

const addFormats = (addFormatsModule as unknown as { default?: typeof addFormatsModule }).default ?? addFormatsModule;
const schemaId = daemonProtocolSchema.$id as string;
const titles = new Map<string, string>(daemonMessages.map((message) => [message.type, message.title]));

let ajv: Ajv2020 | undefined;
const validators = new Map<string, ValidateFunction>();

function validatorFor(title: string): ValidateFunction {
  let validate = validators.get(title);
  if (!validate) {
    if (!ajv) {
      ajv = new Ajv2020({ strict: false, allErrors: true });
      addFormats(ajv);
      ajv.addSchema(daemonProtocolSchema);
    }
    validate = ajv.compile({ $ref: `${schemaId}#/$defs/${title}` });
    validators.set(title, validate);
  }
  return validate;
}

/** 校验控制通道上收到的一帧（已经从 JSON 解析出来的值）。两边收到消息都先过这一步。 */
export function parseDaemonMessage(frame: unknown): ParsedDaemonMessage {
  const envelope = validatorFor("Envelope");
  if (!envelope(frame)) return { ok: false, reason: "invalid_envelope", issues: toIssues(envelope.errors) };
  const { id, type, body } = frame as Envelope;
  const title = titles.get(type);
  if (!title) return { ok: false, reason: "unknown_type", id, type };
  const validate = validatorFor(title);
  if (!validate(body)) return { ok: false, reason: "invalid_body", id, type, issues: toIssues(validate.errors) };
  return { ok: true, message: frame as DaemonMessage };
}

/** 这种消息要不要对方回 ack。 */
export function needsAck(type: DaemonMessageType): boolean {
  return daemonMessages.find((message) => message.type === type)?.needsAck ?? false;
}
