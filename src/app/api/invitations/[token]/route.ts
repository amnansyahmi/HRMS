import { db } from "@/lib/db";
import { hashToken } from "@/lib/auth";
import { handle, fail } from "@/lib/errors";
export const runtime = "nodejs";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  return handle(async () => {
    const { token } = await params;
    if (!/^[a-f0-9]{64}$/.test(token)) fail("Invitation not found", 404);
    const invite = (
      await db.query<{ email: string; role: string; company: string }>(
        "SELECT i.email,i.role,c.name AS company FROM invites i JOIN companies c ON c.id=i.company_id WHERE i.token_hash=$1 AND i.expires_at>now() AND i.accepted_at IS NULL",
        [hashToken(token)],
      )
    ).rows[0];
    if (!invite) fail("Invitation expired or already used", 410);
    return Response.json(invite, { headers: { "Cache-Control": "no-store" } });
  });
}
