import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { checkAIConnection } from "@/lib/ai-connection";

beforeEach(() => {
  vi.stubEnv("AI_NONYMAUZ_BASE_URL", "https://cloud.example/v1/");
  vi.stubEnv("AI_NONYMAUZ_API_KEY", "secret-credential");
  vi.stubEnv("AI_NONYMAUZ_MODEL", "ai-nonymauz-fast");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("checks the catalogue without HR data and reports a missing configured model", async () => {
  const fetcher = vi.fn(async () =>
    Response.json({
      data: [
        { id: "ai-nonymauz-coding" },
        { id: "ai-nonymauz-coding" },
        { id: "<script>secret</script>" },
      ],
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  expect(await checkAIConnection()).toEqual({
    models: ["ai-nonymauz-coding"],
    model: "ai-nonymauz-fast",
    available: false,
  });
  const [url, request] = (
    fetcher.mock.calls as unknown as [URL, RequestInit][]
  )[0];
  expect(String(url)).toBe("https://cloud.example/v1/models");
  expect(request.body).toBeUndefined();
  expect(request.redirect).toBe("error");
  expect(new Headers(request.headers).get("authorization")).toBe(
    "Bearer secret-credential",
  );
});
it("recognizes an available alias", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ data: [{ id: "ai-nonymauz-fast" }] })),
  );
  expect((await checkAIConnection()).available).toBe(true);
});
it.each([401, 403, 404, 503])(
  "does not expose a backend error body for HTTP %i",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("secret-credential confidential record", { status }),
      ),
    );
    try {
      await checkAIConnection();
      throw new Error("Expected failure");
    } catch (error) {
      expect((error as Error).message).not.toMatch(
        /secret-credential|confidential record/,
      );
      expect(error).toHaveProperty(
        "status",
        status === 401 || status === 403 ? 503 : 502,
      );
    }
  },
);
it("reports unreadable catalogues safely", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ private: "secret-credential" })),
  );
  await expect(checkAIConnection()).rejects.toMatchObject({
    status: 502,
    message: "The AI backend returned an unreadable model catalogue",
  });
});
it("does not request an endpoint when configuration is incomplete", async () => {
  vi.stubEnv("AI_NONYMAUZ_MODEL", "");
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(checkAIConnection()).rejects.toHaveProperty("status", 503);
  expect(fetcher).not.toHaveBeenCalled();
});
