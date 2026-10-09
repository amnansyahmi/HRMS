import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeAI } from "@/lib/ai";

describe("ai-nonymauz-cloud transport", () => {
  beforeEach(() => {
    vi.stubEnv("AI_NONYMAUZ_BASE_URL", "https://nonymauz.example/v1");
    vi.stubEnv("AI_NONYMAUZ_API_KEY", "private-test-key");
    vi.stubEnv("AI_NONYMAUZ_MODEL", "ai-nonymauz-fast");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("explicitly requests JSON from a backend that defaults to streaming", async () => {
    const mock = vi.fn(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      // Cloud's ChatRequest.stream defaults to true when omitted. A mock
      // that always returns JSON would conceal this integration failure.
      if (body.stream !== false)
        return new Response(
          'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n',
          {
            headers: { "Content-Type": "text/event-stream" },
          },
        );
      return Response.json({
        id: "chat-test",
        model: "ai-nonymauz-fast",
        choices: [
          {
            message: { role: "assistant", content: "Hi. How can I help?" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
      });
    });
    vi.stubGlobal("fetch", mock);
    const reply = await completeAI("hi");
    expect(reply.text).toBe("Hi. How can I help?");
    expect(mock).toHaveBeenCalledTimes(1);
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe("https://nonymauz.example/v1/chat/completions");
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer private-test-key",
    );
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "ai-nonymauz-fast",
      stream: false,
      use_rag: false,
      use_tools: false,
      mode: "normal",
      max_tokens: 4096,
    });
  });

  it.each([
    [401, 503, "rejected its API key"],
    [403, 503, "rejected its API key"],
    [404, 503, "endpoint or model was not found"],
    [400, 502, "rejected the request"],
    [422, 502, "rejected the request"],
    [429, 429, "usage limit"],
    [408, 504, "timed out"],
    [504, 504, "timed out"],
    [503, 502, "unavailable"],
  ])(
    "classifies HTTP %i without retries or leaking upstream details",
    async (upstream, status, message) => {
      const mock = vi.fn(async () =>
        Response.json(
          { detail: "private-test-key confidential HR record" },
          { status: upstream },
        ),
      );
      vi.stubGlobal("fetch", mock);
      await expect(completeAI("confidential HR record")).rejects.toMatchObject({
        status,
        message: expect.stringContaining(message),
      });
      expect(mock).toHaveBeenCalledTimes(1);
      expect(console.error).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
      expect(logged).toContain(`"upstreamStatus":${upstream}`);
      expect(logged).not.toContain("private-test-key");
      expect(logged).not.toContain("confidential HR record");
    },
  );

  it("distinguishes a malformed HTTP 200 reply from authentication failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("data: private-test-key confidential HR record", {
            headers: { "Content-Type": "text/event-stream" },
          }),
      ),
    );
    await expect(completeAI("hi")).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining("unsupported response"),
    });
    expect(console.error).toHaveBeenCalledWith(
      "ai-nonymauz-cloud request failed",
      { category: "response-format", upstreamStatus: 200 },
    );
  });

  it("keeps network exception details private", async () => {
    const mock = vi.fn(async () => {
      throw new TypeError("private-test-key confidential HR record");
    });
    vi.stubGlobal("fetch", mock);
    await expect(completeAI("hi")).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining("unavailable"),
    });
    expect(mock).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      "ai-nonymauz-cloud request failed",
      { category: "transport", upstreamStatus: null },
    );
  });

  it.each(["TimeoutError", "AbortError"])(
    "recognizes %s without retrying generation",
    async (name) => {
      const mock = vi.fn(async () => {
        throw new DOMException("private timeout detail", name);
      });
      vi.stubGlobal("fetch", mock);
      await expect(completeAI("hi")).rejects.toMatchObject({
        status: 504,
        message: expect.stringContaining("timed out"),
      });
      expect(mock).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects invalid configuration before sending data", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    vi.stubEnv("AI_NONYMAUZ_BASE_URL", "invalid-url");
    await expect(completeAI("hi")).rejects.toMatchObject({ status: 503 });
    vi.stubEnv("AI_NONYMAUZ_BASE_URL", "https://nonymauz.example/v1");
    vi.stubEnv("AI_NONYMAUZ_API_KEY", "  ");
    await expect(completeAI("hi")).rejects.toMatchObject({ status: 503 });
    expect(mock).not.toHaveBeenCalled();
  });
});
