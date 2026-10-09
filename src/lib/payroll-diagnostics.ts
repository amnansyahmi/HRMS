import { z } from "zod";
import { payrollTotals } from "./calculations";
import { hasPayroll } from "./workflow-config";
import { visibleRecords } from "./hr";
import { fail } from "./errors";
import type { Actor, HRRecord } from "./types";
export type PayrollFinding = {
  code: string;
  severity: "Review" | "Error";
  recordId: string;
  employeeId: string | null;
  title: string;
  detail: string;
};
export function checkPayrollDrafts(drafts: HRRecord[], records: HRRecord[]) {
  const findings: PayrollFinding[] = [];
  const add = (
    row: HRRecord,
    code: string,
    severity: "Review" | "Error",
    title: string,
    detail: string,
  ) =>
    findings.push({
      code,
      severity,
      recordId: row.id,
      employeeId: row.employee_id,
      title,
      detail,
    });
  const seen = new Map<string, string>();
  for (const row of drafts) {
    const d = row.data;
    try {
      const expected = payrollTotals(d);
      if (
        !Number.isFinite(Number(d.gross)) ||
        !Number.isFinite(Number(d.net)) ||
        Math.abs(expected.gross - Number(d.gross)) > 0.01 ||
        Math.abs(expected.net - Number(d.net)) > 0.01
      )
        add(
          row,
          "totals",
          "Error",
          "Pay totals need recalculation",
          `Expected gross RM${expected.gross.toFixed(2)} and net RM${expected.net.toFixed(2)} from the stored inputs.`,
        );
    } catch {
      add(
        row,
        "deductions",
        "Error",
        "Deductions exceed earnings",
        "Review employee deductions and remuneration before publication.",
      );
    }
    if (!d.reviewed)
      add(
        row,
        "unreviewed",
        "Review",
        "Draft awaiting review",
        "Complete the existing payroll review before publication.",
      );
    const employee = records.find(
      (r) =>
        r.company_id === row.company_id &&
        r.kind === "employee" &&
        r.id === row.employee_id,
    );
    if (employee && !employee.data.bankAccount)
      add(
        row,
        "bank",
        "Review",
        "Bank details are missing",
        "Confirm payment instructions with the employee; this does not prevent an approved alternative payment method.",
      );
    if (employee && employee.data.taxProfileVerified === false)
      add(
        row,
        "tax-profile",
        "Review",
        "Tax profile is not marked verified",
        "HR should verify the profile and deductions; this check does not assess legal compliance.",
      );
    const prior = records
      .filter(
        (r) =>
          r.company_id === row.company_id &&
          r.kind === "payroll" &&
          r.employee_id === row.employee_id &&
          r.data.status === "Published" &&
          String(r.data.period) < String(d.period) &&
          String(r.data.cycle || "Monthly") === String(d.cycle || "Monthly"),
      )
      .sort((a, b) =>
        String(b.data.period).localeCompare(String(a.data.period)),
      )[0];
    if (prior && String(d.cycle || "Monthly") === "Monthly") {
      const baseline = Number(prior.data.gross),
        change = Number(d.gross) - baseline;
      if (
        baseline > 0 &&
        Math.abs(change) >= 100 &&
        Math.abs(change) / baseline > 0.2
      )
        add(
          row,
          "variance",
          "Review",
          "Gross pay changed by more than 20%",
          `RM${baseline.toFixed(2)} in ${prior.data.period} → RM${Number(d.gross).toFixed(2)}. Check proration, salary changes and variable earnings.`,
        );
    }
    for (const id of (d.inputRecordIds as string[]) || []) {
      const input = records.find(
        (r) => r.company_id === row.company_id && r.id === id,
      );
      if (!input || !["claim", "overtime"].includes(input.kind)) continue;
      const key = `${row.employee_id}:${id}`;
      if (seen.has(key) && seen.get(key) !== row.id)
        add(
          row,
          "duplicate-input",
          "Error",
          "Input appears in more than one draft",
          `${input.kind} ${id} is allocated more than once in this reviewed selection.`,
        );
      seen.set(key, row.id);
      if (
        (input.data.payrollId && input.data.payrollId !== row.id) ||
        input.data.voucherId
      )
        add(
          row,
          "paid-input",
          "Error",
          "Input is already allocated",
          `${input.kind} ${id} has another payroll or payment allocation.`,
        );
    }
  }
  return {
    drafts: drafts.length,
    errors: findings.filter((f) => f.severity === "Error").length,
    findings,
  };
}
export async function payrollDiagnostics(actor: Actor, input: unknown) {
  if (!hasPayroll(actor)) fail("Payroll access required", 403);
  const body = z
    .object({
      period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
      runId: z.uuid().optional(),
    })
    .parse(input);
  const records = await visibleRecords(actor);
  return checkPayrollDrafts(
    records.filter(
      (r) =>
        r.kind === "payroll" &&
        r.data.status === "Draft" &&
        r.data.period === body.period &&
        (body.runId ? r.data.runId === body.runId : !r.data.runId),
    ),
    records,
  );
}
