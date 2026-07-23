import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schema = JSON.parse(
  await readFile(
    new URL(
      "../schemas/loop-construction-output.schema.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

test("construction schema hard-selects every parser enum", () => {
  assert.deepEqual(schema.properties.action.enum, ["ask", "update", "no-change"]);
  assert.deepEqual(schema.definitions.startingPackageItem.properties.role.enum, [
    "state",
    "frontier",
    "foundation",
    "first-work",
  ]);
  assert.deepEqual(schema.definitions.boundary.properties.kind.enum, [
    "interrupt",
    "complete",
    "budget",
  ]);
  assert.deepEqual(schema.definitions.transition.properties.kind.enum, [
    "normal",
    "continue",
    "interrupt",
    "complete",
  ]);
  assert.deepEqual(schema.definitions.state.properties.kind.enum, [
    "observe",
    "decide",
    "act",
    "evaluate",
    "challenge",
    "update",
    "interrupt",
    "terminal",
  ]);
});

test("construction schema stays compatible with Claude Code draft-07 validation", () => {
  assert.equal(schema.$schema, "http://json-schema.org/draft-07/schema#");
  assert.ok(schema.definitions);
  assert.equal(Object.hasOwn(schema, "$defs"), false);

  const source = JSON.stringify(schema);
  assert.doesNotMatch(source, /#\/\$defs\//);
});

test("every structured loop object requires its machine ID", () => {
  for (const definition of [
    "startingPackageItem",
    "artifact",
    "boundary",
    "transition",
    "state",
  ]) {
    assert.ok(schema.definitions[definition].required.includes("id"), definition);
    assert.equal(schema.definitions[definition].additionalProperties, false);
  }
});
