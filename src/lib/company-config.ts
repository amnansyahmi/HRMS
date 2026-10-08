import { z } from "zod";
import { audit, getCompany } from "./auth";
import { transaction, type DB } from "./db";
import { companySettings } from "./schema";
import { fail } from "./errors";
import { employmentLabel, payrollCapabilities } from "./workflow-config";
import type { Actor, Data, HRRecord } from "./types";
export async function employmentData(
  tx: DB,
  actor: Actor,
  input: Data,
  previous?: Data,
) {
  const company = await getCompany(actor, tx);
  const name = String(input.employmentStatus || input.status || "Active");
  const status = company.settings.employeeStatuses.find((s) => s.name === name);
  if (!status) fail("Choose a configured employment status");
  if (!company.settings.employeeTypes.includes(String(input.employmentType)))
    fail("Choose a configured employee type");
  const data: Data = {
    ...input,
    employmentStatus: name,
    status: status.access,
  };
  if (input.designationId) {
    const designation = (
      await tx.query<HRRecord>(
        "SELECT * FROM hr_records WHERE company_id=$1 AND id=$2 AND kind='designation'",
        [actor.companyId, input.designationId],
      )
    ).rows[0];
    if (!designation) fail("Designation unavailable", 404);
    if (!previous || previous.designationId !== input.designationId)
      data.title = designation.data.name;
  }
  return data;
}
export async function saveCompanyConfig(
  actor: Actor,
  input: unknown,
  expectedSettings?: string,
) {
  if (actor.role !== "owner")
    fail("Only the owner can update workspace settings", 403);
  const body = z
    .object({
      name: z.string().trim().min(2).max(100),
      settings: companySettings,
    })
    .parse(input);
  await transaction(async (tx) => {
    await tx.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
      actor.companyId,
    ]);
    const current = await getCompany(actor, tx);
    if (
      expectedSettings &&
      JSON.stringify(current.settings) !== expectedSettings
    )
      fail("Settings changed. Prepare a new action card.", 409);
    const records = (
      await tx.query<HRRecord>(
        "SELECT * FROM hr_records WHERE company_id=$1 AND kind='employee'",
        [actor.companyId],
      )
    ).rows;
    for (const employee of records) {
      const label = employmentLabel(employee.data),
        next = body.settings.employeeStatuses.find((s) => s.name === label);
      if (!next || next.access !== employee.data.status)
        fail(
          `Keep the access behaviour of the in-use status ${label}. Change employees individually before removing or remapping it.`,
        );
      if (
        !body.settings.employeeTypes.includes(
          String(employee.data.employmentType),
        )
      )
        fail("Keep employee types that are still in use");
    }
    for (const name of ["Active", "Onboarding", "Archived"]) {
      if (
        !body.settings.employeeStatuses.some(
          (s) => s.name === name && s.access === name,
        )
      )
        fail("Keep the three base statuses and their access behaviour");
    }
    await tx.query("UPDATE companies SET name=$1,settings=$2 WHERE id=$3", [
      body.name,
      JSON.stringify(body.settings),
      actor.companyId,
    ]);
    await audit(tx, actor, "Updated workspace settings", null, {
      aiEnabled: body.settings.aiEnabled,
    });
  });
  return { ok: true };
}
export async function setPayrollAccess(actor: Actor, input: unknown) {
  if (actor.role !== "owner")
    fail("Only the owner can manage payroll access", 403);
  const body = z
    .object({
      userId: z.uuid(),
      permissions: z.array(z.enum(payrollCapabilities)).max(4),
    })
    .parse(input);
  const permissions = [
    ...new Set(body.permissions.length ? ["read", ...body.permissions] : []),
  ];
  await transaction(async (tx) => {
    const member = (
      await tx.query<{ role: string }>(
        "SELECT role FROM memberships WHERE company_id=$1 AND user_id=$2 FOR UPDATE",
        [actor.companyId, body.userId],
      )
    ).rows[0];
    if (!member) fail("Member unavailable", 404);
    if (member.role === "owner")
      fail("The workspace owner retains full payroll access");
    await tx.query(
      "UPDATE memberships SET payroll_access=$1 WHERE company_id=$2 AND user_id=$3",
      [JSON.stringify(permissions), actor.companyId, body.userId],
    );
    await audit(tx, actor, "Updated payroll access", body.userId, {
      permissions,
    });
  });
  return { ok: true };
}
