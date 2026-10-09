import { afterEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ getActor: vi.fn(), rateLimit: vi.fn() }));
const cloud = vi.hoisted(() => ({ checkAIConnection: vi.fn() }));
vi.mock("@/lib/auth", () => auth);
vi.mock("@/lib/ai-connection", () => cloud);
import { GET } from "@/app/api/ai/connection/route";
afterEach(() => vi.resetAllMocks());
it.each(["employee", "manager", "hr"])(
  "denies %s before accessing provider",
  async (role) => {
    auth.getActor.mockResolvedValue({
      role,
      companyId: "company",
      userId: "user",
    });
    const response = await GET(
      new Request("https://hr.example/api/ai/connection"),
    );
    expect(response.status).toBe(403);
    expect(cloud.checkAIConnection).not.toHaveBeenCalled();
    expect(auth.rateLimit).not.toHaveBeenCalled();
  },
);
it("limits owner diagnostics and disables response caching", async () => {
  auth.getActor.mockResolvedValue({
    role: "owner",
    companyId: "company",
    userId: "user",
  });
  cloud.checkAIConnection.mockResolvedValue({
    models: ["fast"],
    model: "fast",
    available: true,
  });
  const response = await GET(
    new Request("https://hr.example/api/ai/connection"),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(auth.rateLimit).toHaveBeenCalledWith(
    "ai-connection:company:user",
    10,
    3600,
  );
});
