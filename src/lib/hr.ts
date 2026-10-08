import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, transaction, type DB } from "./db";
import { audit, getCompany } from "./auth";
import { canCreate, canRead, redact, teamIds } from "./permissions";
import { schemas } from "./schema";
import { fail } from "./errors";
import {
  payrollTotals,
  workingDays,
  localDate,
  assignedShift,
} from "./calculations";
import {
  isStaff,
  kinds,
  type Actor,
  type Data,
  type HRRecord,
  type Kind,
  type Workspace,
} from "./types";
export const normalize = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export async function allRecords(actor: Actor, tx: DB = db) {
  return normalize(
    (
      await tx.query<HRRecord>(
        "SELECT * FROM hr_records WHERE company_id=$1 ORDER BY created_at DESC,id LIMIT 2001",
        [actor.companyId],
      )
    ).rows,
  );
}
export async function visibleRecords(actor: Actor) {
  const records = await allRecords(actor);
  const team = teamIds(
    actor,
    records.filter((r) => r.kind === "employee"),
  );
  return records
    .filter((r) => canRead(actor, r, team))
    .map((r) => redact(actor, r));
}
export async function workspace(actor: Actor): Promise<Workspace> {
  const records = await allRecords(actor),
    team = teamIds(
      actor,
      records.filter((r) => r.kind === "employee"),
    );
  const company = await getCompany(actor);
  const companies = (
    await db.query<{ id: string; name: string; role: Actor["role"] }>(
      "SELECT c.id,c.name,m.role FROM memberships m JOIN companies c ON c.id=m.company_id WHERE m.user_id=$1 ORDER BY c.name",
      [actor.userId],
    )
  ).rows;
  const members =
    actor.role === "owner"
      ? (
          await db.query<Workspace["members"][number]>(
            "SELECT u.id AS user_id,u.name,u.email,m.role,m.employee_id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.company_id=$1 ORDER BY u.name",
            [actor.companyId],
          )
        ).rows
      : [];
  const logs = isStaff(actor)
    ? (
        await db.query<Workspace["audit"][number]>(
          "SELECT a.id,a.action,a.created_at,coalesce(u.name,'Applicant') AS actor_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE a.company_id=$1 ORDER BY a.created_at DESC LIMIT 30",
          [actor.companyId],
        )
      ).rows
    : [];
  return normalize({
    actor,
    company,
    companies,
    records: records
      .slice(0, 2000)
      .filter((r) => canRead(actor, r, team))
      .map((r) => redact(actor, r)),
    members,
    audit: logs,
    ai: {
      configured:
        !!process.env.AI_NONYMAUZ_BASE_URL && !!process.env.AI_NONYMAUZ_API_KEY,
      enabled: company.settings.aiEnabled,
      model: process.env.AI_NONYMAUZ_MODEL || "",
    },
    demo:
      process.env.DEMO_MODE === "true" &&
      process.env.NODE_ENV !== "production" &&
      !process.env.VERCEL,
    truncated: records.length > 2000,
  });
}
export async function recordById(
  actor: Actor,
  id: string,
  kind?: Kind,
  tx: DB = db,
  lock = false,
): Promise<HRRecord> {
  z.uuid().parse(id);
  const result = (
    await tx.query<HRRecord>(
      `SELECT * FROM hr_records WHERE company_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`,
      [actor.companyId, id],
    )
  ).rows[0];
  if (!result || (kind && result.kind !== kind)) fail("Record not found", 404);
  return normalize(result);
}
export async function insertRecord(
  tx: DB,
  actor: Actor,
  kind: Kind,
  data: Data,
  employeeId: string | null = null,
) {
  const id = randomUUID();
  const result = (
    await tx.query<HRRecord>(
      "INSERT INTO hr_records(id,company_id,kind,employee_id,data) VALUES($1,$2,$3,$4,$5) RETURNING *",
      [id, actor.companyId, kind, employeeId, JSON.stringify(data)],
    )
  ).rows[0];
  await audit(tx, actor, `Created ${kind.replaceAll("_", " ")}`, id);
  return normalize(result);
}
async function validateReferences(
  tx: DB,
  actor: Actor,
  kind: Kind,
  data: Data,
  employeeId: string | null,
  currentId?: string,
) {
  if (employeeId) {
    const employee = await recordById(actor, employeeId, "employee", tx);
    if (employee.data.status === "Archived")
      fail("Archived employees cannot receive new records");
  }
  if (data.departmentId)
    await recordById(actor, String(data.departmentId), "department", tx);
  if (data.managerId) {
    if (data.managerId === currentId)
      fail("An employee cannot manage themselves");
    await recordById(actor, String(data.managerId), "employee", tx);
  }
  if (kind === "shift")
    for (const id of data.employeeIds as string[])
      await recordById(actor, id, "employee", tx);
  if (kind === "candidate")
    await recordById(actor, String(data.jobId), "job", tx);
  for (const key of ["receiptId", "resumeFileId", "fileId"])
    if (data[key]) {
      if (
        !(
          await tx.query(
            "SELECT id FROM files WHERE id=$1 AND company_id=$2 AND (uploaded_by=$3 OR $4)",
            [data[key], actor.companyId, actor.userId, isStaff(actor)],
          )
        ).rows.length
      )
        fail("Attachment not found", 404);
    }
}
export async function checkLeave(
  tx: DB,
  actor: Actor,
  employeeId: string,
  data: Data,
  excludeId: string | null = null,
) {
  const company = await getCompany(actor, tx);
  const employee = await recordById(actor, employeeId, "employee", tx, true);
  const start = String(data.startDate),
    end = String(data.endDate);
  if (start.slice(0, 4) !== end.slice(0, 4))
    fail("Split leave requests that cross calendar years");
  const days = workingDays(
    start,
    end,
    company.settings.workDays,
    company.settings.holidays,
  );
  if (!days) fail("This date range has no working days");
  const leaves = (
    await tx.query<HRRecord>(
      "SELECT * FROM hr_records WHERE company_id=$1 AND employee_id=$2 AND kind='leave' AND data->>'status' IN ('Pending','Approved') AND ($3::uuid IS NULL OR id<>$3)",
      [actor.companyId, employeeId, excludeId],
    )
  ).rows;
  if (
    leaves.some(
      (l) => String(l.data.startDate) <= end && String(l.data.endDate) >= start,
    )
  )
    fail("This request overlaps existing leave", 409);
  if (["Annual", "Sick"].includes(String(data.type))) {
    const used = leaves
      .filter(
        (l) =>
          l.data.type === data.type &&
          String(l.data.startDate).slice(0, 4) === start.slice(0, 4),
      )
      .reduce((n, l) => n + Number(l.data.days), 0);
    const allowance = Number(
      employee.data[data.type === "Annual" ? "annualLeave" : "sickLeave"],
    );
    if (used + days > allowance)
      fail(
        `Insufficient ${String(data.type).toLowerCase()} leave balance. ${Math.max(0, allowance - used)} days available.`,
      );
  }
  return days;
}
export async function createRecord(actor: Actor, kind: Kind, input: unknown) {
  const body = z
    .object({
      data: z.record(z.string(), z.unknown()),
      employeeId: z.uuid().nullable().default(null),
    })
    .parse(input);
  const employeeKind = ["leave", "claim", "goal"].includes(kind);
  const employeeId = employeeKind ? body.employeeId || actor.employeeId : null;
  if (!canCreate(actor, kind, employeeId))
    fail("You do not have permission to create this record", 403);
  if (employeeKind && !employeeId) fail("Choose an employee");
  return transaction(async (tx) => {
    await tx.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
      actor.companyId,
    ]);
    if (kind === "goal" && !isStaff(actor)) {
      const employees = (await allRecords(actor, tx)).filter(
        (r) => r.kind === "employee",
      );
      if (!employeeId || !teamIds(actor, employees).includes(employeeId))
        fail("Choose a member of your team", 403);
    }
    let data = { ...body.data };
    if (kind === "leave") {
      data = {
        ...data,
        status: "Pending",
        reviewedBy: null,
        reviewNote: "",
        days: 1,
      };
      data = schemas.leave.parse(data);
      data.days = await checkLeave(tx, actor, employeeId!, data);
    }
    if (kind === "claim")
      data = { ...data, status: "Pending", reviewedBy: null, reviewNote: "" };
    data = schemas[kind].parse(data) as Data;
    await validateReferences(tx, actor, kind, data, employeeId);
    return insertRecord(tx, actor, kind, data, employeeId);
  });
}
export async function updateRecord(
  actor: Actor,
  kind: Kind,
  id: string,
  input: unknown,
) {
  const body = z
    .object({
      data: z.record(z.string(), z.unknown()),
      updatedAt: z.string().min(1),
    })
    .parse(input);
  return transaction(async (tx) => {
    await tx.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
      actor.companyId,
    ]);
    const current = await recordById(actor, id, kind, tx, true);
    if (current.updated_at !== body.updatedAt)
      fail("Someone changed this record. Refresh before saving.", 409);
    let data = { ...current.data, ...body.data };
    if (["attendance", "assessment_result", "leave", "claim"].includes(kind))
      fail("Use the workflow action to change this record", 403);
    if (!isStaff(actor)) {
      const team = teamIds(
        actor,
        (await allRecords(actor, tx)).filter((r) => r.kind === "employee"),
      );
      if (
        kind !== "goal" ||
        !current.employee_id ||
        !team.includes(current.employee_id)
      )
        fail("You cannot edit this record", 403);
      if (actor.role === "employee" || current.employee_id === actor.employeeId)
        data = {
          ...current.data,
          progress: body.data.progress,
          status: body.data.status,
        };
    }
    if (kind === "payroll") {
      if (current.data.status !== "Draft")
        fail("Published payslips are immutable", 409);
      data = {
        ...data,
        status: "Draft",
        employeeName: current.data.employeeName,
        employeeTitle: current.data.employeeTitle,
        period: current.data.period,
      };
      try {
        data = { ...data, ...payrollTotals(data) };
      } catch (error) {
        fail((error as Error).message);
      }
    }
    if (
      kind === "employee" &&
      data.email !== current.data.email &&
      (
        await tx.query(
          "SELECT user_id FROM memberships WHERE company_id=$1 AND employee_id=$2",
          [actor.companyId, id],
        )
      ).rows.length
    )
      fail("An employee with an account must keep the invited email");
    data = schemas[kind].parse(data) as Data;
    await validateReferences(tx, actor, kind, data, current.employee_id, id);
    if (
      kind === "employee" &&
      data.status === "Archived" &&
      current.data.status !== "Archived"
    ) {
      const linked = (
        await tx.query<{ user_id: string; role: string }>(
          "SELECT user_id,role FROM memberships WHERE company_id=$1 AND employee_id=$2 FOR UPDATE",
          [actor.companyId, id],
        )
      ).rows;
      if (linked.some((m) => m.role === "owner"))
        fail("Unlink the workspace owner from this employee before archiving");
      if (
        (
          await tx.query(
            "SELECT id FROM hr_records WHERE company_id=$1 AND employee_id=$2 AND kind='attendance' AND data->>'clockOut' IS NULL",
            [actor.companyId, id],
          )
        ).rows.length
      )
        fail("Clock out this employee before archiving");
      for (const m of linked) {
        await tx.query(
          "DELETE FROM sessions WHERE company_id=$1 AND user_id=$2",
          [actor.companyId, m.user_id],
        );
        await tx.query(
          "DELETE FROM memberships WHERE company_id=$1 AND user_id=$2",
          [actor.companyId, m.user_id],
        );
      }
      await tx.query(
        "DELETE FROM invites WHERE company_id=$1 AND employee_id=$2 AND accepted_at IS NULL",
        [actor.companyId, id],
      );
    }
    const result = (
      await tx.query<HRRecord>(
        "UPDATE hr_records SET data=$1,updated_at=now() WHERE company_id=$2 AND id=$3 RETURNING *",
        [JSON.stringify(data), actor.companyId, id],
      )
    ).rows[0];
    await audit(tx, actor, `Updated ${kind.replaceAll("_", " ")}`, id);
    return normalize(result);
  });
}
export async function reviewRequest(actor: Actor, input: unknown) {
  const body = z
    .object({
      id: z.uuid(),
      decision: z.enum(["Approved", "Rejected", "Cancelled", "Paid"]),
      note: z.string().max(1000).default(""),
    })
    .parse(input);
  return transaction(async (tx) => {
    await tx.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
      actor.companyId,
    ]);
    const current = await recordById(actor, body.id, undefined, tx, true);
    if (!["leave", "claim"].includes(current.kind))
      fail("This record has no approval workflow");
    const employee = await recordById(
      actor,
      current.employee_id!,
      "employee",
      tx,
      true,
    );
    const own =
      current.employee_id === actor.employeeId ||
      employee.data.email === actor.email;
    if (body.decision === "Cancelled") {
      if (!own || current.data.status !== "Pending")
        fail("Only your pending requests can be cancelled", 403);
    } else {
      const team = teamIds(
        actor,
        (await allRecords(actor, tx)).filter((r) => r.kind === "employee"),
      );
      if (
        !isStaff(actor) &&
        (actor.role !== "manager" || !team.includes(current.employee_id!))
      )
        fail("You cannot review this request", 403);
      if (own) fail("Your request needs another reviewer", 403);
      const expected = body.decision === "Paid" ? "Approved" : "Pending";
      if (
        current.data.status !== expected ||
        (body.decision === "Paid" && current.kind !== "claim")
      )
        fail("This request has already been processed", 409);
      if (body.decision === "Paid" && !isStaff(actor))
        fail("Only HR can mark a claim as paid", 403);
      if (current.kind === "leave" && body.decision === "Approved")
        current.data.days = await checkLeave(
          tx,
          actor,
          current.employee_id!,
          current.data,
          current.id,
        );
    }
    const data = {
      ...current.data,
      status: body.decision,
      reviewedBy: actor.userId,
      reviewNote: body.note,
    };
    await tx.query(
      "UPDATE hr_records SET data=$1,updated_at=now() WHERE company_id=$2 AND id=$3",
      [JSON.stringify(data), actor.companyId, current.id],
    );
    await audit(tx, actor, `${body.decision} ${current.kind}`, current.id);
    return data;
  });
}
export async function clock(actor: Actor, input: unknown) {
  const body = z
    .object({
      action: z.enum(["in", "out"]),
      location: z.enum(["Office", "Remote", "Client site"]).default("Office"),
    })
    .parse(input);
  if (!actor.employeeId)
    fail("Your account must be linked to an employee record to clock in");
  return transaction(async (tx) => {
    const employee = await recordById(
      actor,
      actor.employeeId!,
      "employee",
      tx,
      true,
    );
    if (employee.data.status === "Archived")
      fail("This employee is archived", 403);
    const now = new Date(),
      company = await getCompany(actor, tx),
      workDate = localDate(now, company.settings.timezone);
    const open = (
      await tx.query<HRRecord>(
        "SELECT * FROM hr_records WHERE company_id=$1 AND employee_id=$2 AND kind='attendance' AND data->>'clockOut' IS NULL FOR UPDATE",
        [actor.companyId, actor.employeeId],
      )
    ).rows[0];
    if (body.action === "out") {
      if (!open) fail("You have no open clock-in", 409);
      const data = { ...open.data, clockOut: now.toISOString() };
      const closed = (
        await tx.query<HRRecord>(
          "UPDATE hr_records SET data=$1,updated_at=now() WHERE id=$2 AND company_id=$3 RETURNING *",
          [JSON.stringify(data), open.id, actor.companyId],
        )
      ).rows[0];
      await audit(tx, actor, "Clocked out", open.id);
      return normalize(closed);
    }
    if (open) fail("You are already clocked in", 409);
    const shift = assignedShift(
      now,
      company.settings.timezone,
      (await allRecords(actor, tx)).filter(
        (r) =>
          r.kind === "shift" &&
          (r.data.employeeIds as string[]).includes(actor.employeeId!),
      ),
    );
    return insertRecord(
      tx,
      actor,
      "attendance",
      {
        workDate: shift?.workDate || workDate,
        clockIn: now.toISOString(),
        clockOut: null,
        shiftId: shift?.id || null,
        lateMinutes: shift?.lateMinutes || 0,
        location: body.location,
      },
      actor.employeeId,
    );
  });
}
export async function generatePayroll(actor: Actor, input: unknown) {
  if (!isStaff(actor)) fail("Only HR can prepare payroll", 403);
  const { period } = z
    .object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) })
    .parse(input);
  return transaction(async (tx) => {
    await tx.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
      actor.companyId,
    ]);
    const employees = (
      await tx.query<HRRecord>(
        "SELECT * FROM hr_records WHERE company_id=$1 AND kind='employee' AND data->>'status'='Active' AND data->>'startDate'<=$2",
        [actor.companyId, period + "-31"],
      )
    ).rows;
    let created = 0;
    for (const employee of employees) {
      if (
        (
          await tx.query(
            "SELECT id FROM hr_records WHERE company_id=$1 AND employee_id=$2 AND kind='payroll' AND data->>'period'=$3",
            [actor.companyId, employee.id, period],
          )
        ).rows.length
      )
        continue;
      const base = Number(employee.data.salary);
      const data = schemas.payroll.parse({
        period,
        base,
        allowance: 0,
        overtime: 0,
        bonus: 0,
        epfEmployee: 0,
        socsoEmployee: 0,
        eisEmployee: 0,
        pcb: 0,
        otherDeduction: 0,
        epfEmployer: 0,
        socsoEmployer: 0,
        eisEmployer: 0,
        gross: base,
        net: base,
        status: "Draft",
        employeeName: employee.data.name,
        employeeTitle: employee.data.title,
        reviewed: false,
        note: "",
      });
      await insertRecord(tx, actor, "payroll", data, employee.id);
      created++;
    }
    return { created };
  });
}
export async function publishPayroll(actor: Actor, input: unknown) {
  if (!isStaff(actor)) fail("Only HR can publish payslips", 403);
  const { period } = z
    .object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) })
    .parse(input);
  return transaction(async (tx) => {
    await tx.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
      actor.companyId,
    ]);
    const drafts = (
      await tx.query<HRRecord>(
        "SELECT * FROM hr_records WHERE company_id=$1 AND kind='payroll' AND data->>'period'=$2 AND data->>'status'='Draft' FOR UPDATE",
        [actor.companyId, period],
      )
    ).rows;
    if (!drafts.length) fail("No draft payslips for this period");
    if (drafts.some((r) => !r.data.reviewed))
      fail("Review every draft and its statutory deductions before publishing");
    for (const draft of drafts)
      await tx.query(
        "UPDATE hr_records SET data=$1,updated_at=now() WHERE company_id=$2 AND id=$3",
        [
          JSON.stringify({ ...draft.data, status: "Published" }),
          actor.companyId,
          draft.id,
        ],
      );
    await audit(tx, actor, "Published payroll", null, {
      period,
      count: drafts.length,
    });
    return { published: drafts.length };
  });
}
export function parseKind(value: string): Kind {
  if (!kinds.includes(value as Kind)) fail("Resource not found", 404);
  return value as Kind;
}
