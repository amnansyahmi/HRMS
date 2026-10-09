import { z } from "zod";
import { db, transaction } from "./db";
import { audit } from "./auth";
import { fail } from "./errors";
import type { Actor } from "./types";
function owner(actor: Actor) {
  if (actor.role !== "owner")
    fail("Only the owner can manage invitations", 403);
}
export async function pendingInvitations(actor: Actor) {
  owner(actor);
  return (
    await db.query<{
      id: string;
      email: string;
      role: string;
      employee_id: string | null;
      expires_at: string | Date;
      active: boolean;
    }>(
      "SELECT id,email,role,employee_id,expires_at,expires_at>now() AS active FROM invites WHERE company_id=$1 AND accepted_at IS NULL ORDER BY expires_at DESC LIMIT 200",
      [actor.companyId],
    )
  ).rows;
}
export async function revokeInvitation(actor: Actor, input: unknown) {
  owner(actor);
  const { id } = z.object({ id: z.uuid() }).parse(input);
  return transaction(async (tx) => {
    await tx.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
      actor.companyId,
    ]);
    const result = await tx.query(
      "UPDATE invites SET expires_at=least(expires_at,now()) WHERE id=$1 AND company_id=$2 AND accepted_at IS NULL RETURNING id",
      [id, actor.companyId],
    );
    if (!result.rows.length) fail("Invitation unavailable", 404);
    await audit(tx, actor, "Revoked access invitation", id);
    return { ok: true };
  });
}
