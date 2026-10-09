import { getActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { handle, fail } from "@/lib/errors";
import { deploymentChecks } from "@/lib/deployment-config";
export const runtime = "nodejs";
export async function GET() {
  return handle(async () => {
    const actor = await getActor();
    if (actor.role !== "owner")
      fail("Only the workspace owner can view deployment setup", 403);
    let databaseConnected = false;
    try {
      await db.query("SELECT 1");
      databaseConnected = true;
    } catch {}
    return Response.json(
      { checks: deploymentChecks(), databaseConnected },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
