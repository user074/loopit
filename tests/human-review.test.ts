import assert from "node:assert/strict";
import test from "node:test";
import {
  extractHumanReview,
  lastQuestion,
} from "../lib/human-review.ts";

test("structured human review becomes a focused decision", () => {
  const review = extractHumanReview(
    `# Loop rehearsal

## Ownership and next action

### Agent resolves now
None.

### Ask human
Question: Should real applications require individual approval?
Recommendation: Require individual approval until the user explicitly delegates submission authority.
Why human: This controls external actions taken in the user's name.
Options:
- Require approval for every application
- Allow submission under pre-authorized rules

### Sandbox must prove
The submission boundary blocks unapproved actions.`,
    null,
    4,
  );

  assert.ok(review);
  assert.equal(review.loopRevision, 4);
  assert.equal(
    review.question,
    "Should real applications require individual approval?",
  );
  assert.equal(review.options.length, 2);
  assert.equal(review.recommendedDecision, review.options[0]);
});

test("a question from the repair agent is surfaced for an older report", () => {
  const review = extractHumanReview(
    "## Ownership and next action\n- **Ask human:** None.",
    "I fixed the agent-owned gaps. Should every application require approval, or may the assistant submit under pre-authorized rules?",
    4,
  );

  assert.ok(review);
  assert.match(review.question, /Should every application require approval/);
  assert.deepEqual(review.options, [
    "every application require approval",
    "the assistant submit under pre-authorized rules",
  ]);
  assert.equal(review.recommendedDecision, review.options[0]);
  assert.match(review.recommendation, /safe default/);
});

test("no decision is invented when neither report nor agent asks one", () => {
  assert.equal(
    extractHumanReview(
      "## Ownership and next action\n### Ask human\nNone.",
      "The remaining proof belongs in the sandbox.",
      4,
    ),
    null,
  );
  assert.equal(lastQuestion("No question here."), "");
});
