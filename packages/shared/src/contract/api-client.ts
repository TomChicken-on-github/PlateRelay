import createClient, { type Client, type ClientOptions } from "openapi-fetch";
import type { paths } from "../generated/api.js";

export type { components, operations, paths } from "../generated/api.js";

/** 接口都挂在这个前缀下。 */
export const API_PREFIX = "/api/v1";

export type ApiClient = Client<paths>;

/** 带类型的接口客户端：路径、参数、请求体和响应都按契约检查。 */
export function createApiClient(options: ClientOptions = {}): ApiClient {
  return createClient<paths>({ baseUrl: API_PREFIX, credentials: "same-origin", ...options });
}
