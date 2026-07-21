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
  assert.deepEqual(schema.$defs.startingPackageItem.properties.role.enum, [
    "state",
    "frontier",
    "foundation",
    "first-work",
  ]);
  assert.deepEqual(schema.$defs.boundary.properties.kind.enum, [
    "interrupt",
    "complete",
    "budget",
  ]);
  assert.deepEqual(schema.$defs.transition.properties.kind.enum, [
    "normal",
    "continue",
    "interrupt",
    "complete",
  ]);
  assert.deepEqual(schema.$defs.state.properties.kind.enum, [
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

test("every structured loop object requires its machine ID", () => {
  for (const definition of [
    "startingPackageItem",
    "artifact",
    "boundary",
    "transition",
    "state",
  ]) {
    assert.ok(schema.$defs[definition].required.includes("id"), definition);
    assert.equal(schema.$defs[definition].additionalProperties, false);
  }
});
