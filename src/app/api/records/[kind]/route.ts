import { getActor, assertOrigin } from "@/lib/auth";
import { parseKind, visibleRecords, createRecord } from "@/lib/hr";
import { handle } from "@/lib/errors";
import { jsonBody } from "@/lib/request";
export const runtime = "nodejs";
type Context = { params: Promise<{ kind: string }> };
export async function GET(_: Request, { params }: Context) {
  return handle(async () => {
    const kind = parseKind((await params).kind);
    return Response.json(
      (await visibleRecords(await getActor())).filter((r) => r.kind === kind),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
export async function POST(request: Request, { params }: Context) {
  return handle(async () => {
    assertOrigin(request);
    return Response.json(
      await createRecord(
        await getActor(),
        parseKind((await params).kind),
        await jsonBody(request),
      ),
      { status: 201 },
    );
  });
}
