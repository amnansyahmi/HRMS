import { fail } from "./errors";

/** Checks the model catalogue without sending prompts or employee records. */
export async function checkAIConnection(signal?: AbortSignal) {
  const base = process.env.AI_NONYMAUZ_BASE_URL?.trim();
  const key = process.env.AI_NONYMAUZ_API_KEY?.trim();
  const model = process.env.AI_NONYMAUZ_MODEL?.trim();
  if (!base || !key || !model)
    fail("Configure the AI URL, API key and model alias first", 503);
  let url: URL;
  try {
    url = new URL(`${base.replace(/\/$/, "")}/models`);
  } catch {
    fail("The AI API base URL is invalid", 503);
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    (process.env.NODE_ENV === "production" && url.protocol !== "https:")
  )
    fail("The AI endpoint must use HTTPS in production", 503);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(12000)])
        : AbortSignal.timeout(12000),
    });
  } catch {
    fail(
      "The AI backend could not be reached. It may be starting up; try again shortly.",
      502,
    );
  }
  if ([401, 403].includes(response.status))
    fail(
      "The AI backend rejected its API key. Check the server credential.",
      503,
    );
  if (!response.ok)
    fail(
      "The AI model catalogue is unavailable. Check the API base URL and retry.",
      502,
    );
  let payload: unknown;
  try {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("missing body");
    const decoder = new TextDecoder();
    let text = "",
      bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 64000) throw new Error("oversized catalogue");
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      await reader.cancel();
    }
    payload = JSON.parse(text);
  } catch {
    fail("The AI backend returned an unreadable model catalogue", 502);
  }
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data))
    fail("The AI backend returned an unreadable model catalogue", 502);
  const models = [
    ...new Set(
      data.flatMap((item) => {
        const id = item?.id;
        return typeof id === "string" && /^[a-zA-Z0-9_./:-]{1,160}$/.test(id)
          ? [id]
          : [];
      }),
    ),
  ]
    .slice(0, 100)
    .sort();
  return { models, model, available: models.includes(model) };
}
