import { getActor, assertOrigin } from "@/lib/auth";
import { parseKind, updateRecord } from "@/lib/hr";
import { handle } from "@/lib/errors";
import { jsonBody } from "@/lib/request";
export const runtime = "nodejs";
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ kind: string; id: string }> },
) {
  return handle(async () => {
    assertOrigin(request);
    const { kind, id } = await params;
    return Response.json(
      await updateRecord(
        await getActor(),
        parseKind(kind),
        id,
        await jsonBody(request),
      ),
    );
  });
}
