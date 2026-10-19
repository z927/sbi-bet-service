#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const syncContractVersion = (version, root = ROOT) => {
  const contractPath = resolve(root, "openapi", "openapi.yaml");
  const lines = readFileSync(contractPath, "utf8").split("\n");
  let inInfo = false;
  let updated = false;
  const nextLines = lines.map((line) => {
    if (/^info:\s*$/.test(line)) {
      inInfo = true;
      return line;
    }
    if (inInfo && line.trim() !== "" && !/^\s/.test(line)) inInfo = false;
    if (inInfo && /^ {2}version:\s*/.test(line)) {
      updated = true;
      return `  version: ${version}`;
    }
    return line;
  });
  if (!updated) {
    throw new Error(`info.version non trovata in ${contractPath}`);
  }
  writeFileSync(contractPath, nextLines.join("\n"));
  return contractPath;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = process.argv[2] ?? JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).version;
  const contractPath = syncContractVersion(version);
  console.log(`sync-contract-version: ${contractPath} -> ${version}`);
}
