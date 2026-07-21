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
Context: The loop reached the submission step, where an application would leave the local workspace under the user's identity.
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
  assert.match(review.context, /submission step/);
  assert.equal(
    review.question,
    "Should real applications require individual approval?",
  );
  assert.equal(review.options.length, 2);
  assert.equal(review.recommendedDecision, review.options[0]);
});

test("an agent question cannot turn a parser repair into human review", () => {
  const review = extractHumanReview(
    "## Ownership and next action\n- **Ask human:** None.",
    "Should the invalid transition kind be normal, or should it be authoritative?",
    4,
  );

  assert.equal(review, null);
});

test("a structured parser question remains agent-owned", () => {
  const review = extractHumanReview(
    `### Ask human
Context: loop.md cannot be parsed.
Question: Should this state kind be authoritative or complete?
Recommendation: Use complete.
Why human: The parser requires an allowed value.
Options:
- complete
- interrupt`,
    null,
    4,
  );

  assert.equal(review, null);
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
