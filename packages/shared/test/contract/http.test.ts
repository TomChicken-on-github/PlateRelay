import { describe, expect, it } from "vitest";
import { createApiClient } from "../../src/contract/api-client.js";
import { operations, validateRequestBody, type OperationId } from "../../src/contract/http.js";

describe("接口操作表", () => {
  it("每个带 JSON 请求体的接口都能编译出校验器", () => {
    for (const [id, operation] of Object.entries(operations)) {
      if (operation.hasJsonBody) expect(() => validateRequestBody(id as OperationId, {}), id).not.toThrow();
    }
  });
});

describe("validateRequestBody", () => {
  it("合契约的请求体通过", () => {
    expect(validateRequestBody("stopPrint", { expectedState: "WORKING", reason: "喷头堵了", expectedJobId: "0192f3c1-7b2e-7c4a-9d1e-3f5a6b7c8d9e" })).toMatchObject({ ok: true });
  });

  it("类型不对时指出是哪个字段", () => {
    const result = validateRequestBody("stopPrint", { expectedState: "WORKING", reason: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((issue) => issue.path)).toContain("/reason");
  });

  it("没有 JSON 请求体的接口一律通过", () => {
    expect(validateRequestBody("getAuthMethods", undefined)).toEqual({ ok: true });
  });
});

describe("createApiClient", () => {
  it("按契约里的路径和前缀发请求", async () => {
    const seen: string[] = [];
    const client = createApiClient({
      baseUrl: "http://panel.test/api/v1",
      fetch: async (request) => {
        seen.push(`${(request as Request).method} ${(request as Request).url}`);
        return new Response(JSON.stringify({}), { headers: { "content-type": "application/json" } });
      },
    });
    await client.GET("/auth/methods");
    expect(seen).toEqual(["GET http://panel.test/api/v1/auth/methods"]);
  });
});
