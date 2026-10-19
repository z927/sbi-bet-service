#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { syncContractVersion } from "./sync-contract-version.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUSH = process.argv.includes("--push");
const RELEASE_FILES = ["package.json", "package-lock.json", "openapi/openapi.yaml"];

const git = (args) =>
  execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();

const fail = (message) => {
  console.error(`bump-version: ${message}`);
  process.exit(1);
};

const nextPatch = (version) => {
  const [major = "0", minor = "0", patch = "0"] = String(version ?? "0.0.0").split(".");
  const toInt = (value) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  };
  return `${toInt(major)}.${toInt(minor)}.${toInt(patch) + 1}`;
};

const writeJson = (path, transform) => {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  const updated = transform(parsed);
  writeFileSync(path, `${JSON.stringify(updated, null, 2)}\n`);
};

const staged = git(["diff", "--cached", "--name-only"]);
if (staged !== "") {
  fail(`l'index non è pulito (file già staged):\n${staged}\nCommit o unstage prima di bumpare.`);
}

const dirty = git(["diff", "--name-only", "--", ...RELEASE_FILES]);
if (dirty !== "") {
  fail(`modifiche non committate su: ${dirty}\nCommit o scarta prima di bumpare.`);
}

const packagePath = resolve(ROOT, "package.json");
const current = JSON.parse(readFileSync(packagePath, "utf8")).version;
const next = nextPatch(current);

writeJson(packagePath, (pkg) => {
  pkg.version = next;
  return pkg;
});

const lockPath = resolve(ROOT, "package-lock.json");
writeJson(lockPath, (lock) => {
  if (typeof lock.version === "string") lock.version = next;
  if (lock.packages && lock.packages[""]) lock.packages[""].version = next;
  return lock;
});

try {
  syncContractVersion(next);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

git(["add", ...RELEASE_FILES]);
git(["commit", "-m", `chore(release): ${next} [skip ci]`]);
git(["tag", `v${next}`]);

console.log(`bump-version: ${current} -> ${next} (commit chore(release) + tag v${next})`);

if (PUSH) {
  try {
    git(["push", "origin", "HEAD"]);
    git(["push", "origin", `v${next}`]);
    console.log(`bump-version: push di HEAD e v${next} completato`);
  } catch {
    console.error(
      `bump-version: push non riuscito. Spingi a mano con:\n` +
        `  git push origin HEAD && git push origin v${next}`
    );
    process.exit(1);
  }
}
