import { hasPayroll } from "@/lib/workflow-config";
import { z } from "zod";
import { getActor, getCompany, audit } from "@/lib/auth";
import { db } from "@/lib/db";
import { csv } from "@/lib/calculations";
import { handle, fail } from "@/lib/errors";
import { isStaff, type HRRecord } from "@/lib/types";
import { visibleRecords } from "@/lib/hr";
import { date } from "@/lib/schema";
import { calendarEvents } from "@/lib/hr-calendar";
import { exportCalendar } from "@/lib/calendar-export";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handle(async () => {
    const actor = await getActor();

    const url = new URL(request.url),
      type = z
        .enum([
          "employees",
          "payroll",
          "EA",
          "CP22",
          "CP22A",
          "voucher",
          "claims",
          "calendar",
        ])
        .parse(url.searchParams.get("type"));
    if (type === "calendar") {
      const start = date.parse(url.searchParams.get("start")),
        end = date.parse(url.searchParams.get("end"));
      const scope = z
        .enum(["mine", "team"])
        .parse(url.searchParams.get("scope") || "mine");
      const category = z
        .enum(["All", "leave", "time_off", "shift", "holiday"])
        .parse(url.searchParams.get("category") || "All");
      if (end < start || Date.parse(end) - Date.parse(start) > 61 * 86400000)
        fail("Choose a calendar range of 1–62 days");
      const company = await getCompany(actor),
        records = await visibleRecords(actor);
      const events = calendarEvents(
        actor,
        company,
        records,
        start,
        end,
        scope,
      ).filter((e) => category === "All" || e.kind === category);
      await audit(db, actor, "Exported scoped calendar", null, {
        start,
        end,
        scope,
        category,
      });
      return new Response(exportCalendar(events, company.settings.timezone), {
        headers: {
          "Content-Type": "text/calendar; charset=utf-8",
          "Content-Disposition": `attachment; filename="people-calendar-${start}.ics"`,
          "Cache-Control": "private, no-store",
        },
      });
    }
    if (
      ["payroll", "EA", "CP22", "CP22A", "voucher"].includes(type)
        ? !hasPayroll(actor)
        : !isStaff(actor)
    )
      fail("You do not have permission to export these records", 403);
    const company = await getCompany(actor),
      year = z.coerce
        .number()
        .int()
        .min(2020)
        .max(2100)
        .parse(url.searchParams.get("year") || new Date().getFullYear());
    const employees = (
      await db.query<HRRecord>(
        "SELECT * FROM hr_records WHERE company_id=$1 AND kind='employee' ORDER BY data->>'name'",
        [actor.companyId],
      )
    ).rows;
    let rows: (string | number | null | undefined)[][] = [],
      filename = type;
    if (type === "voucher") {
      const id = z.uuid().parse(url.searchParams.get("id"));
      const voucher = (
        await db.query<HRRecord>(
          "SELECT * FROM hr_records WHERE company_id=$1 AND id=$2 AND kind='payment_voucher'",
          [actor.companyId, id],
        )
      ).rows[0];
      if (!voucher) fail("Voucher unavailable", 404);
      const records = (
        await db.query<HRRecord>(
          "SELECT * FROM hr_records WHERE company_id=$1 AND id=ANY($2::uuid[])",
          [actor.companyId, voucher.data.recordIds],
        )
      ).rows;
      rows = [
        [
          "Voucher",
          "Employee",
          "Bank",
          "Account",
          "Amount MYR",
          "Reference",
          "Status",
        ],
        ...records.map((r) => {
          const employee = employees.find((e) => e.id === r.employee_id);
          return [
            String(voucher.data.reference),
            String(employee?.data.name || r.data.employeeName || ""),
            String(r.data.bankName || employee?.data.bankName || ""),
            String(r.data.bankAccount || employee?.data.bankAccount || ""),
            Number(r.kind === "payroll" ? r.data.net : r.data.amount),
            String(voucher.data.bankReference || ""),
            String(voucher.data.status),
          ];
        }),
      ];
      filename += "-" + String(voucher.data.reference);
    } else if (type === "claims") {
      const claims = (
        await db.query<HRRecord>(
          "SELECT * FROM hr_records WHERE company_id=$1 AND kind='claim' AND substring(data->>'date',1,4)=$2 ORDER BY data->>'date'",
          [actor.companyId, String(year)],
        )
      ).rows;
      rows = [
        [
          "Date",
          "Employee",
          "Type",
          "Amount MYR",
          "Status",
          "Payroll ID",
          "Voucher ID",
        ],
        ...claims.map((r) => [
          String(r.data.date),
          String(
            employees.find((e) => e.id === r.employee_id)?.data.name || "",
          ),
          String(r.data.category),
          Number(r.data.amount),
          String(r.data.status),
          String(r.data.payrollId || ""),
          String(r.data.voucherId || ""),
        ]),
      ];
      filename += "-" + year;
    } else if (type === "employees")
      rows = [
        [
          "Name",
          "Email",
          "Title",
          "Start date",
          "End date",
          "Employment",
          "Status",
          "Base salary (MYR)",
          "Annual leave allowance",
          "Sick leave allowance",
        ],
        ...employees.map((e) => [
          String(e.data.name),
          String(e.data.email),
          String(e.data.title),
          String(e.data.startDate),
          String(e.data.endDate || ""),
          String(e.data.employmentType),
          String(e.data.status),
          Number(e.data.salary),
          Number(e.data.annualLeave),
          Number(e.data.sickLeave),
        ]),
      ];
    else if (type === "payroll") {
      const period = z
        .string()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
        .parse(url.searchParams.get("period"));
      const runId = url.searchParams.get("runId")
        ? z.uuid().parse(url.searchParams.get("runId"))
        : null;
      const legacy = url.searchParams.get("legacy") === "true";
      filename += `-${period}${runId ? "-" + runId : ""}`;
      const payslips = (
        await db.query<HRRecord>(
          "SELECT * FROM hr_records WHERE company_id=$1 AND kind='payroll' AND data->>'period'=$2 AND ($3::text IS NULL OR data->>'runId'=$3) AND (NOT $4::boolean OR data->>'runId' IS NULL) ORDER BY data->>'employeeName'",
          [actor.companyId, period, runId, legacy],
        )
      ).rows;
      const keys = [
        "employeeName",
        "period",
        "runId",
        "cycle",
        "startDate",
        "endDate",
        "payDate",
        "base",
        "allowance",
        "overtime",
        "bonus",
        "epfEmployee",
        "socsoEmployee",
        "eisEmployee",
        "pcb",
        "otherDeduction",
        "epfEmployer",
        "socsoEmployer",
        "eisEmployer",
        "gross",
        "net",
        "status",
      ];
      rows = [
        keys,
        ...payslips.map((p) => keys.map((key) => String(p.data[key] ?? ""))),
      ];
    } else {
      filename += `-worksheet-${year}`;
      rows = [
        [`${type} PREPARATION WORKSHEET — NOT AN OFFICIAL FORM OR SUBMISSION`],
        [
          "Company",
          company.name,
          "Registration",
          company.settings.registrationNo,
          "Employer tax number",
          company.settings.taxNo,
        ],
        ["Year", year],
        [
          "Complete and verify the current official form using MyTax / HASiL. Additional statutory fields and adjustments must be entered in the official form.",
        ],
      ];
      if (type === "EA") {
        const payslips = (
          await db.query<HRRecord>(
            "SELECT * FROM hr_records WHERE company_id=$1 AND kind='payroll' AND data->>'status'='Published' AND left(data->>'period',4)=$2",
            [actor.companyId, String(year)],
          )
        ).rows;
        const keys = [
          "base",
          "allowance",
          "overtime",
          "bonus",
          "commission",
          "gross",
          "epfEmployee",
          "socsoEmployee",
          "eisEmployee",
          "pcb",
          "otherDeduction",
          "zakat",
          "reimbursements",
          "net",
        ];
        rows.push([
          "Employee",
          "Email",
          "Published months",
          "Published runs",
          ...keys.map((k) => `${k} (MYR)`),
        ]);
        for (const e of employees) {
          const items = payslips.filter((p) => p.employee_id === e.id);
          if (!items.length) continue;
          rows.push([
            String(e.data.name),
            String(e.data.email),
            new Set(items.map((p) => String(p.data.period))).size,
            items.length,
            ...keys.map(
              (k) =>
                Math.round(
                  items.reduce(
                    (n, p) => n + Math.round(Number(p.data[k] || 0) * 100),
                    0,
                  ),
                ) / 100,
            ),
          ]);
        }
      } else {
        rows.push([
          "Employee",
          "Email",
          "Job title",
          "Employment start",
          "Employment end",
          "Phone",
          "Current base salary (MYR)",
        ]);
        for (const e of employees.filter((e) =>
          type === "CP22"
            ? String(e.data.startDate).startsWith(String(year))
            : e.data.status === "Archived" &&
              e.data.endDate &&
              String(e.data.endDate).startsWith(String(year)),
        ))
          rows.push([
            String(e.data.name),
            String(e.data.email),
            String(e.data.title),
            String(e.data.startDate),
            String(e.data.endDate || ""),
            String(e.data.phone || ""),
            Number(e.data.salary),
          ]);
      }
    }
    await audit(db, actor, `Exported ${type}`, null, { year });
    return new Response(csv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  });
}
