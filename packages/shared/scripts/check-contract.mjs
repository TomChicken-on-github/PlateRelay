// 检查 schema/ 下的契约本身：每个接口有唯一的操作 ID 和权限声明；
// 契约和生成的代码里不出现设计文档的编号（代码要能脱离设计文档读懂）。
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];

const document = parseYaml(await readFile(join(root, "schema", "openapi.yaml"), "utf8"));
const seen = new Map();
for (const [path, item] of Object.entries(document.paths)) {
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    const operation = item[method];
    if (!operation) continue;
    const where = `${method.toUpperCase()} ${path}`;
    if (!operation.operationId) problems.push(`${where}：没有 operationId`);
    else if (seen.has(operation.operationId)) problems.push(`${where}：operationId ${operation.operationId} 和 ${seen.get(operation.operationId)} 重复`);
    else seen.set(operation.operationId, where);
    const permission = operation["x-permission"];
    const list = Array.isArray(permission) ? permission : [permission];
    if (list.length === 0 || list.some((p) => typeof p !== "string" || p === "")) problems.push(`${where}：没有声明 x-permission`);
  }
}

// 形如 "R-ABC-12"、"INV-07"、"Q123" 的设计文档编号，以及指向文档章节的写法。
const DOC_ID = /(?<![A-Za-z0-9-])(?:(?:F|INV|NG|P|S|R|CFG|E|API|MSG|IF|DAE|SEQ)-(?:[A-Z]{2,6}-)?(?:T?\d{2}[a-z]?|\*)|Q\d{2,3})(?![A-Za-z0-9])|文档 ?\d|§/g;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

for (const dir of ["schema", "src/generated", "src/contract", "scripts"]) {
  for await (const file of walk(join(root, dir))) {
    if (file.endsWith("check-contract.mjs")) continue;
    const lines = (await readFile(file, "utf8")).split("\n");
    lines.forEach((line, index) => {
      const found = line.match(DOC_ID);
      if (found) problems.push(`${relative(root, file)}:${index + 1}：出现设计文档编号 ${[...new Set(found)].join("、")}`);
    });
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`契约检查通过：${seen.size} 个接口。`);
