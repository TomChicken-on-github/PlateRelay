import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { openapiDocument } from "../generated/openapi-document.js";
import { operations, type OperationId } from "../generated/operations.js";

export { operations, type OperationId };

/** 一条校验错误：哪个字段、违反了什么。 */
export interface ContractIssue {
  path: string;
  code: string;
  params: Record<string, unknown>;
}

export type ContractResult = { ok: true } | { ok: false; issues: ContractIssue[] };

const DOCUMENT_ID = "https://platerelay.dev/schema/openapi";

// ajv-formats 是 CommonJS 包，默认导出在不同的模块解析方式下位置不一样。
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ?? addFormatsModule) as (ajv: Ajv2020) => unknown;

let ajv: Ajv2020 | undefined;
const bodyValidators = new Map<OperationId, ValidateFunction | null>();

function getAjv(): Ajv2020 {
  if (!ajv) {
    // 契约里有接口文档自己的关键字（如 x-requires），所以不开严格模式。
    ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    ajv.addSchema(openapiDocument, DOCUMENT_ID);
  }
  return ajv;
}

function pointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function toIssues(errors: ErrorObject[] | null | undefined): ContractIssue[] {
  return (errors ?? []).map((error) => ({
    path: error.instancePath,
    code: error.keyword,
    params: error.params as Record<string, unknown>,
  }));
}

/**
 * 按契约校验一个接口的 JSON 请求体。没有 JSON 请求体的接口一律通过。
 * 只管结构；业务规则（状态、权限、限额）不在这里。
 */
export function validateRequestBody(operationId: OperationId, body: unknown): ContractResult {
  let validate = bodyValidators.get(operationId);
  if (validate === undefined) {
    const operation = operations[operationId];
    validate = operation.hasJsonBody
      ? getAjv().compile({
          $ref: `${DOCUMENT_ID}#/paths/${pointerSegment(operation.path)}/${operation.method.toLowerCase()}/requestBody/content/application~1json/schema`,
        })
      : null;
    bodyValidators.set(operationId, validate);
  }
  if (!validate || validate(body)) return { ok: true };
  return { ok: false, issues: toIssues(validate.errors) };
}
