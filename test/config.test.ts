import { test } from "node:test";
import assert from "node:assert/strict";
import packageJson from "../package.json" with { type: "json" };
import { getSettings } from "../src/config.ts";

test("appVersion defaults to the package.json version", () => {
  assert.equal(getSettings({}).appVersion, packageJson.version);
});

test("APP_VERSION overrides only when it holds a value", () => {
  assert.equal(getSettings({ APP_VERSION: "9.9.9" }).appVersion, "9.9.9");
  assert.equal(getSettings({ APP_VERSION: "" }).appVersion, packageJson.version);
});
