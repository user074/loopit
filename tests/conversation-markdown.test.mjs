import assert from "node:assert/strict";
import test from "node:test";
import {
  appendConversationMarkdown,
  emptyConversationMarkdown,
  parseConversationMarkdown,
  summarizeConversationMarkdown,
} from "../lib/conversation-markdown.mjs";

test("conversation messages round-trip through readable Markdown", () => {
  let markdown = emptyConversationMarkdown();
  markdown = appendConversationMarkdown(markdown, {
    role: "user",
    text: "Help me construct a loop.",
    timestamp: "2026-07-19T05:00:00.000Z",
  });
  markdown = appendConversationMarkdown(markdown, {
    role: "agent",
    source: "codex",
    text: "What work should continue?\n\n### One focused question",
    timestamp: "2026-07-19T05:00:01.000Z",
  });

  const messages = parseConversationMarkdown(markdown);
  assert.equal(messages.length, 2);
  assert.deepEqual(
    messages.map(({ role, text, source }) => ({ role, text, source })),
    [
      {
        role: "user",
        text: "Help me construct a loop.",
        source: undefined,
      },
      {
        role: "agent",
        text: "What work should continue?\n\n### One focused question",
        source: "codex",
      },
    ],
  );
});

test("agent-authored Markdown headings do not split the conversation", () => {
  const markdown = appendConversationMarkdown(emptyConversationMarkdown(), {
    role: "agent",
    source: "claude",
    text: "## Verdict\n\nThe loop is testable.",
    timestamp: "2026-07-19T05:00:00.000Z",
  });

  assert.equal(parseConversationMarkdown(markdown)[0].text, "## Verdict\n\nThe loop is testable.");
});

test("conversation summaries use the first user message and latest activity", () => {
  let markdown = emptyConversationMarkdown();
  markdown = appendConversationMarkdown(markdown, {
    role: "user",
    text: "Help me construct a durable research loop with a clear frontier.",
    timestamp: "2026-07-19T05:00:00.000Z",
  });
  markdown = appendConversationMarkdown(markdown, {
    role: "agent",
    source: "codex",
    text: "What evidence should change the hypothesis list?",
    timestamp: "2026-07-19T05:00:01.000Z",
  });

  assert.deepEqual(summarizeConversationMarkdown(markdown, "conversation-1"), {
    id: "conversation-1",
    title: "Help me construct a durable research loop with…",
    preview: "What evidence should change the hypothesis list?",
    updatedAt: "2026-07-19T05:00:01.000Z",
    messageCount: 2,
  });
});
