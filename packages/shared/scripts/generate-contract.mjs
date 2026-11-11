// 从 schema/ 生成 src/generated/ 下的全部文件。生成结果提交进仓库；
// 改了契约之后跑 `pnpm --filter @platerelay/shared generate`，CI 会检查两边一致。
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";
import openapiTS, { astToString } from "openapi-typescript";
import { parse as parseYaml } from "yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemaDir = join(root, "schema");
const daemonDir = join(schemaDir, "daemon", "v1");
const outDir = join(root, "src", "generated");

const HEADER = "// 自动生成，不要手改。来源在 packages/shared/schema/，用 `pnpm --filter @platerelay/shared generate` 重新生成。\n\n";
const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

/** HTTP 接口：类型、整份文档（给运行时校验用）、操作表。 */
async function generateHttp() {
  const document = parseYaml(await readFile(join(schemaDir, "openapi.yaml"), "utf8"));

  const ast = await openapiTS(document);
  await writeFile(join(outDir, "api.ts"), HEADER + astToString(ast));

  const operations = {};
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = item[method];
      if (!operation) continue;
      const permission = operation["x-permission"];
      operations[operation.operationId] = {
        method: method.toUpperCase(),
        path,
        tag: operation.tags?.[0] ?? null,
        permissions: Array.isArray(permission) ? permission : [permission],
        hasJsonBody: Boolean(operation.requestBody?.content?.["application/json"]),
      };
    }
  }
  await writeFile(
    join(outDir, "openapi-document.ts"),
    `${HEADER}/** 整份接口契约，运行时校验请求用。体积大，只给服务端引用。 */\nexport const openapiDocument: Record<string, unknown> = ${JSON.stringify(document, null, 2)};\n`,
  );
  await writeFile(
    join(outDir, "operations.ts"),
    `${HEADER}/** 每个接口的方法、路径和需要的权限（满足任意一个即可）。 */\nexport const operations = ${JSON.stringify(operations, null, 2)} as const;\n\nexport type OperationId = keyof typeof operations;\n`,
  );
}

/** 把 `common.schema.json#/$defs/X` 这样的跨文件引用改成包内引用。 */
function rewriteRefs(node) {
  if (Array.isArray(node)) return node.map(rewriteRefs);
  if (node === null || typeof node !== "object") return node;
  const result = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "$ref" && typeof value === "string") {
      const match = /^common\.schema\.json#\/\$defs\/(\w+)$/.exec(value);
      if (!match) throw new Error(`不支持的引用：${value}`);
      result[key] = `#/$defs/${match[1]}`;
    } else {
      result[key] = rewriteRefs(value);
    }
  }
  return result;
}

/** daemon 协议：把每种消息一个文件的 Schema 合成一份，再生成类型。Python 那边的类型也从合成的这份生成。 */
async function generateDaemon() {
  const manifest = await readJson(join(daemonDir, "messages.json"));
  const common = await readJson(join(daemonDir, "common.schema.json"));
  const defs = {};
  for (const [name, schema] of Object.entries(common.$defs)) defs[name] = rewriteRefs(schema);

  const files = (await readdir(daemonDir)).filter((name) => name.endsWith(".schema.json") && name !== "common.schema.json").sort();
  for (const file of files) {
    const { $schema: _schema, $id: _id, ...schema } = await readJson(join(daemonDir, file));
    if (defs[schema.title]) throw new Error(`名字重复：${schema.title}（${file}）`);
    defs[schema.title] = rewriteRefs(schema);
  }
  for (const message of manifest.messages) {
    if (!defs[message.title]) throw new Error(`messages.json 里的 ${message.type} 找不到对应的 Schema`);
  }

  const bundle = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://platerelay.dev/schema/daemon/v${manifest.protocolVersion.split(".")[0]}/bundle.schema.json`,
    title: "DaemonProtocol",
    description: "daemon 协议的全部消息，由 schema/daemon/v1/ 下的文件合成。",
    $defs: defs,
  };
  await writeFile(join(outDir, "daemon-protocol.bundle.json"), `${JSON.stringify(bundle, null, 2)}\n`);

  const types = await compile(bundle, "DaemonProtocol", {
    bannerComment: "",
    additionalProperties: false,
    unreachableDefinitions: true,
    declareExternallyReferenced: true,
    format: false,
  });
  const bodyMap = manifest.messages.map((m) => `  ${JSON.stringify(m.type)}: ${m.title};`).join("\n");
  await writeFile(
    join(outDir, "daemon-protocol.ts"),
    `${HEADER}${types}\n/** 消息类型到消息体的对应。 */\nexport interface DaemonMessageBodies {\n${bodyMap}\n}\n\nexport type DaemonMessageType = keyof DaemonMessageBodies;\n`,
  );
  await writeFile(
    join(outDir, "daemon-protocol-schema.ts"),
    `${HEADER}/** 合成后的 daemon 协议 Schema，运行时校验消息用。 */\nexport const daemonProtocolSchema: Record<string, unknown> = ${JSON.stringify(bundle, null, 2)};\n\n/** 协议里的消息清单：方向、要不要确认。 */\nexport const daemonMessages = ${JSON.stringify(manifest.messages, null, 2)} as const;\n\nexport const daemonProtocolVersion = ${JSON.stringify(manifest.protocolVersion)};\n`,
  );
}

await mkdir(outDir, { recursive: true });
await generateHttp();
await generateDaemon();
console.log("已生成 src/generated/");
