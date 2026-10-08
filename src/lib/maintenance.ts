import { leavePortion } from "./policies";
import { randomUUID } from "node:crypto";
import { db, transaction } from "./db";
import { flushEmails, queueEmail } from "./notifications";
import { localDate, localMinutes, shiftOccurs } from "./calculations";
import { normalize } from "./hr";
import type { Company, HRRecord } from "./types";
export async function maintenance() {
  const companies = (
    await db.query<Company>(
      "SELECT id,name,slug,settings FROM companies WHERE NOT is_demo",
    )
  ).rows;
  let reminders = 0;
  for (const company of companies) {
    const day = localDate(
        new Date(),
        company.settings.timezone || "Asia/Kuala_Lumpur",
      ),
      minute = localMinutes(
        new Date(),
        company.settings.timezone || "Asia/Kuala_Lumpur",
      );
    const records = normalize(
        (
          await db.query<HRRecord>(
            "SELECT * FROM hr_records WHERE company_id=$1",
            [company.id],
          )
        ).rows,
      ),
      members = (
        await db.query<{
          user_id: string;
          employee_id: string | null;
          role: string;
          email: string;
        }>(
          "SELECT m.*,u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE company_id=$1",
          [company.id],
        )
      ).rows;
    // Apply the HR-approved future employment history when its date arrives.
    await transaction(async (tx) => {
      await tx.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
        company.id,
      ]);
      for (const employee of records.filter(
        (r) => r.kind === "employee" && r.data.status !== "Archived",
      )) {
        const change = records
          .filter(
            (r) =>
              r.kind === "job_history" &&
              r.employee_id === employee.id &&
              String(r.data.effectiveDate) <= day,
          )
          .sort(
            (a, b) =>
              String(b.data.effectiveDate).localeCompare(
                String(a.data.effectiveDate),
              ) || String(b.created_at).localeCompare(String(a.created_at)),
          )[0];
        if (!change) continue;
        const current = normalize(
          (
            await tx.query<HRRecord>(
              "SELECT * FROM hr_records WHERE id=$1 AND company_id=$2 FOR UPDATE",
              [employee.id, company.id],
            )
          ).rows[0],
        );
        if (
          current.data.title === change.data.title &&
          current.data.salary === change.data.newSalary &&
          current.data.departmentId === change.data.departmentId
        )
          continue;
        const data = {
          ...current.data,
          title: change.data.title,
          salary: change.data.newSalary,
          departmentId: change.data.departmentId,
        };
        await tx.query(
          "UPDATE hr_records SET data=$1,updated_at=now() WHERE id=$2 AND company_id=$3",
          [JSON.stringify(data), employee.id, company.id],
        );
        await tx.query(
          "INSERT INTO audit_log(id,company_id,action,entity_id,details) VALUES($1,$2,'Applied scheduled employment change',$3,$4)",
          [
            randomUUID(),
            company.id,
            employee.id,
            JSON.stringify({ historyId: change.id }),
          ],
        );
      }
    });
    for (const document of records.filter(
      (r) =>
        r.kind === "document" &&
        r.data.expiryDate &&
        String(r.data.expiryDate) <=
          new Date(Date.parse(day) + 30 * 86400000).toISOString().slice(0, 10),
    )) {
      for (const member of members.filter(
        (m) =>
          ["owner", "hr"].includes(m.role) ||
          m.employee_id === document.employee_id,
      )) {
        await reminder(
          member,
          company,
          `Document renewal: ${document.data.title}`,
          `Expiry: ${document.data.expiryDate}`,
          "/?view=employee-files",
          `document:${document.id}:${day}`,
        );
      }
    }
    for (const employee of records.filter(
      (r) => r.kind === "employee" && r.data.status === "Active",
    )) {
      const lead = company.settings.clockReminderMinutes ?? 15;
      if (lead > 0) {
        for (const offset of [0, 1]) {
          const targetDay = new Date(Date.parse(day) + offset * 86400000)
            .toISOString()
            .slice(0, 10);
          const holiday =
            company.settings.holidays.includes(targetDay) ||
            records.some(
              (r) =>
                r.kind === "holiday" &&
                r.data.date === targetDay &&
                (r.data.state === "National" ||
                  r.data.state === employee.data.state),
            );
          const absent = records.some(
            (r) =>
              r.employee_id === employee.id &&
              ((r.kind === "attendance" && r.data.workDate === targetDay) ||
                (r.kind === "leave" &&
                  r.data.status === "Approved" &&
                  r.data.unit === "Full day" &&
                  String(r.data.startDate) <= targetDay &&
                  String(r.data.endDate) >= targetDay)),
          );
          if (holiday || absent) continue;
          for (const shift of records.filter(
            (r) =>
              r.kind === "shift" &&
              ((r.data.employeeIds as string[]).includes(employee.id) ||
                ((r.data.departmentIds as string[]) || []).includes(
                  String(employee.data.departmentId),
                )) &&
              shiftOccurs(r.data, targetDay) &&
              (r.data.days as number[]).includes(
                new Date(targetDay + "T00:00:00Z").getUTCDay(),
              ),
          )) {
            const [h, m] = String(shift.data.start).split(":").map(Number);
            const remaining = offset * 1440 + h * 60 + m - minute;
            const timeOff = records.some(
              (r) =>
                r.kind === "time_off" &&
                r.employee_id === employee.id &&
                r.data.status === "Approved" &&
                r.data.date === targetDay &&
                String(r.data.start) <= String(shift.data.start) &&
                String(r.data.end) > String(shift.data.start),
            );
            const onLeave = records.some((r) => {
              if (
                r.kind !== "leave" ||
                r.employee_id !== employee.id ||
                r.data.status !== "Approved" ||
                String(r.data.startDate) > targetDay ||
                String(r.data.endDate) < targetDay
              )
                return false;
              const [from, to] = leavePortion(r.data);
              return (h * 60 + m) / 1440 >= from && (h * 60 + m) / 1440 < to;
            });
            if (remaining >= 0 && remaining <= lead && !timeOff && !onLeave)
              for (const member of members.filter(
                (m) => m.employee_id === employee.id,
              ))
                await reminder(
                  member,
                  company,
                  "Your shift starts soon",
                  `${shift.data.name} starts at ${shift.data.start} on ${targetDay}.`,
                  "/?view=attendance",
                  `preclock:${employee.id}:${shift.id}:${targetDay}`,
                );
          }
        }
      }
      const weekday = new Date(day + "T00:00:00Z").getUTCDay(),
        holiday =
          company.settings.holidays.includes(day) ||
          records.some(
            (r) =>
              r.kind === "holiday" &&
              r.data.date === day &&
              (r.data.state === "National" ||
                r.data.state === employee.data.state),
          );
      if (
        holiday ||
        records.some(
          (r) =>
            r.kind === "leave" &&
            r.employee_id === employee.id &&
            r.data.status === "Approved" &&
            r.data.unit === "Full day" &&
            String(r.data.startDate) <= day &&
            String(r.data.endDate) >= day,
        ) ||
        records.some(
          (r) =>
            r.kind === "attendance" &&
            r.employee_id === employee.id &&
            r.data.workDate === day,
        )
      )
        continue;
      const shift = records.find(
        (r) =>
          r.kind === "shift" &&
          ((r.data.employeeIds as string[]).includes(employee.id) ||
            ((r.data.departmentIds as string[]) || []).includes(
              String(employee.data.departmentId),
            )) &&
          (r.data.days as number[]).includes(weekday) &&
          shiftOccurs(r.data, day),
      );
      if (!shift) continue;
      const [hour, min] = String(shift.data.start).split(":").map(Number);
      if (minute < hour * 60 + min + Number(shift.data.graceMinutes || 0))
        continue;
      for (const member of members.filter((m) => m.employee_id === employee.id))
        await reminder(
          member,
          company,
          "Clock-in reminder",
          "Your scheduled shift has started and no clock-in is recorded.",
          "/?view=attendance",
          `clock:${employee.id}:${day}`,
        );
    }
  }
  await db.query(
    "UPDATE media_jobs SET status='Failed',error='Worker timed out; retry transcription',updated_at=now() WHERE status IN ('Pending','Running') AND created_at<now()-interval '6 hours'",
  );
  await db.query("DELETE FROM sessions WHERE expires_at<now()");
  await db.query(
    "DELETE FROM rate_limits WHERE window_start<now()-interval '2 days'",
  );
  await db.query(
    "DELETE FROM account_tokens WHERE expires_at<now()-interval '7 days'",
  );
  await db.query(
    "DELETE FROM ai_proposals WHERE expires_at<now()-interval '7 days'",
  );
  return { ok: true, reminders, email: await flushEmails(3) };
  async function reminder(
    member: { user_id: string; email: string },
    company: Company,
    title: string,
    body: string,
    href: string,
    key: string,
  ) {
    await transaction(async (tx) => {
      const result = await tx.query(
        "INSERT INTO notifications(id,company_id,user_id,title,body,href,dedupe_key) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(dedupe_key) DO NOTHING RETURNING id",
        [
          randomUUID(),
          company.id,
          member.user_id,
          title,
          body,
          href,
          company.id + ":" + member.user_id + ":" + key,
        ],
      );
      if (!result.rows.length) return;
      reminders++;
      if (process.env.EMAIL_NOTIFICATIONS === "true")
        await queueEmail(
          tx,
          company.id,
          member.email,
          title,
          body + "\n" + (process.env.APP_URL || "http://localhost:3000") + href,
          key + ":" + member.user_id,
        );
    });
  }
}
