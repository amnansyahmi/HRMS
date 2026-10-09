import { getActor, rateLimit } from "@/lib/auth";
import { checkAIConnection } from "@/lib/ai-connection";
import { handle, fail } from "@/lib/errors";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handle(async () => {
    const actor = await getActor();
    if (actor.role !== "owner")
      fail("Only the workspace owner can check the AI connection", 403);
    await rateLimit(
      `ai-connection:${actor.companyId}:${actor.userId}`,
      10,
      3600,
    );
    return Response.json(await checkAIConnection(request.signal), {
      headers: { "Cache-Control": "private, no-store" },
    });
  });
}
