import { test } from "node:test";
import assert from "node:assert/strict";
import { getLogContext, runWithLogContext, runWithNewLogTrace } from "../src/logger.ts";

process.env["LOG_LEVEL"] = "silent";

test("runWithLogContext merges nested context and reuses the trace id", () => {
  assert.equal(getLogContext().traceId, undefined);

  runWithLogContext({ strategy: "demo", fixtureId: "123" }, () => {
    const outer = getLogContext();
    assert.equal(outer.strategy, "demo");
    assert.equal(outer.fixtureId, "123");
    assert.ok(outer.traceId);

    runWithLogContext({ match: "Inter - Milan" }, () => {
      const inner = getLogContext();
      assert.equal(inner.strategy, "demo");
      assert.equal(inner.fixtureId, "123");
      assert.equal(inner.match, "Inter - Milan");
      assert.equal(inner.traceId, outer.traceId);
    });
  });
});

test("runWithLogContext keeps an explicitly provided trace id", () => {
  runWithLogContext({ traceId: "trace-1", strategy: "demo" }, () => {
    assert.equal(getLogContext().traceId, "trace-1");
  });
});

test("runWithNewLogTrace starts a fresh trace id for each unit of work", () => {
  runWithLogContext({ strategy: "demo" }, () => {
    const outer = getLogContext().traceId;
    const traces: string[] = [];

    for (const match of ["Inter - Milan", "Roma - Lazio"]) {
      runWithNewLogTrace({ match }, () => {
        const inner = getLogContext();
        assert.equal(inner.strategy, "demo");
        assert.equal(inner.match, match);
        assert.ok(inner.traceId);
        assert.notEqual(inner.traceId, outer);
        traces.push(inner.traceId);
      });
    }

    assert.equal(new Set(traces).size, traces.length);
  });
});
