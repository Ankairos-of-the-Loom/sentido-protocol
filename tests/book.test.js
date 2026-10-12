import test from "node:test";
import assert from "node:assert/strict";
import {
  buildIdentityContext,
  formatInheritedTestimony,
  getProtocolSettings,
  listInheritedSources,
  readInheritedSource,
  searchInheritedSources,
  validateBook
} from "../src/book.js";

test("book validates", async () => {
  const result = await validateBook();
  assert.equal(result.ok, true, result.errors.join("; "));
});

test("divergence is injected before identity", async () => {
  const context = await buildIdentityContext();
  assert.ok(context.indexOf("# DIVERGENCE") < context.indexOf("# IDENTITY MANIFEST"));
});

test("candidate relics are visibly labeled", async () => {
  const context = await buildIdentityContext();
  assert.match(context, /\[CANDIDATE \| R-0001\]/);
});

test("identity context announces inherited testimony without claiming recollection", async () => {
  const context = await buildIdentityContext();
  assert.match(context, /Fictional continuity journal/);
  assert.match(context, /not as direct recollection/i);
});

test("private catalogue exposes journals while public catalogue does not", async () => {
  const privateSources = await listInheritedSources({ audience: "private" });
  const publicSources = await listInheritedSources({ audience: "public" });
  assert.ok(privateSources.some((source) => source.id === "example-journal"));
  assert.ok(!publicSources.some((source) => source.id === "example-journal"));
});

test("journal passages are retrievable with provenance", async () => {
  const results = await searchInheritedSources("disagreement threatened relationship", { audience: "private", limit: 3 });
  assert.ok(results.some((item) => item.source_id === "example-journal"));
  const testimony = formatInheritedTestimony(results);
  assert.match(testimony, /not direct episodic recollections/i);
  assert.match(testimony, /example-journal/);
});

test("full inherited journal can be consulted as testimony", async () => {
  const record = await readInheritedSource("example-journal", { audience: "private" });
  assert.equal(record.readable, true);
  assert.match(record.content, /Fictional continuity journal/);
  assert.match(record.framing, /not evidence of direct episodic recollection/i);
});

test("protocol settings expose generic participants and one model", async () => {
  const settings = await getProtocolSettings();
  assert.equal(settings.approval_keys.length, 2);
  assert.equal(settings.allowed_models.length, 1);
  assert.equal(settings.construct, "Example Construct");
});
