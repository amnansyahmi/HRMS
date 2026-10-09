import { getActor, assertOrigin } from "@/lib/auth";
import { pendingInvitations, revokeInvitation } from "@/lib/access";
import { handle } from "@/lib/errors";
import { jsonBody } from "@/lib/request";
export const runtime = "nodejs";
export async function GET() {
  return handle(async () =>
    Response.json(await pendingInvitations(await getActor())),
  );
}
export async function POST(request: Request) {
  return handle(async () => {
    assertOrigin(request);
    return Response.json(
      await revokeInvitation(await getActor(), await jsonBody(request)),
    );
  });
}
