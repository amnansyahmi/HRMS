import { getActor, assertOrigin, audit } from "@/lib/auth";
import { workspace } from "@/lib/hr";
import { companySettings } from "@/lib/schema";
import { handle, fail } from "@/lib/errors";
import { transaction } from "@/lib/db";
import { jsonBody } from "@/lib/request";
import { z } from "zod";
export const runtime = "nodejs";
export async function GET() {
  return handle(async () =>
    Response.json(await workspace(await getActor()), {
      headers: { "Cache-Control": "private, no-store" },
    }),
  );
}
export async function PATCH(request: Request) {
  return handle(async () => {
    assertOrigin(request);
    const actor = await getActor();
    if (actor.role !== "owner")
      fail("Only the owner can update workspace settings", 403);
    const body = z
      .object({
        name: z.string().trim().min(2).max(100),
        settings: companySettings,
      })
      .parse(await jsonBody(request));
    await transaction(async (tx) => {
      await tx.query("UPDATE companies SET name=$1,settings=$2 WHERE id=$3", [
        body.name,
        JSON.stringify(body.settings),
        actor.companyId,
      ]);
      await audit(tx, actor, "Updated workspace settings", null, {
        aiEnabled: body.settings.aiEnabled,
      });
    });
    return Response.json({ ok: true });
  });
}
