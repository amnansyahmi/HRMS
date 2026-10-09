import { getActor } from "@/lib/auth";
import { aiUsage } from "@/lib/ai-usage";
import { handle } from "@/lib/errors";
export const runtime = "nodejs";
export async function GET() {
  return handle(async () =>
    Response.json(await aiUsage(await getActor()), {
      headers: { "Cache-Control": "private, no-store" },
    }),
  );
}
