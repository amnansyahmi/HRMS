import { afterEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ getActor: vi.fn(), assertOrigin: vi.fn() }));
const ai = vi.hoisted(() => ({ askAI: vi.fn(), aiHistory: vi.fn() }));
vi.mock("@/lib/auth", () => auth);
vi.mock("@/lib/ai", () => ai);
import { POST } from "@/app/api/ai/route";
import { AppError } from "@/lib/errors";
const request = (accept = "application/x-ndjson") =>
  new Request("https://hr.example/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json", accept },
    body: JSON.stringify({ message: "Help" }),
  });
afterEach(() => vi.resetAllMocks());
it("authenticates before opening a private stream and emits completion only after askAI saves", async () => {
  auth.getActor.mockResolvedValue({ userId: "user" });
  ai.askAI.mockImplementation(async (_actor, _body, _signal, events) => {
    events.progress("Writing…");
    events.text("Hello");
    return { threadId: "thread", text: "Hello", cards: [] };
  });
  const response = await POST(request());
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("content-type")).toContain(
    "application/x-ndjson",
  );
  const events = (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(events).toEqual([
    { type: "progress", message: "Writing…" },
    { type: "text", text: "Hello" },
    {
      type: "complete",
      result: { threadId: "thread", text: "Hello", cards: [] },
    },
  ]);
  expect(auth.assertOrigin).toHaveBeenCalledOnce();
  expect(auth.getActor).toHaveBeenCalledOnce();
});
it("does not open a stream or call AI when authentication fails", async () => {
  auth.getActor.mockRejectedValue(new AppError("Sign in", 401));
  const response = await POST(request());
  expect(response.status).toBe(401);
  expect(ai.askAI).not.toHaveBeenCalled();
});
it("retains JSON compatibility for clients without a stream accept header", async () => {
  auth.getActor.mockResolvedValue({ userId: "user" });
  ai.askAI.mockResolvedValue({ text: "Saved" });
  const response = await POST(request("application/json"));
  expect(await response.json()).toEqual({ text: "Saved" });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("replaces unexpected server details with a safe retry event", async () => {
  auth.getActor.mockResolvedValue({ userId: "user" });
  ai.askAI.mockRejectedValue(new Error("private upstream key and prompt"));
  const response = await POST(request());
  const body = await response.text();
  expect(body).not.toContain("private upstream");
  expect(JSON.parse(body)).toMatchObject({
    type: "error",
    message: "The answer could not be completed. Please retry.",
  });
});
it("cancels provider work when the reader disconnects", async () => {
  auth.getActor.mockResolvedValue({ userId: "user" });
  let resolveAborted: () => void;
  const aborted = new Promise<void>((resolve) => {
    resolveAborted = resolve;
  });
  ai.askAI.mockImplementation(async (_actor, _body, signal, events) => {
    events.progress("Working…");
    await new Promise<void>((resolve) =>
      signal.addEventListener(
        "abort",
        () => {
          resolveAborted();
          resolve();
        },
        { once: true },
      ),
    );
    throw new AppError("Stopped", 504);
  });
  const response = await POST(request());
  const reader = response.body!.getReader();
  await reader.read();
  await reader.cancel();
  await aborted;
  expect(ai.askAI.mock.calls[0][2].aborted).toBe(true);
});
