import { hasPayroll } from "./workflow-config";
import { parseCalendar } from "./calendar";
import { localDate } from "./calculations";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, transaction, type DB } from "./db";
import { token, hashToken, audit, rateLimit, getCompany } from "./auth";
import {
  allRecords,
  recordById,
  insertRecord,
  normalize,
  visibleRecords,
} from "./hr";
import { schemas } from "./schema";
import { isStaff, type Actor, type Data, type HRRecord } from "./types";
import { fail } from "./errors";
import { queueEmail, notify } from "./notifications";
import { extractFile } from "./files";
const personalKeys = [
  "phone",
  "nric",
  "birthDate",
  "nationality",
  "state",
  "race",
  "religion",
  "address",
  "epfNo",
  "socsoNo",
  "taxNo",
  "bankName",
  "bankAccount",
  "emergencyName",
  "emergencyPhone",
  "dependants",
  "education",
  "pastEmployment",
];
const staff = (actor: Actor) => {
  if (!isStaff(actor)) fail("Only HR can perform this action", 403);
};
export async function operation(
  actor: Actor,
  action: string,
  input: unknown,
): Promise<unknown> {
  const body = z
    .object({
      id: z.uuid().optional(),
      expectedUpdatedAt: z.string().optional(),
      employeeId: z.uuid().optional(),
      data: z.record(z.string(), z.unknown()).default({}),
    })
    .parse(input);
  if (action === "notifications-read") {
    await db.query(
      "UPDATE notifications SET read_at=now() WHERE company_id=$1 AND user_id=$2 AND read_at IS NULL",
      [actor.companyId, actor.userId],
    );
    return { ok: true };
  }
  if (action === "notification-read") {
    const result = await db.query(
      "UPDATE notifications SET read_at=coalesce(read_at,now()) WHERE id=$1 AND company_id=$2 AND user_id=$3 RETURNING id",
      [z.uuid().parse(body.id), actor.companyId, actor.userId],
    );
    if (!result.rows.length) fail("Notification unavailable", 404);
    return { ok: true };
  }
  if (action === "operations-status") {
    staff(actor);
    return normalize({
      onboarding: (
        await db.query(
          "SELECT id,employee_id,required_documents,proposed_data,status,expires_at,submitted_at FROM onboarding_links WHERE company_id=$1 ORDER BY expires_at DESC",
          [actor.companyId],
        )
      ).rows,
      email: (
        await db.query(
          "SELECT status,count(*) AS count FROM email_outbox WHERE company_id=$1 GROUP BY status",
          [actor.companyId],
        )
      ).rows,
    });
  }
  if (action === "onboarding-link") {
    staff(actor);
    const employee = await recordById(actor, body.employeeId!, "employee");
    const plain = token(),
      id = randomUUID();
    const required = z
      .array(z.string().min(1).max(100))
      .max(10)
      .parse(body.data.requiredDocuments || ["Identity", "Contract"]);
    await transaction(async (tx) => {
      await tx.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
        actor.companyId,
      ]);
      await tx.query(
        "UPDATE onboarding_links SET status='Revoked' WHERE company_id=$1 AND employee_id=$2 AND status IN ('Draft','Submitted')",
        [actor.companyId, employee.id],
      );
      await tx.query(
        "INSERT INTO onboarding_links(id,company_id,employee_id,token_hash,required_documents,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '14 days')",
        [
          id,
          actor.companyId,
          employee.id,
          hashToken(plain),
          JSON.stringify(required),
        ],
      );
      await queueEmail(
        tx,
        actor.companyId,
        String(employee.data.email),
        "Complete your employee profile",
        `Complete your profile using this private link within 14 days:\n${process.env.APP_URL || "http://localhost:3000"}/onboarding/${plain}`,
      );
      await audit(tx, actor, "Created onboarding link", employee.id);
    });
    return {
      url: `${process.env.APP_URL || "http://localhost:3000"}/onboarding/${plain}`,
    };
  }
  if (action === "calendar-import") {
    staff(actor);
    const company = await getCompany(actor),
      events = parseCalendar(
        z.string().max(1000000).parse(body.data.calendar),
        company.settings.timezone,
      );
    return transaction(async (tx) => {
      await tx.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
        actor.companyId,
      ]);
      let created = 0;
      for (const event of events) {
        if (
          (
            await tx.query(
              "SELECT id FROM hr_records WHERE company_id=$1 AND kind='meeting' AND data->>'createdBy'=$2 AND data->>'calendarUID'=$3",
              [actor.companyId, actor.userId, event.uid],
            )
          ).rows.length
        )
          continue;
        await insertRecord(
          tx,
          actor,
          "meeting",
          schemas.meeting.parse({
            title: event.title,
            date: localDate(new Date(event.start), company.settings.timezone),
            calendarUID: event.uid,
            calendarStartsAt: event.start,
            calendarEndsAt: event.end,
            createdBy: actor.userId,
            transcript: event.notes,
            attendees: event.attendees,
          }),
        );
        created++;
      }
      return { created };
    });
  }
  if (action === "employees-import") {
    staff(actor);
    const rows = z
      .array(z.record(z.string(), z.unknown()))
      .min(1)
      .max(100)
      .parse(body.data.rows);
    const parsed = rows.map((row) => schemas.employee.parse(row));
    return transaction(async (tx) => {
      await tx.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
        actor.companyId,
      ]);
      let created = 0;
      for (const row of parsed) {
        if (row.managerId)
          await recordById(actor, row.managerId, "employee", tx);
        if (row.departmentId)
          await recordById(actor, row.departmentId, "department", tx);
        await insertRecord(tx, actor, "employee", row);
        created++;
      }
      return { created };
    });
  }
  return transaction(async (tx) => {
    await tx.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
      actor.companyId,
    ]);
    if (action === "onboarding-review") {
      staff(actor);
      const row = (
        await tx.query<{
          id: string;
          employee_id: string;
          status: string;
          proposed_data: Data;
        }>(
          "SELECT * FROM onboarding_links WHERE company_id=$1 AND id=$2 FOR UPDATE",
          [actor.companyId, body.id],
        )
      ).rows[0];
      if (!row || row.status !== "Submitted")
        fail("This submission is unavailable", 409);
      const decision = z
        .enum(["Approved", "Rejected"])
        .parse(body.data.decision);
      if (decision === "Approved") {
        const e = await recordById(
          actor,
          row.employee_id,
          "employee",
          tx,
          true,
        );
        const proposed = Object.fromEntries(
          personalKeys
            .filter((k) => k in row.proposed_data)
            .map((k) => [k, row.proposed_data[k]]),
        );
        const data = schemas.employee.parse({ ...e.data, ...proposed });
        await tx.query(
          "UPDATE hr_records SET data=$1,updated_at=now() WHERE id=$2 AND company_id=$3",
          [JSON.stringify(data), e.id, actor.companyId],
        );
        await audit(tx, actor, "Approved employee onboarding", e.id);
      }
      await tx.query(
        "UPDATE onboarding_links SET status=$1 WHERE company_id=$2 AND id=$3",
        [
          decision === "Approved" ? "Approved" : "Draft",
          actor.companyId,
          row.id,
        ],
      );
      return { ok: true };
    }
    const record = await recordById(actor, body.id!, undefined, tx, true);
    if (body.expectedUpdatedAt && record.updated_at !== body.expectedUpdatedAt)
      fail("The record changed. Prepare a new action.", 409);
    if (action === "announcement-read") {
      if (record.kind !== "announcement" || !record.data.published)
        fail("Announcement unavailable", 404);
      const own = actor.employeeId
        ? await recordById(actor, actor.employeeId, "employee", tx)
        : null;
      if (
        record.data.departmentId &&
        !isStaff(actor) &&
        record.data.departmentId !== own?.data.departmentId
      )
        fail("Announcement unavailable", 404);
      await tx.query(
        "INSERT INTO announcement_reads(announcement_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [record.id, actor.userId],
      );
      return { ok: true };
    }
    if (action === "announcement-receipts") {
      staff(actor);
      return (
        await tx.query(
          "SELECT u.name,u.email,r.read_at FROM announcement_reads r JOIN users u ON u.id=r.user_id WHERE r.announcement_id=$1",
          [record.id],
        )
      ).rows;
    }
    if (action === "employment-change") {
      staff(actor);
      if (record.kind !== "employee" || record.data.status === "Archived")
        fail("Choose an active employee");
      const change = schemas.job_history.parse({
        ...body.data,
        previousTitle: record.data.title,
        previousSalary: record.data.salary,
      });
      if (change.effectiveDate < String(record.data.startDate))
        fail("A change cannot precede the employee start date");
      if (change.departmentId)
        await recordById(actor, change.departmentId, "department", tx);
      const history = (await allRecords(actor, tx)).filter(
        (r) => r.kind === "job_history" && r.employee_id === record.id,
      );
      if (
        history.some(
          (r) => String(r.data.effectiveDate) >= change.effectiveDate,
        )
      )
        fail(
          "Add changes in effective-date order; an existing change already occurs on or after this date",
          409,
        );
      if (history.length) {
        const previous = history.sort((a, b) =>
          String(b.data.effectiveDate).localeCompare(
            String(a.data.effectiveDate),
          ),
        )[0];
        change.previousSalary = Number(previous.data.newSalary);
        change.previousTitle = String(previous.data.title);
      }
      await insertRecord(tx, actor, "job_history", change, record.id);
      if (
        change.effectiveDate <=
        localDate(new Date(), (await getCompany(actor, tx)).settings.timezone)
      )
        await save(tx, actor, record, {
          ...record.data,
          title: change.title,
          salary: change.newSalary,
          departmentId: change.departmentId,
        });
      return { ok: true };
    }
    if (action === "letter-draft") {
      staff(actor);
      if (record.kind !== "employee") fail("Choose an employee");
      const type = z
        .enum([
          "Offer",
          "Confirmation",
          "Warning",
          "Termination",
          "Reference",
          "Other",
        ])
        .parse(body.data.type || "Confirmation");
      const effectiveDate = z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .parse(
          body.data.effectiveDate || new Date().toISOString().slice(0, 10),
        );
      return insertRecord(
        tx,
        actor,
        "letter",
        schemas.letter.parse({
          title: `${type} — ${record.data.name}`,
          type,
          effectiveDate,
          body: `Dear ${record.data.name},\n\n${type === "Confirmation" ? `We confirm your appointment as ${record.data.title} with effect from ${effectiveDate}.` : type === "Offer" ? `We offer you the position of ${record.data.title}, commencing ${record.data.startDate}, with a monthly base salary of RM ${Number(record.data.salary).toFixed(2)}.` : `Re: ${type} concerning your role as ${record.data.title}.\n\n[HR: add the circumstances, terms and next steps before issuing.]`}\n\nYours sincerely,\n${(await getCompany(actor, tx)).name}`,
          status: "Draft",
        }),
        record.id,
      );
    }
    if (action === "letter-issue") {
      staff(actor);
      if (record.kind !== "letter" || record.data.status !== "Draft")
        fail("Choose a draft letter");
      if (String(record.data.body).includes("[HR:"))
        fail("Complete the letter before issuing");
      await save(tx, actor, record, {
        ...record.data,
        status: "Issued",
        issuedBy: actor.userId,
        issuedAt: new Date().toISOString(),
      });
      await notify(
        tx,
        actor,
        "New employee letter",
        String(record.data.title),
        "/?view=employee-files",
        record.employee_id!,
      );
      return { ok: true };
    }
    if (action === "lifecycle-toggle") {
      staff(actor);
      if (record.kind !== "lifecycle") fail("Choose a checklist");
      const items = record.data.items as {
          task: string;
          done: boolean;
          owner: string;
        }[],
        index = z
          .number()
          .int()
          .min(0)
          .max(items.length - 1)
          .parse(body.data.index);
      items[index] = { ...items[index], done: !items[index].done };
      if (record.data.type === "Offboarding" && items.every((i) => i.done)) {
        const assets = (await allRecords(actor, tx)).filter(
          (r) =>
            r.kind === "asset" &&
            r.employee_id === record.employee_id &&
            !r.data.returnedDate,
        );
        if (assets.length)
          fail("Record all equipment returns before completing offboarding");
      }
      await save(tx, actor, record, {
        ...record.data,
        items,
        status: items.every((i) => i.done) ? "Completed" : "In progress",
      });
      return { ok: true };
    }
    if (action === "job-clone") {
      staff(actor);
      if (record.kind !== "job") fail("Choose a job template");
      return insertRecord(
        tx,
        actor,
        "job",
        schemas.job.parse({
          ...record.data,
          title: String(record.data.title) + " (copy)",
          status: "Draft",
        }),
      );
    }
    if (action === "candidate-hire") {
      staff(actor);
      if (
        record.kind !== "candidate" ||
        !["Offer", "Hired"].includes(String(record.data.stage))
      )
        fail("Move the candidate to Offer before hiring");
      if (record.data.employeeId) return { employeeId: record.data.employeeId };
      const job = await recordById(actor, String(record.data.jobId), "job", tx);
      const employee = await insertRecord(
        tx,
        actor,
        "employee",
        schemas.employee.parse({
          name: record.data.name,
          email: record.data.email,
          phone: record.data.phone,
          title: job.data.title,
          departmentId: job.data.departmentId,
          startDate: body.data.startDate,
          status: "Onboarding",
          employmentType:
            body.data.employmentType || job.data.employmentType || "Full-time",
          salary: body.data.salary || 0,
        }),
      );
      await save(tx, actor, record, {
        ...record.data,
        stage: "Hired",
        employeeId: employee.id,
        stageHistory: [
          ...((record.data.stageHistory as unknown[]) || []),
          { stage: "Hired", at: new Date().toISOString(), by: actor.name },
        ],
      });
      if (record.data.resumeFileId)
        await insertRecord(
          tx,
          actor,
          "document",
          schemas.document.parse({
            issueDate: new Date().toISOString().slice(0, 10),
            title: "Recruitment resume",
            type: "Other",
            fileId: record.data.resumeFileId,
            notes: "Carried from recruitment",
          }),
          employee.id,
        );
      await tx.query(
        "UPDATE hr_records SET employee_id=$1::uuid,data=jsonb_set(data,'{employeeId}',to_jsonb($1::uuid::text)),updated_at=now() WHERE company_id=$2 AND kind='assessment_result' AND data->>'candidateId'=$3",
        [employee.id, actor.companyId, record.id],
      );
      await insertRecord(
        tx,
        actor,
        "lifecycle",
        schemas.lifecycle.parse({
          title: `Welcome ${record.data.name}`,
          type: "Onboarding",
          dueDate: body.data.startDate,
          items: [
            "Complete employee profile",
            "Upload required documents",
            "Issue equipment",
            "Review handbook",
            "Create employee invitation",
          ].map((task) => ({ task, done: false, owner: "HR" })),
        }),
        employee.id,
      );
      return { employeeId: employee.id };
    }
    if (action === "evaluation-submit" || action === "evaluation-review") {
      if (record.kind !== "evaluation" || record.data.status === "Final")
        fail("This evaluation is unavailable", 409);
      const own = record.employee_id === actor.employeeId,
        employee = await recordById(actor, record.employee_id!, "employee", tx);
      const cycle = await recordById(
        actor,
        String(record.data.cycleId),
        "review_cycle",
        tx,
      );
      if (cycle.data.status !== "Open") fail("This review cycle is closed");
      if (action === "evaluation-submit") {
        if (!own && !isStaff(actor)) fail("Submit your own evaluation", 403);
        await save(tx, actor, record, {
          ...record.data,
          selfComments: z
            .string()
            .max(24000)
            .parse(body.data.selfComments || ""),
          status: "Submitted",
        });
        await notify(
          tx,
          actor,
          "Evaluation ready for review",
          String(employee.data.name),
          "/?view=reviews",
          employee.id,
          true,
        );
        return { ok: true };
      }
      if (
        own ||
        (!isStaff(actor) &&
          (actor.role !== "manager" ||
            employee.data.managerId !== actor.employeeId))
      )
        fail("This evaluation needs another authorised reviewer", 403);
      if (record.data.status !== "Submitted")
        fail("Submit the evaluation first");
      const criteria = (
        record.data.templateSnapshot as {
          criteria: { title: string; weight: number }[];
        }
      ).criteria;
      const ratings = z
          .array(z.number().min(1).max(5))
          .length(criteria.length)
          .parse(body.data.ratings),
        total = criteria.reduce((n, c) => n + c.weight, 0),
        score =
          Math.round(
            (criteria.reduce((n, c, i) => n + c.weight * ratings[i], 0) /
              total) *
              100,
          ) / 100;
      await save(tx, actor, record, {
        ...record.data,
        ratings,
        score,
        status: "Final",
        feedback: z
          .string()
          .max(24000)
          .parse(body.data.feedback || ""),
        reviewedBy: actor.userId,
        reviewedAt: new Date().toISOString(),
      });
      return { score };
    }
    if (action === "voucher-prepare") {
      if (!hasPayroll(actor, "pay"))
        fail("Payroll payment permission required", 403);
      const ids = z
        .array(z.uuid())
        .min(1)
        .max(500)
        .parse(body.data.recordIds || [record.id]);
      if (new Set(ids).size !== ids.length)
        fail("Select each payment record only once");
      const rows: HRRecord[] = [];
      let amount = 0;
      for (const id of ids) {
        const r = await recordById(actor, id, undefined, tx, true);
        if (
          r.data.voucherId ||
          (r.kind === "claim" && r.data.payrollId) ||
          !(
            (r.kind === "claim" && r.data.status === "Approved") ||
            (r.kind === "payroll" && r.data.status === "Published")
          )
        )
          fail("Select unpaid approved claims or published payslips");
        rows.push(r);
        amount += Number(r.kind === "payroll" ? r.data.net : r.data.amount);
      }
      const reference =
        "PV-" +
        new Date().toISOString().slice(0, 10).replaceAll("-", "") +
        "-" +
        randomUUID().slice(0, 8).toUpperCase();
      const voucher = await insertRecord(
        tx,
        actor,
        "payment_voucher",
        schemas.payment_voucher.parse({
          title: String(body.data.title || "HR payment"),
          reference,
          period: record.data.period || record.data.date || "",
          recordIds: ids,
          amount: Math.round(amount * 100) / 100,
        }),
      );
      for (const row of rows)
        await save(tx, actor, row, { ...row.data, voucherId: voucher.id });
      return voucher;
    }
    if (action === "voucher-pay") {
      if (!hasPayroll(actor, "pay"))
        fail("Payroll payment permission required", 403);
      if (
        record.kind !== "payment_voucher" ||
        record.data.status !== "Prepared"
      )
        fail("Choose an unpaid voucher", 409);
      const bankReference = z
        .string()
        .trim()
        .min(1)
        .max(200)
        .parse(body.data.bankReference);
      for (const id of record.data.recordIds as string[]) {
        const row = await recordById(actor, id, undefined, tx, true);
        if (row.kind === "payroll")
          for (const inputId of (row.data.inputRecordIds as string[]) || []) {
            const source = await recordById(
              actor,
              inputId,
              undefined,
              tx,
              true,
            );
            if (source.kind === "claim")
              await save(tx, actor, source, {
                ...source.data,
                status: "Paid",
                paidAt: new Date().toISOString(),
                bankReference,
                voucherId: record.id,
              });
          }
        await save(tx, actor, row, {
          ...row.data,
          ...(row.kind === "claim" ? { status: "Paid" } : {}),
          paidAt: new Date().toISOString(),
          bankReference,
        });
        await notify(
          tx,
          actor,
          "Payment recorded",
          String(record.data.reference),
          "/?view=" + (row.kind === "payroll" ? "payroll" : "claims"),
          row.employee_id!,
        );
      }
      await save(tx, actor, record, {
        ...record.data,
        status: "Paid",
        paidAt: new Date().toISOString(),
        bankReference,
      });
      return { ok: true };
    }
    fail("Action not found", 404);
  });
}
async function save(tx: DB, actor: Actor, record: HRRecord, data: Data) {
  await tx.query(
    "UPDATE hr_records SET data=$1,updated_at=now() WHERE id=$2 AND company_id=$3",
    [JSON.stringify(data), record.id, actor.companyId],
  );
  await audit(
    tx,
    actor,
    "Updated " + record.kind.replaceAll("_", " "),
    record.id,
  );
}
interface OnboardingRow {
  id: string;
  company_id: string;
  employee_id: string;
  required_documents: string[];
  proposed_data: Data;
  status: string;
  expires_at: string;
}
async function onboardingRow(plain: string, tx: DB = db, lock = false) {
  if (!/^[a-f0-9]{64}$/.test(plain)) fail("Onboarding link unavailable", 404);
  const row = (
    await tx.query<OnboardingRow>(
      `SELECT * FROM onboarding_links WHERE token_hash=$1 AND expires_at>now() AND status IN ('Draft','Submitted') ${lock ? "FOR UPDATE" : ""}`,
      [hashToken(plain)],
    )
  ).rows[0];
  if (!row) fail("Onboarding link expired or closed", 410);
  return row;
}
export async function onboarding(plain: string) {
  const row = await onboardingRow(plain);
  const employee = (
    await db.query<HRRecord>(
      "SELECT * FROM hr_records WHERE company_id=$1 AND id=$2",
      [row.company_id, row.employee_id],
    )
  ).rows[0];
  if (employee.data.status === "Archived") fail("Onboarding closed", 410);
  return normalize({
    name: employee.data.name,
    requiredDocuments: row.required_documents,
    data: {
      ...Object.fromEntries(personalKeys.map((k) => [k, employee.data[k]])),
      ...row.proposed_data,
    },
    status: row.status,
  });
}
export async function saveOnboarding(
  plain: string,
  input: unknown,
  file?: File,
  documentType?: string,
) {
  await rateLimit("onboard:" + plain, 30, 3600);
  const raw = z
    .object({
      data: z.record(z.string(), z.unknown()).default({}),
      submit: z.boolean().default(false),
    })
    .parse(input);
  const extracted = file ? await extractFile(file) : null;
  return transaction(async (tx) => {
    const row = await onboardingRow(plain, tx, true);
    if (row.status !== "Draft") fail("HR is reviewing your submission", 409);
    const employee = (
      await tx.query<HRRecord>(
        "SELECT * FROM hr_records WHERE company_id=$1 AND id=$2",
        [row.company_id, row.employee_id],
      )
    ).rows[0];
    if (employee.data.status === "Archived") fail("Onboarding closed", 410);
    let proposed: Data = {
      ...row.proposed_data,
      ...Object.fromEntries(
        personalKeys.filter((k) => k in raw.data).map((k) => [k, raw.data[k]]),
      ),
    };
    const checked = schemas.employee.parse({ ...employee.data, ...proposed });
    proposed = {
      ...proposed,
      ...Object.fromEntries(personalKeys.map((k) => [k, (checked as Data)[k]])),
    };
    if (extracted) {
      if (!row.required_documents.includes(documentType || ""))
        fail("Choose a required document type");
      await tx.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
        row.company_id,
      ]);
      const size = Number(
        (
          await tx.query<{ size: string }>(
            "SELECT coalesce(sum(size),0) AS size FROM files WHERE company_id=$1",
            [row.company_id],
          )
        ).rows[0].size,
      );
      if (
        size + extracted.size >
        Number(process.env.COMPANY_STORAGE_MAX_BYTES || 104857600)
      )
        fail("Workspace storage is full", 413);
      const id = randomUUID();
      await tx.query(
        "INSERT INTO files(id,company_id,filename,mime,bytes,size,extracted_text) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          id,
          row.company_id,
          extracted.filename,
          extracted.mime,
          extracted.bytes,
          extracted.size,
          extracted.text,
        ],
      );
      const documents = ((proposed.documents as Data[]) || []).filter(
        (d) => d.type !== documentType,
      );
      proposed.documents = [
        ...documents,
        { type: documentType, fileId: id, filename: extracted.filename },
      ];
    }
    if (raw.submit) {
      const documents = (proposed.documents as Data[]) || [];
      if (
        row.required_documents.some((t) => !documents.some((d) => d.type === t))
      )
        fail("Upload every required document before submitting");
      if (!proposed.emergencyName || !proposed.emergencyPhone)
        fail("Enter your emergency contact");
      for (const document of documents) {
        const id = randomUUID();
        await tx.query(
          "INSERT INTO hr_records(id,company_id,kind,employee_id,data) VALUES($1,$2,'document',$3,$4)",
          [
            id,
            row.company_id,
            employee.id,
            JSON.stringify(
              schemas.document.parse({
                issueDate: new Date().toISOString().slice(0, 10),
                title: String(document.type),
                type: [
                  "Identity",
                  "Contract",
                  "Passport",
                  "Permit",
                  "Certificate",
                ].includes(String(document.type))
                  ? document.type
                  : "Other",
                fileId: document.fileId,
                notes: "Employee onboarding upload",
              }),
            ),
          ],
        );
      }
      await queueEmail(
        tx,
        row.company_id,
        String(employee.data.email),
        "Your onboarding profile was submitted",
        "HR will review your employee profile.",
      );
      await tx.query(
        "INSERT INTO audit_log(id,company_id,action,entity_id) VALUES($1,$2,'Employee submitted onboarding profile',$3)",
        [randomUUID(), row.company_id, employee.id],
      );
    }
    await tx.query(
      "UPDATE onboarding_links SET proposed_data=$1,status=$2,submitted_at=CASE WHEN $2='Submitted' THEN now() ELSE NULL END WHERE id=$3",
      [JSON.stringify(proposed), raw.submit ? "Submitted" : "Draft", row.id],
    );
    return { ok: true, status: raw.submit ? "Submitted" : "Draft" };
  });
}
export async function scopedRecords(actor: Actor) {
  return visibleRecords(actor);
}
