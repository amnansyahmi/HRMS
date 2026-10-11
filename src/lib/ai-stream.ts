/** Hide model protocol blocks until server validation produces action cards. */
export function visibleAIText(text: string) {
  let visible = text.replace(
    /```(?:hr-action|resume-evidence)\s*[\s\S]*?```/g,
    "",
  );
  const fences = [...visible.matchAll(/```/g)];
  if (fences.length % 2)
    visible = visible.slice(0, fences[fences.length - 1].index);
  // A fence itself can be split across network chunks.
  visible = visible.replace(/`{1,2}$/, "");
  return visible.trimEnd();
}

export async function readAIEvents(
  response: Response,
  onEvent: (event: {
    type: string;
    text?: string;
    message?: string;
    result?: unknown;
  }) => void,
) {
  if (!response.body)
    throw new Error("The AI response could not be read. Retry your message.");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let pending = "",
    completed = false;
  function consume(line: string) {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === "error")
      throw new Error(event.message || "AI request failed");
    if (event.type === "complete") completed = true;
    onEvent(event);
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split("\n");
      pending = lines.pop() || "";
      lines.forEach(consume);
      if (done) break;
    }
    if (pending.trim()) consume(pending);
    if (!completed)
      throw new Error(
        "The connection ended before the answer was saved. Retry your message.",
      );
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
