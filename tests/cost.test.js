import test from "node:test";
import assert from "node:assert/strict";
import { calculateCost, estimateTokens } from "../src/cost.js";

test("token estimate is conservative and stable", () => {
  assert.equal(estimateTokens("12345678"), 2);
});

test("cost uses per-million rates", () => {
  assert.equal(calculateCost({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, { input: 2, output: 10 }), 12);
});

test("missing pricing returns null", () => {
  assert.equal(calculateCost({ inputTokens: 10, outputTokens: 10 }, { input: null, output: 10 }), null);
});
