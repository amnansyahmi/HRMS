import { z } from "zod";
import { transaction } from "./db";
import { recordById, insertRecord } from "./hr";
import { audit } from "./auth";
import { notify } from "./notifications";
import { fail } from "./errors";
import { schemas } from "./schema";
import { profileFields } from "./profile-fields";
import { isStaff, type Actor } from "./types";

export async function submitProfileChange(actor: Actor, input: unknown) {
  const body = z
    .object({
      employeeUpdatedAt: z.string().min(1),
      changes: z
        .record(z.string(), z.string())
        .refine((v) => Object.keys(v).length > 0, "Change at least one field"),
      reason: z.string().trim().min(1).max(1000),
    })
    .parse(input);
  if (!actor.employeeId) fail("Link your account to an employee first", 403);
  for (const [key, value] of Object.entries(body.changes)) {
    const field = profileFields.find((f) => f.key === key);
    if (!field || value.length > field.max)
      fail("Choose supported contact or emergency contact fields");
  }
  return transaction(async (tx) => {
    await tx.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
      actor.companyId,
    ]);
    const employee = await recordById(
      actor,
      actor.employeeId!,
      "employee",
      tx,
      true,
    );
    if (employee.data.status === "Archived")
      fail("This employee profile is archived", 409);
    if (employee.updated_at !== body.employeeUpdatedAt)
      fail("Your profile changed. Refresh before submitting.", 409);
    const pending = await tx.query(
      "SELECT id FROM hr_records WHERE company_id=$1 AND employee_id=$2 AND kind='profile_change' AND data->>'status'='Pending'",
      [actor.companyId, employee.id],
    );
    if (pending.rows.length)
      fail(
        "HR is already reviewing a profile change. Cancel it before sending another.",
        409,
      );
    const changes = Object.fromEntries(
      Object.entries(body.changes)
        .map(([k, v]) => [k, v.trim()])
        .filter(([k, v]) => String(employee.data[k] || "") !== v),
    );
    if (!Object.keys(changes).length) fail("Change at least one field");
    const checked = schemas.employee.parse({ ...employee.data, ...changes });
    const previous = Object.fromEntries(
      Object.keys(changes).map((k) => [k, String(employee.data[k] || "")]),
    );
    const record = await insertRecord(
      tx,
      actor,
      "profile_change",
      schemas.profile_change.parse({
        changes: Object.fromEntries(
          Object.keys(changes).map((k) => [
            k,
            String((checked as Record<string, unknown>)[k] || ""),
          ]),
        ),
        previous,
        reason: body.reason,
        status: "Pending",
        submittedBy: actor.userId,
      }),
      employee.id,
    );
    await notify(
      tx,
      actor,
      "Profile change needs review",
      `${employee.data.name} requested an update to their contact details.`,
      "/?view=approvals",
      employee.id,
      "hr",
    );
    return record;
  });
}

export async function reviewProfileChange(actor: Actor, input: unknown) {
  const body = z
    .object({
      id: z.uuid(),
      expectedUpdatedAt: z.string().min(1),
      decision: z.enum(["Approved", "Rejected", "Cancelled"]),
      note: z.string().trim().max(1000).default(""),
    })
    .parse(input);
  if (body.decision === "Rejected" && !body.note)
    fail("Explain why the profile change was rejected");
  return transaction(async (tx) => {
    await tx.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
      actor.companyId,
    ]);
    const request = await recordById(
      actor,
      body.id,
      "profile_change",
      tx,
      true,
    );
    const employee = await recordById(
      actor,
      request.employee_id!,
      "employee",
      tx,
      true,
    );
    const own =
      employee.id === actor.employeeId ||
      employee.data.email === actor.email ||
      request.data.submittedBy === actor.userId;
    if (body.decision === "Cancelled" ? !own : !isStaff(actor) || own)
      fail("This change needs another HR reviewer", 403);
    if (
      request.data.status !== "Pending" ||
      request.updated_at !== body.expectedUpdatedAt
    )
      fail("This request changed. Refresh before confirming.", 409);
    if (body.decision === "Approved") {
      if (employee.data.status === "Archived")
        fail("This employee profile is archived", 409);
      const changes = request.data.changes as Record<string, string>,
        previous = request.data.previous as Record<string, string>;
      for (const key of Object.keys(changes)) {
        if (!profileFields.some((f) => f.key === key))
          fail("Unsupported profile change");
        if (String(employee.data[key] || "") !== previous[key])
          fail(
            "HR has changed these fields. Ask the employee to submit a fresh request.",
            409,
          );
      }
      const updated = schemas.employee.parse({ ...employee.data, ...changes });
      await tx.query(
        "UPDATE hr_records SET data=$1,updated_at=now() WHERE company_id=$2 AND id=$3",
        [JSON.stringify(updated), actor.companyId, employee.id],
      );
      // Keep sensitive values out of generic audit/search feeds.
      await audit(tx, actor, "Applied employee profile change", employee.id, {
        requestId: request.id,
        fields: Object.keys(changes),
      });
    }
    const data = {
      ...request.data,
      status: body.decision,
      reviewNote: body.note,
      reviewedBy: actor.userId,
      reviewedAt: new Date().toISOString(),
    };
    await tx.query(
      "UPDATE hr_records SET data=$1,updated_at=now() WHERE company_id=$2 AND id=$3",
      [JSON.stringify(data), actor.companyId, request.id],
    );
    await audit(tx, actor, `${body.decision} profile change`, request.id);
    await notify(
      tx,
      actor,
      `Profile change ${body.decision.toLowerCase()}`,
      body.note ||
        (body.decision === "Approved"
          ? "Your requested contact details have been updated."
          : "Your profile change was cancelled."),
      "/?view=my-profile",
      employee.id,
    );
    return { ok: true };
  });
}
