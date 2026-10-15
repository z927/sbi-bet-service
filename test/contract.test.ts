import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { SBI_ROUTES } from "../src/sbi/routes.ts";
import { SCRAPER_ROUTES } from "../src/scraper/routes.ts";
import { buildServer } from "../src/server.ts";
import { removeDb, useTempDb } from "./support.ts";

process.env["LOG_LEVEL"] = "silent";
const DB_FILE = useTempDb("contract");

after(() => {
  removeDb(DB_FILE);
});

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = resolve(HERE, "..", "openapi", "openapi.yaml");
const contract = parse(readFileSync(CONTRACT_PATH, "utf8")) as {
  paths: Record<string, Record<string, { operationId?: string }>>;
};

const ROUTES = [...SBI_ROUTES, ...SCRAPER_ROUTES];

test("implemented routes match the contract paths, methods and operationIds", () => {
  for (const route of ROUTES) {
    const pathItem = contract.paths[route.path];
    assert.ok(pathItem, `contract is missing path ${route.path}`);
    const operation = pathItem[route.method.toLowerCase()];
    assert.ok(operation, `contract is missing ${route.method} ${route.path}`);
    assert.equal(operation.operationId, route.operationId);
  }
});

test("contract paths are fully covered by implemented routes", () => {
  const implemented = new Set(ROUTES.map((r) => `${r.method} ${r.path}`));
  const declared: string[] = [];
  for (const [path, item] of Object.entries(contract.paths)) {
    for (const method of ["get", "post"]) {
      if (item[method]) {
        declared.push(`${method.toUpperCase()} ${path}`);
      }
    }
  }
  assert.deepEqual(new Set(declared), implemented);
});

test("served /openapi.json matches the maintained contract", async () => {
  const app = await buildServer();
  try {
    const response = await app.inject({ method: "GET", url: "/openapi.json" });
    assert.equal(response.statusCode, 200);
    const served = response.json() as typeof contract;
    assert.deepEqual(served.paths, contract.paths);
  } finally {
    await app.close();
  }
});
