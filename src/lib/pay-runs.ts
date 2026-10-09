import { z } from "zod";
import { fail } from "./errors";
import { date } from "./schema";
import { calculateStatutory } from "./statutory";
import type { Data, HRRecord } from "./types";
import { payCycles } from "./pay-runs-client";
export const payRunInput = z.object({
  period: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
  cycle: z.enum(payCycles).optional(),
  runId: z.uuid().optional(),
  finalInMonth: z.boolean().default(false),
  startDate: date.optional(),
  endDate: date.optional(),
  payDate: date.optional(),
  title: z.string().trim().min(1).max(200).optional(),
  departmentId: z.uuid().optional(),
  employeeId: z.uuid().optional(),
});
export function monthWindow(period: string) {
  return {
    startDate: period + "-01",
    endDate:
      period +
      "-" +
      new Date(
        Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5)), 0),
      ).getUTCDate(),
  };
}
export function payRunDates(body: z.infer<typeof payRunInput>) {
  if (!body.cycle && !body.period) fail("Choose a pay cycle and dates");
  const cycle = body.cycle || "Monthly";
  const defaultWindow = body.period ? monthWindow(body.period) : null;
  const startDate = body.startDate || defaultWindow?.startDate;
  const endDate = body.endDate || defaultWindow?.endDate;
  if (!startDate || !endDate || endDate < startDate)
    fail("Choose valid pay-run dates");
  const days =
    Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86400000) + 1;
  if (
    days > 62 ||
    (cycle === "Weekly" && days !== 7) ||
    (cycle === "Fortnightly" && days !== 14)
  )
    fail(
      "Weekly runs need 7 days; fortnightly runs need 14 days; other runs allow up to 62 days",
    );
  if (
    cycle === "Monthly" &&
    (startDate !== monthWindow(startDate.slice(0, 7)).startDate ||
      endDate !== monthWindow(startDate.slice(0, 7)).endDate)
  )
    fail("Monthly runs must cover one calendar month");
  const payDate = body.payDate || endDate;
  if (payDate < endDate) fail("Pay date must be on or after the run end date");
  if (cycle === "Final settlement" && !body.employeeId)
    fail("Choose one employee for final settlement");
  return {
    cycle,
    startDate,
    endDate,
    payDate,
    period: payDate.slice(0, 7),
    finalInMonth: body.finalInMonth,
  };
}
export function overlapsPay(data: Data, startDate: string, endDate: string) {
  if (data.cycle === "Off-cycle") return false;
  const window =
    data.startDate && data.endDate
      ? { startDate: String(data.startDate), endDate: String(data.endDate) }
      : monthWindow(String(data.period));
  return window.startDate <= endDate && window.endDate >= startDate;
}
const deductionKeys = [
  "epfEmployee",
  "epfEmployer",
  "socsoEmployee",
  "socsoEmployer",
  "eisEmployee",
  "eisEmployer",
  "pcb",
  "zakat",
];
/** Reconcile the month's complete remuneration, deducting contributions already allocated in published runs. */
export function reconcileRun(profile: Data, draft: Data, history: HRRecord[]) {
  const period = String(draft.period),
    end = monthWindow(period).endDate;
  if (
    draft.cycle !== "Final settlement" &&
    !draft.finalInMonth &&
    String(draft.payDate || draft.endDate || end) < end
  )
    fail(
      "Use verified manual deductions for interim runs. Mark the last payday of this month before reconciling, or reconcile at calendar month-end.",
    );
  const prior = history.filter(
    (r) => r.data.status === "Published" && r.data.period === period,
  );
  if (
    history.some(
      (r) =>
        r.data.status === "Draft" &&
        r.data.period === period &&
        r.id !== draft.id,
    )
  )
    fail(
      "Publish or resolve the other drafts for this employee before monthly reconciliation",
    );
  const wage = (d: Data, key: string): number => {
    const c = d.calculation as Data | undefined;
    if (key === "taxableNormal")
      return Number(
        d.taxableNormal ??
          c?.taxableNormal ??
          Number(d.base) +
            Number(d.allowance) +
            Number(d.overtime) -
            Number(d.unpaidDeduction || 0),
      );
    if (key === "taxableAdditional")
      return Number(
        d.taxableAdditional ??
          c?.taxableAdditional ??
          Number(d.bonus) + Number(d.commission || 0),
      );
    if (key === "epfNormalWages")
      return Number(
        d.epfNormalWages ??
          c?.epfNormalWages ??
          Number(d.base) + Number(d.allowance) - Number(d.unpaidDeduction || 0),
      );
    if (key === "epfWages")
      return Number(
        d.epfWages ??
          c?.epfWages ??
          wage(d, "epfNormalWages") +
            Number(d.bonus) +
            Number(d.commission || 0),
      );
    return Number(
      d.socsoWages ??
        c?.socsoWages ??
        Number(d.base) +
          Number(d.allowance) +
          Number(d.overtime) +
          Number(d.commission || 0) -
          Number(d.unpaidDeduction || 0),
    );
  };
  const keys = [
    "taxableNormal",
    "taxableAdditional",
    "epfNormalWages",
    "epfWages",
    "socsoWages",
  ];
  const combined = {
    ...draft,
    bonus:
      Number(draft.bonus) + prior.reduce((n, r) => n + Number(r.data.bonus), 0),
    ...Object.fromEntries(
      keys.map((k) => [
        k,
        wage(draft, k) + prior.reduce((n, r) => n + wage(r.data, k), 0),
      ]),
    ),
  };
  const calculated = calculateStatutory(profile, combined, history);
  const result: Data = Object.fromEntries(
    deductionKeys.map((k) => {
      const due =
        Number(calculated[k as keyof typeof calculated]) -
        prior.reduce((n, r) => n + Number(r.data[k] || 0), 0);
      if (due < -0.01)
        fail(
          "Earlier deductions exceed the monthly total. Review the adjustment manually.",
        );
      return [k, Math.max(0, Math.round(due * 100) / 100)];
    }),
  );
  result.calculation = {
    ...calculated.calculation,
    method: "MY-2026-monthly-reconciliation",
    ...Object.fromEntries(keys.map((k) => [k, wage(draft, k)])),
    taxableTotal:
      wage(draft, "taxableNormal") + wage(draft, "taxableAdditional"),
    monthlyTotals: calculated,
    priorPayslipIds: prior.map((r) => r.id),
  };
  result.statutoryMode = "Reconciled";
  return result;
}
