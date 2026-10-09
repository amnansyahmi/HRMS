import {
  requestAccountToken,
  consumeAccountToken,
  setupMFA,
  enableMFA,
  disableMFA,
} from "@/lib/account";
import { z } from "zod";
import { cookies } from "next/headers";
import {
  assertOrigin,
  signup,
  login,
  logout,
  getActor,
  acceptInvite,
  createInvite,
  COOKIE,
  hashToken,
  audit,
  rateLimit,
} from "@/lib/auth";
import { demoLogin } from "@/lib/demo";
import { db, transaction } from "@/lib/db";
import { handle, fail } from "@/lib/errors";
import { jsonBody } from "@/lib/request";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  return handle(async () => {
    assertOrigin(request);
    const { action } = await params;
    if (action === "logout") {
      await logout();
      return Response.json({ ok: true });
    }
    const body = await jsonBody(request);
    if (action === "forgot")
      return Response.json(await requestAccountToken(body, "reset"));
    if (action === "reset" || action === "verify")
      return Response.json(
        await consumeAccountToken(
          body,
          action === "reset" ? "reset" : "verify",
        ),
      );
    if (action === "request-verification") {
      const actor = await getActor();
      return Response.json(
        await requestAccountToken({ email: actor.email }, "verify", actor),
      );
    }
    if (action === "mfa-setup")
      return Response.json(await setupMFA(await getActor()));
    if (action === "mfa-enable")
      return Response.json(await enableMFA(await getActor(), body));
    if (action === "mfa-disable")
      return Response.json(await disableMFA(await getActor(), body));
    if (action === "signup") await signup(body);
    else if (action === "login") await login(body);
    else if (action === "accept") await acceptInvite(body);
    else if (action === "demo") {
      await rateLimit("demo-login", 60, 3600);
      await demoLogin(
        z
          .object({
            role: z
              .enum(["owner", "hr", "manager", "employee"])
              .default("owner"),
          })
          .parse(body).role,
      );
    } else if (action === "invite")
      return Response.json(await createInvite(await getActor(), body));
    else if (action === "switch") {
      const actor = await getActor(),
        { companyId } = z.object({ companyId: z.uuid() }).parse(body);
      if (
        !(
          await db.query(
            "SELECT user_id FROM memberships WHERE user_id=$1 AND company_id=$2",
            [actor.userId, companyId],
          )
        ).rows.length
      )
        fail("Workspace access denied", 403);
      const session = (await cookies()).get(COOKIE)!.value;
      await db.query("UPDATE sessions SET company_id=$1 WHERE token_hash=$2", [
        companyId,
        hashToken(session),
      ]);
    } else if (action === "link-member") {
      const actor = await getActor(),
        { userId, employeeId } = z
          .object({ userId: z.uuid(), employeeId: z.uuid().nullable() })
          .parse(body);
      if (actor.role !== "owner") fail("Only the owner can link accounts", 403);
      await transaction(async (tx) => {
        const member = (
          await tx.query<{ role: string; email: string }>(
            "SELECT m.role,u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.company_id=$1 AND m.user_id=$2 FOR UPDATE OF m",
            [actor.companyId, userId],
          )
        ).rows[0];
        if (!member) fail("Member not found", 404);
        if (!employeeId && ["manager", "employee"].includes(member.role))
          fail("This role must stay linked to an employee");
        if (employeeId) {
          const employee = (
            await tx.query<{ data: { email: string; status: string } }>(
              "SELECT data FROM hr_records WHERE company_id=$1 AND id=$2 AND kind='employee'",
              [actor.companyId, employeeId],
            )
          ).rows[0];
          if (
            !employee ||
            employee.data.email !== member.email ||
            employee.data.status === "Archived"
          )
            fail(
              "Choose an active employee with the same email as this account",
            );
        }
        await tx.query(
          "UPDATE memberships SET employee_id=$1 WHERE company_id=$2 AND user_id=$3",
          [employeeId, actor.companyId, userId],
        );
        await audit(tx, actor, "Linked member to employee", userId);
      });
    } else if (action === "remove-member") {
      const actor = await getActor(),
        { userId } = z.object({ userId: z.uuid() }).parse(body);
      if (actor.role !== "owner" || userId === actor.userId)
        fail("You cannot remove this account", 403);
      await transaction(async (tx) => {
        const member = (
          await tx.query<{ role: string }>(
            "SELECT role FROM memberships WHERE company_id=$1 AND user_id=$2 FOR UPDATE",
            [actor.companyId, userId],
          )
        ).rows[0];
        if (!member || member.role === "owner")
          fail("You cannot remove this account", 403);
        await tx.query(
          "DELETE FROM memberships WHERE company_id=$1 AND user_id=$2",
          [actor.companyId, userId],
        );
        await tx.query(
          "DELETE FROM sessions WHERE company_id=$1 AND user_id=$2",
          [actor.companyId, userId],
        );
        await audit(tx, actor, "Removed workspace access", userId);
      });
    } else fail("Action not found", 404);
    return Response.json({ ok: true });
  });
}
