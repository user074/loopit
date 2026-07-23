import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRuntimeMap,
  runtimeRegionLabel,
  type RuntimeMapState,
} from "../lib/runtime-map.ts";

function stateFor(
  title: string,
  kind: "artifact" | "belief" | "failure" | "uncertainty",
  status: string,
): RuntimeMapState {
  return {
    activeAssignment: null,
    frontier: [
      {
        id: "frontier-1",
        title,
        status: "ready",
        priority: 90,
        objectiveLink: "Advance the declared objective.",
        causedBy: "Current evidence exposed an unresolved question.",
        retirementEvidence: "A report records sufficient observable evidence.",
      },
    ],
    items: [
      {
        id: "state-1",
        kind,
        name: title,
        status,
        summary: "The current result is supported by one bounded evaluation.",
        evidence: ["iteration-0001"],
      },
    ],
  };
}

test("the operations map keeps software, research, and design vocabulary", () => {
  const software = buildRuntimeMap(
    stateFor(
      "`F2 Permitted job ingestion · ready` — ingest permitted job pages",
      "artifact",
      "partial",
    ),
  );
  const research = buildRuntimeMap(
    stateFor(
      "`H3 Visual sensitivity · uncertain` — test the hypothesis",
      "belief",
      "uncertain",
    ),
  );
  const design = buildRuntimeMap(
    stateFor(
      "`Checkout recovery flow · ready` — test the revised prototype",
      "uncertainty",
      "untested",
    ),
  );

  assert.equal(software[0].label, "Permitted job ingestion");
  assert.equal(research[0].label, "Visual sensitivity");
  assert.equal(research[0].condition, "uncertain");
  assert.equal(design[0].label, "Checkout recovery flow");
  assert.equal(design[0].condition, "uncertain");
});

test("the active worker's frontier becomes the active map region", () => {
  const state = stateFor("Profile intake", "artifact", "partial");
  state.activeAssignment = {
    frontierId: "frontier-1",
    title: "Profile intake",
  };
  state.frontier[0].status = "active";
  const active = buildRuntimeMap(state)[0];
  assert.equal(active.condition, "active");
  assert.equal(active.present?.label, "Profile intake");
  assert.equal(active.present?.tone, "active");
});

test("stable project areas collect lower-level work without becoming new regions", () => {
  const state = stateFor("Profile intake", "artifact", "partial");
  state.frontier.push({
    id: "profile-schema",
    title: "Profile schema validation",
    status: "ready",
    priority: 80,
    objectiveLink: "Ship profile intake.",
    causedBy: "Profile intake needs a validated schema.",
    retirementEvidence: "Schema tests pass.",
  });
  const regions = buildRuntimeMap(state, {
    anchors: [
      { id: "profile", title: "Profile intake" },
      { id: "matching", title: "Interest matching" },
    ],
  });
  assert.equal(regions.length, 2);
  assert.equal(regions[0].label, "Profile intake");
  assert.ok(regions[0].memberIds.includes("profile-schema"));
  assert.equal(regions[0].totalCount, 2);
  assert.equal(regions[1].progress, 0);
});

test("progress and review status come from tracked work and the ledger", () => {
  const state = stateFor("Profile intake", "artifact", "partial");
  const ledger = [
    {
      number: 1,
      title: "Profile parsing",
      assignmentId: "iteration-0001",
      progress: "advanced" as const,
      completed: "PDF and DOCX parsing passed",
      next: "Validate persisted profiles",
      reason: "The parser passed its fixtures.",
      stateChanges: ["Profile parsing is implemented."],
      frontierChanges: ["Added persistence validation."],
    },
  ];
  const unreviewed = buildRuntimeMap(state, {
    anchors: [{ id: "profile", title: "Profile intake" }],
    ledger,
    reviewedThrough: 0,
  })[0];
  assert.equal(unreviewed.progress, 50);
  assert.equal(unreviewed.progressLabel, "1 of 2 tracked units resolved");
  assert.equal(unreviewed.reviewCount, 1);
  assert.equal(unreviewed.condition, "review");
  assert.equal(unreviewed.past?.label, "PDF and DOCX parsing passed");
  assert.equal(unreviewed.past?.tone, "review");
  assert.equal(unreviewed.future?.label, "Profile intake");

  const reviewed = buildRuntimeMap(state, {
    anchors: [{ id: "profile", title: "Profile intake" }],
    ledger,
    reviewedThrough: 1,
  })[0];
  assert.equal(reviewed.reviewCount, 0);
  assert.equal(reviewed.condition, "ready");
  assert.equal(reviewed.past?.tone, "complete");
});

test("an unrelated uncertainty does not color every project area", () => {
  const state = stateFor("Profile intake", "artifact", "verified");
  state.items.push({
    id: "uncertainty-email",
    kind: "uncertainty",
    name: "Interview email classification",
    status: "uncertain",
    summary: "The classifier has not been evaluated.",
    evidence: [],
  });
  assert.equal(buildRuntimeMap(state)[0].condition, "ready");
  assert.equal(buildRuntimeMap(state)[0].evidenceCount, 1);
});

test("large frontiers collapse into one inspectable map area", () => {
  const state = stateFor("First hypothesis", "belief", "unverified");
  state.frontier = Array.from({ length: 14 }, (_, index) => ({
    id: `frontier-${index + 1}`,
    title: `Hypothesis ${index + 1}`,
    status: "ready" as const,
    priority: 100 - index,
    objectiveLink: "Explain the observed behavior.",
    causedBy: "The evidence remains incomplete.",
    retirementEvidence: "An experiment supports or contradicts the hypothesis.",
  }));
  const regions = buildRuntimeMap(state, { maximumRegions: 9 });
  assert.equal(regions.length, 9);
  assert.equal(regions.at(-1)?.label, "6 more areas");
  assert.equal(regions.at(-1)?.memberIds.length, 6);
});

test("region labels remove machine identifiers without changing domain terms", () => {
  assert.equal(
    runtimeRegionLabel(
      "`F1.2 Profile validation · not started` — validate the profile",
    ),
    "Profile validation",
  );
  assert.equal(
    runtimeRegionLabel("Interview-notification reliability"),
    "Interview-notification reliability",
  );
});
