import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, transaction, type DB } from "./db";
import { audit, getCompany, token, hashToken } from "./auth";
import { canCreate, canRead, redact, teamIds } from "./permissions";
import {
  employeeKinds,
  requestKinds,
  leaveDays,
  claimBalance,
  selectedPolicy,
  approvalRule,
  checkTimeOff,
} from "./policies";
import { calculateStatutory } from "./statutory";
import { payrollInputs } from "./payroll-inputs";
import { companyHolidays } from "./policies";
import { notify, queueEmail } from "./notifications";
import { schemas } from "./schema";
import { fail } from "./errors";
import {
  payrollTotals,
  localDate,
  assignedShift,
  distanceMetres,
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
        "SELECT * FROM hr_records WHERE company_id=$1 ORDER BY created_at DESC,id",
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
    .filter((r) =>
      canRead(
        actor,
        r,
        team,
        records.find((e) => e.id === actor.employeeId)?.data.departmentId,
      ),
    )
    .map((r) => redact(actor, r));
}
export async function recordPage(actor: Actor, cursor: string | null = null) {
  let after: { at: string; id: string } | null = null;
  if (cursor) {
    const [at, id] = cursor.split("|");
    after = z.object({ at: z.iso.datetime(), id: z.uuid() }).parse({ at, id });
  }
  const employees = normalize(
    (
      await db.query<HRRecord>(
        "SELECT * FROM hr_records WHERE company_id=$1 AND kind='employee'",
        [actor.companyId],
      )
    ).rows,
  );
  const team = teamIds(actor, employees),
    department = employees.find((e) => e.id === actor.employeeId)?.data
      .departmentId;
  const rows = normalize(
    (
      await db.query<HRRecord & { cursor_at: string }>(
        `SELECT *,to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at FROM hr_records WHERE company_id=$1 AND ($2::timestamptz IS NULL OR created_at<$2 OR (created_at=$2 AND id>$3::uuid)) ORDER BY created_at DESC,id LIMIT 501`,
        [actor.companyId, after?.at || null, after?.id || null],
      )
    ).rows,
  );
  const page = rows.slice(0, 500),
    last = page.at(-1);
  return {
    records: page
      .filter((r) => canRead(actor, r, team, department))
      .map(({ cursor_at: _cursorAt, ...r }) => {
        void _cursorAt;
        return redact(actor, r);
      }),
    nextCursor:
      rows.length > 500 && last ? `${last.cursor_at}|${last.id}` : null,
  };
}
export async function workspace(actor: Actor): Promise<Workspace> {
  const page = await recordPage(actor);
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
    records: page.records,
    members,
    audit: logs,
    ai: {
      configured:
        !!process.env.AI_NONYMAUZ_BASE_URL && !!process.env.AI_NONYMAUZ_API_KEY,
      enabled: company.settings.aiEnabled,
      model: process.env.AI_NONYMAUZ_MODEL || "",
    },
    demo: !!(
      await db.query<{ is_demo: boolean }>(
        "SELECT is_demo FROM companies WHERE id=$1",
        [actor.companyId],
      )
    ).rows[0]?.is_demo,
    truncated: false,
    nextCursor: page.nextCursor,
    notifications: (
      await db.query<Workspace["notifications"][number]>(
        "SELECT id,title,body,href,read_at,created_at FROM notifications WHERE company_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 50",
        [actor.companyId, actor.userId],
      )
    ).rows,
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
  let invitationUrl: string | undefined;
  if (
    kind === "employee" &&
    data.status !== "Archived" &&
    !(
      await tx.query(
        "SELECT m.user_id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.company_id=$1 AND u.email=$2",
        [actor.companyId, data.email],
      )
    ).rows.length
  ) {
    const plain = token();
    await tx.query(
      "DELETE FROM invites WHERE company_id=$1 AND email=$2 AND accepted_at IS NULL",
      [actor.companyId, data.email],
    );
    await tx.query(
      "INSERT INTO invites(id,company_id,email,role,employee_id,token_hash,expires_at) VALUES($1,$2,$3,'employee',$4,$5,now()+interval '3 days')",
      [randomUUID(), actor.companyId, data.email, id, hashToken(plain)],
    );
    invitationUrl = `${process.env.APP_URL || "http://localhost:3000"}/invite/${plain}`;
    await queueEmail(
      tx,
      actor.companyId,
      String(data.email),
      "Set up your employee account",
      `Your employee profile is ready. Create your account using this private link within three days:\n${invitationUrl}`,
    );
  }
  return normalize({ ...result, ...(invitationUrl ? { invitationUrl } : {}) });
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
  if (data.locationId)
    await recordById(actor, String(data.locationId), "location", tx);
  if (data.cycleId)
    await recordById(actor, String(data.cycleId), "review_cycle", tx);
  if (data.parentId) {
    const parent = await recordById(actor, String(data.parentId), "goal", tx);
    let node: HRRecord | null = parent;
    const seen = new Set<string>();
    while (node) {
      if (node.id === currentId || seen.has(node.id))
        fail("A goal hierarchy cannot contain a cycle");
      if (seen.size >= 50) fail("A goal hierarchy cannot exceed 50 levels");
      seen.add(node.id);
      node = node.data.parentId
        ? await recordById(actor, String(node.data.parentId), "goal", tx)
        : null;
    }
  }
  for (const id of (data.departmentIds as string[]) || [])
    await recordById(actor, id, "department", tx);
  for (const id of (data.sharedEmployeeIds as string[]) || [])
    await recordById(actor, id, "employee", tx);
  if (data.linkedEmployeeId)
    await recordById(actor, String(data.linkedEmployeeId), "employee", tx);
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
  for (const key of ["receiptId", "resumeFileId", "fileId", "evidenceId"])
    if (data[key]) {
      const file = (
        await tx.query<{ uploaded_by: string }>(
          "SELECT uploaded_by FROM files WHERE id=$1 AND company_id=$2",
          [data[key], actor.companyId],
        )
      ).rows[0];
      if (!file) fail("Attachment not found", 404);
      if (file.uploaded_by !== actor.userId) {
        const records = await allRecords(actor, tx),
          employees = records.filter((r) => r.kind === "employee"),
          team = teamIds(actor, employees),
          department = employees.find((e) => e.id === actor.employeeId)?.data
            .departmentId;
        if (
          !records.some(
            (r) =>
              canRead(actor, r, team, department) &&
              ["receiptId", "resumeFileId", "fileId", "evidenceId"].some(
                (k) => r.data[k] === data[key],
              ),
          )
        )
          fail("Attachment not found", 404);
      }
    }
}
export async function checkLeave(
  tx: DB,
  actor: Actor,
  employeeId: string,
  data: Data,
  excludeId: string | null = null,
) {
  const employee = await recordById(actor, employeeId, "employee", tx, true);
  return leaveDays(tx, actor, employee, data, excludeId);
}
export async function createRecord(actor: Actor, kind: Kind, input: unknown) {
  const body = z
    .object({
      data: z.record(z.string(), z.unknown()),
      employeeId: z.uuid().nullable().default(null),
    })
    .parse(input);
  const employeeKind =
    employeeKinds.includes(kind) &&
    !(
      kind === "goal" &&
      ["Company", "Team"].includes(String(body.data.scope)) &&
      isStaff(actor)
    );
  const employeeId = employeeKind ? body.employeeId || actor.employeeId : null;
  if (!canCreate(actor, kind, employeeId))
    fail("You do not have permission to create this record", 403);
  if (employeeKind && !employeeId) fail("Choose an employee");
  return transaction(async (tx) => {
    await tx.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
      actor.companyId,
    ]);
    if (
      kind === "goal" &&
      ["Company", "Team"].includes(String(body.data.scope)) &&
      !isStaff(actor)
    )
      fail("Only HR can manage company and team goals", 403);
    if (
      kind === "goal" &&
      body.data.scope === "Team" &&
      !body.data.departmentId
    )
      fail("Choose a department for the team goal");
    if (kind === "goal" && !isStaff(actor)) {
      const employees = (await allRecords(actor, tx)).filter(
        (r) => r.kind === "employee",
      );
      if (!employeeId || !teamIds(actor, employees).includes(employeeId))
        fail("Choose a member of your team", 403);
    }
    let data = { ...body.data };
    if (kind === "meeting")
      data = {
        ...data,
        createdBy: actor.userId,
        audioIds: [],
        audioTracks: [],
        segments: [],
      };
    if (kind === "letter") data.status = "Draft";
    if (kind === "candidate") {
      data.employeeId = null;
      data.stageHistory = [
        {
          stage: data.stage || "Applied",
          at: new Date().toISOString(),
          by: actor.name,
        },
      ];
      if (data.stage === "Hired") fail("Use the hire workflow");
    }
    if (kind === "goal" && Number(data.progress || 0) > Number(data.target))
      fail("Progress cannot exceed the target");
    if (kind === "lifecycle") data.status = "In progress";
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
    if (requestKinds.includes(kind))
      data = {
        ...data,
        status: "Pending",
        reviewedBy: null,
        reviewNote: "",
        approvalStep: 0,
        reviewedAt: null,
      };
    data = schemas[kind].parse(data) as Data;
    await validateReferences(tx, actor, kind, data, employeeId);
    if (kind === "time_off") await checkTimeOff(tx, actor, employeeId!, data);
    if (kind === "claim")
      await claimBalance(
        tx,
        actor,
        await recordById(actor, employeeId!, "employee", tx, true),
        data,
      );
    if (
      ["attendance_correction", "lateness"].includes(kind) &&
      data.attendanceId
    ) {
      const attendance = await recordById(
        actor,
        String(data.attendanceId),
        "attendance",
        tx,
      );
      if (attendance.employee_id !== employeeId)
        fail("Choose your own attendance record", 403);
    }
    if (kind === "attendance_correction") {
      const company = await getCompany(actor, tx);
      const date =
        assignedShift(
          new Date(String(data.clockIn)),
          company.settings.timezone,
          (await allRecords(actor, tx)).filter(
            (r) =>
              r.kind === "shift" &&
              (r.data.employeeIds as string[]).includes(employeeId!),
          ),
        )?.workDate ||
        localDate(new Date(String(data.clockIn)), company.settings.timezone);
      if (data.workDate !== date)
        fail("Shift date must match the clock-in date in the company timezone");
    }
    if (kind === "goal_update") {
      const goal = await recordById(actor, String(data.goalId), "goal", tx);
      if (
        goal.employee_id !== employeeId ||
        Number(data.progress) > Number(goal.data.target)
      )
        fail("Choose a valid goal and progress");
    }
    if (kind === "overtime") {
      const rows = (
        await tx.query<HRRecord>(
          "SELECT * FROM hr_records WHERE company_id=$1 AND employee_id=$2 AND kind='overtime' AND data->>'date'=$3 AND data->>'status' IN ('Pending','Approved')",
          [actor.companyId, employeeId, data.date],
        )
      ).rows;
      if (
        rows.reduce((n, r) => n + Number(r.data.hours), 0) +
          Number(data.hours) >
        24
      )
        fail("Overtime on one date cannot exceed 24 hours");
    }
    if (kind === "evaluation") {
      const template = await recordById(
        actor,
        String(data.templateId),
        "evaluation_template",
        tx,
      );
      await recordById(actor, String(data.cycleId), "review_cycle", tx);
      data = {
        ...data,
        templateSnapshot: template.data,
        status: "Draft",
        score: 0,
        ratings: [],
      };
    }
    const record = await insertRecord(tx, actor, kind, data, employeeId);
    if (requestKinds.includes(kind))
      await notify(
        tx,
        actor,
        `New ${kind.replaceAll("_", " ")} request`,
        `${actor.name} submitted a request.`,
        `/?view=${kind === "leave" ? "leave" : kind === "claim" ? "claims" : "time"}`,
        employeeId!,
        true,
      );
    return record;
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
    if (
      kind === "meeting" &&
      current.data.createdBy !== actor.userId &&
      actor.role !== "owner"
    )
      fail("Only the recorder or owner can edit this meeting", 403);
    let data = { ...current.data, ...body.data };
    if (kind === "meeting")
      data = {
        ...data,
        createdBy: current.data.createdBy,
        audioIds: current.data.audioIds,
        audioTracks: current.data.audioTracks,
      };
    if (kind === "letter") data.status = current.data.status;
    if (kind === "lifecycle")
      fail("Use the checklist workflow to update tasks", 403);
    if (kind === "candidate") {
      data.employeeId = current.data.employeeId;
      data.stageHistory = current.data.stageHistory;
      if (data.stage === "Hired" && current.data.stage !== "Hired")
        fail("Use the hire workflow to create the employee", 403);
    }
    if (kind === "goal" && data.scope !== current.data.scope)
      fail("Create a new goal to change its scope");
    if (kind === "goal" && data.scope === "Team" && !data.departmentId)
      fail("Choose a department for the team goal");
    if (kind === "goal" && Number(data.progress) > Number(data.target))
      fail("Progress cannot exceed the target");
    if (
      [
        "attendance",
        "assessment_result",
        "job_history",
        "payment_voucher",
        ...requestKinds,
      ].includes(kind)
    )
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
    if (kind === "candidate" && data.stage !== current.data.stage) {
      data.stageHistory = [
        ...((current.data.stageHistory as unknown[]) || []),
        { stage: data.stage, at: new Date().toISOString(), by: actor.name },
      ];
    }
    if (kind === "letter" && current.data.status === "Issued")
      fail("Issued letters are immutable", 409);
    if (kind === "evaluation") fail("Use the evaluation workflow", 403);
    if (kind === "payroll") {
      if (current.data.status !== "Draft")
        fail("Published payslips are immutable", 409);
      const earningsChanged = [
        "base",
        "allowance",
        "overtime",
        "bonus",
        "commission",
        "unpaidDeduction",
        "taxableNormal",
        "taxableAdditional",
        "epfWages",
        "epfNormalWages",
        "socsoWages",
      ].some((key) => data[key] !== current.data[key]);
      data = {
        ...data,
        calculation: earningsChanged ? {} : current.data.calculation,
        inputRecordIds: current.data.inputRecordIds,
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
    if (
      kind === "employee" &&
      (data.title !== current.data.title ||
        data.salary !== current.data.salary ||
        data.departmentId !== current.data.departmentId)
    )
      await insertRecord(
        tx,
        actor,
        "job_history",
        {
          title: String(data.title),
          effectiveDate: localDate(
            new Date(),
            (await getCompany(actor, tx)).settings.timezone,
          ),
          previousTitle: current.data.title,
          previousSalary: current.data.salary,
          newSalary: data.salary,
          departmentId: data.departmentId,
          notes: "Recorded from employee update",
        },
        id,
      );
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
      expectedUpdatedAt: z.string().optional(),
    })
    .parse(input);
  return transaction(async (tx) => {
    await tx.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
      actor.companyId,
    ]);
    const current = await recordById(actor, body.id, undefined, tx, true);
    if (body.expectedUpdatedAt && body.expectedUpdatedAt !== current.updated_at)
      fail("The request changed. Refresh before confirming.", 409);
    if (!requestKinds.includes(current.kind))
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
      if (
        body.decision === "Paid" &&
        (current.data.payrollId || current.data.voucherId)
      )
        fail("Record payment through the linked payment voucher", 409);
      if (body.decision === "Paid" && !isStaff(actor))
        fail("Only HR can mark a claim as paid", 403);
      const policy =
        current.kind === "leave" || current.kind === "claim"
          ? await selectedPolicy(
              tx,
              actor,
              current.kind,
              current.data,
              employee,
            )
          : null;
      const rule = approvalRule(policy);
      if (body.decision === "Approved") {
        if (rule === "HR only" && !isStaff(actor))
          fail("This policy requires HR approval", 403);
        if (rule === "Manager then HR" && employee.data.managerId) {
          if (!current.data.approvalStep) {
            if (actor.employeeId !== employee.data.managerId)
              fail("The reporting manager must approve first", 403);
            current.data.approvalStep = 1;
            await tx.query(
              "UPDATE hr_records SET data=$1,updated_at=now() WHERE id=$2 AND company_id=$3",
              [
                JSON.stringify({
                  ...current.data,
                  reviewNote: body.note,
                  managerApprovedBy: actor.userId,
                  managerApprovedAt: new Date().toISOString(),
                }),
                current.id,
                actor.companyId,
              ],
            );
            await audit(
              tx,
              actor,
              "Manager approved request; awaiting HR",
              current.id,
            );
            await notify(
              tx,
              actor,
              "Request needs final HR approval",
              String(employee.data.name),
              "/?view=" + (current.kind === "leave" ? "leave" : "claims"),
              employee.id,
              true,
            );
            return { ...current.data, status: "Pending" };
          }
          if (!isStaff(actor)) fail("The final step requires HR approval", 403);
        }
      }
      if (current.kind === "time_off" && body.decision === "Approved")
        await checkTimeOff(
          tx,
          actor,
          current.employee_id!,
          current.data,
          current.id,
        );
      if (current.kind === "claim" && body.decision === "Approved")
        await claimBalance(tx, actor, employee, current.data, current.id);
      if (current.kind === "leave" && body.decision === "Approved")
        current.data.days = await checkLeave(
          tx,
          actor,
          current.employee_id!,
          current.data,
          current.id,
        );
    }
    const data: Data = {
      ...current.data,
      status: body.decision,
      reviewedBy: actor.userId,
      reviewNote: body.note,
      reviewedAt: new Date().toISOString(),
    };
    await tx.query(
      "UPDATE hr_records SET data=$1,updated_at=now() WHERE company_id=$2 AND id=$3",
      [JSON.stringify(data), actor.companyId, current.id],
    );
    if (body.decision === "Approved") {
      if (current.kind === "goal_update") {
        const goal = await recordById(
          actor,
          String(data.goalId),
          "goal",
          tx,
          true,
        );
        await tx.query(
          "UPDATE hr_records SET data=$1,updated_at=now() WHERE id=$2 AND company_id=$3",
          [
            JSON.stringify({
              ...goal.data,
              progress: data.progress,
              status:
                Number(data.progress) >= Number(goal.data.target)
                  ? "Completed"
                  : "In progress",
            }),
            goal.id,
            actor.companyId,
          ],
        );
      }
      if (current.kind === "attendance_correction") {
        const existing = data.attendanceId
          ? await recordById(
              actor,
              String(data.attendanceId),
              "attendance",
              tx,
              true,
            )
          : null;
        const attendance = {
          ...existing?.data,
          workDate: data.workDate,
          clockIn: data.clockIn,
          clockOut: data.clockOut,
          shiftId: existing?.data.shiftId || null,
          lateMinutes:
            assignedShift(
              new Date(String(data.clockIn)),
              (await getCompany(actor, tx)).settings.timezone,
              (await allRecords(actor, tx)).filter(
                (r) =>
                  r.kind === "shift" &&
                  (r.data.employeeIds as string[]).includes(employee.id),
              ),
            )?.lateMinutes || 0,
          location: existing?.data.location || "Office",
          correctedBy: actor.userId,
          correctionId: current.id,
        };
        if (existing) {
          await audit(tx, actor, "Corrected attendance", existing.id, {
            previous: existing.data,
            correctionId: current.id,
          });
          await tx.query(
            "UPDATE hr_records SET data=$1,updated_at=now() WHERE id=$2 AND company_id=$3",
            [JSON.stringify(attendance), existing.id, actor.companyId],
          );
        } else
          await insertRecord(tx, actor, "attendance", attendance, employee.id);
      }
      if (current.kind === "lateness") {
        const attendance = await recordById(
          actor,
          String(data.attendanceId),
          "attendance",
          tx,
          true,
        );
        await tx.query(
          "UPDATE hr_records SET data=$1,updated_at=now() WHERE id=$2 AND company_id=$3",
          [
            JSON.stringify({
              ...attendance.data,
              lateExcused: true,
              justificationId: current.id,
            }),
            attendance.id,
            actor.companyId,
          ],
        );
      }
    }
    await notify(
      tx,
      actor,
      `${body.decision} ${current.kind.replaceAll("_", " ")}`,
      body.note || "Your request was reviewed.",
      `/?view=${current.kind === "leave" ? "leave" : current.kind === "claim" ? "claims" : "time"}`,
      employee.id,
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
      locationId: z.uuid().nullable().default(null),
      coordinates: z
        .object({
          latitude: z.number().min(-90).max(90),
          longitude: z.number().min(-180).max(180),
          accuracy: z.number().min(0).max(20000),
        })
        .nullable()
        .default(null),
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
    const site = body.locationId
      ? await recordById(actor, body.locationId, "location", tx)
      : null;
    if (site?.data.geofence) {
      if (!body.coordinates)
        fail("This workplace requires your phone location");
      if (body.coordinates.accuracy > Number(site.data.radius))
        fail(
          "Location accuracy is too low. Try again outside or enable precise location.",
        );
      if (
        distanceMetres(body.coordinates, {
          latitude: Number(site.data.latitude),
          longitude: Number(site.data.longitude),
        }) > Number(site.data.radius)
      )
        fail("You are outside the selected workplace area", 403);
    }
    const shift = assignedShift(
      now,
      company.settings.timezone,
      (await allRecords(actor, tx)).filter(
        (r) =>
          r.kind === "shift" &&
          ((r.data.employeeIds as string[]).includes(actor.employeeId!) ||
            ((r.data.departmentIds as string[]) || []).includes(
              String(employee.data.departmentId),
            )),
      ),
    );
    if (shift) {
      const shiftRecord = await recordById(actor, shift.id, "shift", tx);
      if (
        shiftRecord.data.locationId &&
        shiftRecord.data.locationId !== body.locationId
      )
        fail("Choose your assigned shift workplace");
    }
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
        locationId: body.locationId,
        coordinates: body.coordinates,
      },
      actor.employeeId,
    );
  });
}
export async function generatePayroll(actor: Actor, input: unknown) {
  if (!isStaff(actor)) fail("Only HR can prepare payroll", 403);
  const { period, departmentId, employeeId } = z
    .object({
      period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
      departmentId: z.uuid().optional(),
      employeeId: z.uuid().optional(),
    })
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
    const records = await allRecords(actor, tx),
      company = await getCompany(actor, tx);
    let created = 0;
    for (const employee of employees.filter(
      (e) =>
        (!departmentId || e.data.departmentId === departmentId) &&
        (!employeeId || e.id === employeeId),
    )) {
      if (
        (
          await tx.query(
            "SELECT id FROM hr_records WHERE company_id=$1 AND employee_id=$2 AND kind='payroll' AND data->>'period'=$3",
            [actor.companyId, employee.id, period],
          )
        ).rows.length
      )
        continue;
      const earnings = payrollInputs(
        employee,
        period,
        records,
        company.settings.workDays,
        await companyHolidays(tx, actor, String(employee.data.state || "")),
        company.settings.overtimeRates,
      );
      const data = schemas.payroll.parse({
        period,
        allowance: 0,
        bonus: 0,
        epfEmployee: 0,
        socsoEmployee: 0,
        eisEmployee: 0,
        pcb: 0,
        otherDeduction: 0,
        epfEmployer: 0,
        socsoEmployer: 0,
        eisEmployer: 0,
        gross: earnings.base,
        net: earnings.base,
        status: "Draft",
        employeeName: employee.data.name,
        reviewed: false,
        ...earnings,
        bankName: employee.data.bankName || "",
        bankAccount: employee.data.bankAccount || "",
        nric: employee.data.nric || "",
      });
      Object.assign(data, payrollTotals(data));
      if (
        employee.data.taxProfileVerified &&
        employee.data.epfCategory !== "Manual" &&
        employee.data.taxScheme !== "Manual" &&
        period.startsWith("2026-")
      ) {
        const amounts = calculateStatutory(
          employee.data,
          data,
          records.filter(
            (r) => r.kind === "payroll" && r.employee_id === employee.id,
          ),
        );
        Object.assign(data, amounts, payrollTotals({ ...data, ...amounts }));
      }
      await insertRecord(tx, actor, "payroll", data, employee.id);
      created++;
    }
    return { created };
  });
}
export async function recalculatePayroll(actor: Actor, input: unknown) {
  if (!isStaff(actor)) fail("Only HR can calculate payroll", 403);
  const { id } = z.object({ id: z.uuid() }).parse(input);
  return transaction(async (tx) => {
    await tx.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
      actor.companyId,
    ]);
    const draft = await recordById(actor, id, "payroll", tx, true);
    if (draft.data.status !== "Draft")
      fail("Published payslips are immutable", 409);
    const employee = await recordById(
        actor,
        draft.employee_id!,
        "employee",
        tx,
      ),
      history = (await allRecords(actor, tx)).filter(
        (r) => r.kind === "payroll" && r.employee_id === employee.id,
      );
    const amounts = calculateStatutory(employee.data, draft.data, history),
      data = {
        ...draft.data,
        ...amounts,
        reviewed: false,
        ...payrollTotals({ ...draft.data, ...amounts }),
      };
    await tx.query(
      "UPDATE hr_records SET data=$1,updated_at=now() WHERE id=$2 AND company_id=$3",
      [JSON.stringify(data), id, actor.companyId],
    );
    await audit(tx, actor, "Calculated statutory deductions", id);
    return data;
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
    for (const draft of drafts) {
      await tx.query(
        "UPDATE hr_records SET data=$1,updated_at=now() WHERE company_id=$2 AND id=$3",
        [
          JSON.stringify({ ...draft.data, status: "Published" }),
          actor.companyId,
          draft.id,
        ],
      );
      for (const id of (draft.data.inputRecordIds as string[]) || []) {
        const source = await recordById(actor, id, undefined, tx, true);
        if (
          source.employee_id !== draft.employee_id ||
          !["leave", "claim", "overtime"].includes(source.kind) ||
          source.data.status !== "Approved"
        )
          fail("A payroll input changed. Review and reprepare the draft.", 409);
        if (source.kind === "leave") continue;
        if (
          (source.data.payrollId && source.data.payrollId !== draft.id) ||
          source.data.voucherId
        )
          fail(
            "An input was already linked to another payment. Reprepare this payroll.",
            409,
          );
        await tx.query(
          "UPDATE hr_records SET data=$1,updated_at=now() WHERE id=$2 AND company_id=$3",
          [
            JSON.stringify({ ...source.data, payrollId: draft.id }),
            id,
            actor.companyId,
          ],
        );
      }
      await notify(
        tx,
        actor,
        "Your payslip is ready",
        String(draft.data.period),
        "/?view=payroll",
        draft.employee_id!,
      );
    }
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
