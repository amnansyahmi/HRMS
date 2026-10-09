import { getActor, getCompany } from "@/lib/auth";
import { visibleRecords } from "@/lib/hr";
import { buildHRDigest } from "@/lib/hr-digest";
import { handle } from "@/lib/errors";
export const runtime = "nodejs";
export async function GET() {
  return handle(async () => {
    const actor = await getActor();
    return Response.json(
      buildHRDigest(
        actor,
        await getCompany(actor),
        await visibleRecords(actor),
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
