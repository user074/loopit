const HEADER = `# Loopit conversation

This local history mirrors the construction conversation shown in the web interface.

`;

const LABELS = {
  user: "User",
  loopit: "Loopit",
  error: "Problem",
};

const HEADING =
  /^## (User|Codex|Claude|Loopit|Problem) · (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\s*$/gm;

function messageLabel(message) {
  if (message.role === "agent") {
    return message.source === "claude" ? "Claude" : "Codex";
  }
  const label = LABELS[message.role];
  if (!label) throw new Error(`Unsupported conversation role: ${message.role}`);
  return label;
}

function roleForLabel(label) {
  if (label === "Codex" || label === "Claude") return "agent";
  if (label === "User") return "user";
  if (label === "Problem") return "error";
  return "loopit";
}

export function emptyConversationMarkdown() {
  return HEADER;
}

export function appendConversationMarkdown(source, message) {
  const base = source.trim() ? source.trimEnd() : HEADER.trimEnd();
  const timestamp = new Date(message.timestamp ?? Date.now()).toISOString();
  const text = String(message.text ?? "").trim();
  if (!text) throw new Error("A conversation message cannot be empty.");
  return `${base}\n\n## ${messageLabel(message)} · ${timestamp}\n\n${text}\n`;
}

export function parseConversationMarkdown(source) {
  const matches = [...source.matchAll(HEADING)];
  return matches.map((match, index) => {
    const label = match[1];
    const timestamp = match[2];
    const contentStart = match.index + match[0].length;
    const contentEnd = matches[index + 1]?.index ?? source.length;
    const role = roleForLabel(label);
    return {
      id: `${timestamp}-${index}`,
      role,
      text: source.slice(contentStart, contentEnd).trim(),
      timestamp,
      ...(role === "agent"
        ? { source: label === "Claude" ? "claude" : "codex" }
        : {}),
    };
  });
}

function compactText(value, limit) {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

export function summarizeConversationMarkdown(source, id) {
  const messages = parseConversationMarkdown(source);
  const firstUserMessage = messages.find((message) => message.role === "user");
  const lastMessage = messages.at(-1);

  return {
    id,
    title: firstUserMessage
      ? compactText(firstUserMessage.text, 48)
      : "New conversation",
    preview: lastMessage ? compactText(lastMessage.text, 84) : "No messages yet",
    updatedAt: lastMessage?.timestamp ?? null,
    messageCount: messages.length,
  };
}
