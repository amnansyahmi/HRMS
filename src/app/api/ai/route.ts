import { getActor, assertOrigin } from "@/lib/auth";
import { askAI, aiHistory } from "@/lib/ai";
import { handle } from "@/lib/errors";
import { jsonBody } from "@/lib/request";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  return handle(async () => {
    assertOrigin(request);
    return Response.json(
      await askAI(await getActor(), await jsonBody(request), request.signal),
    );
  });
}
export async function GET(request: Request) {
  return handle(async () =>
    Response.json(
      await aiHistory(
        await getActor(),
        new URL(request.url).searchParams.get("thread") || undefined,
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    ),
  );
}
