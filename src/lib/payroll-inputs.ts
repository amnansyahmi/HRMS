import { workingDays } from "./calculations";
import type { HRRecord } from "./types";
export function payrollInputs(
  employee: HRRecord,
  period: string,
  records: HRRecord[],
  workDays: number[],
  holidays: string[],
  overtimeRates: Record<string, number> = {
    Normal: 1.5,
    "Rest day": 2,
    "Public holiday": 3,
  },
  window?: { startDate: string; endDate: string; cycle?: string },
) {
  const [year, month] = period.split("-").map(Number),
    daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate(),
    start = window?.startDate || period + "-01",
    end = window?.endDate || period + "-" + daysInMonth;
  const divisor = (date: string) =>
    new Date(
      Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0),
    ).getUTCDate();
  const first =
      String(employee.data.startDate) > start
        ? String(employee.data.startDate)
        : start,
    last =
      employee.data.endDate && String(employee.data.endDate) < end
        ? String(employee.data.endDate)
        : end;
  const payableDays = Math.max(
    0,
    Math.round((Date.parse(last) - Date.parse(first)) / 86400000) + 1,
  );
  const changes = records
    .filter((r) => r.kind === "job_history" && r.employee_id === employee.id)
    .sort(
      (a, b) =>
        String(a.data.effectiveDate).localeCompare(
          String(b.data.effectiveDate),
        ) ||
        a.created_at.localeCompare(b.created_at) ||
        a.id.localeCompare(b.id),
    );
  const salaryAt = (date: string) => {
    let value = changes.length
      ? Number(changes[0].data.previousSalary)
      : Number(employee.data.salary);
    for (const change of changes)
      if (String(change.data.effectiveDate) <= date)
        value = Number(change.data.newSalary);
      else break;
    return value;
  };
  let unroundedBase = 0;
  for (let day = Date.parse(first); day <= Date.parse(last); day += 86400000)
    unroundedBase +=
      salaryAt(new Date(day).toISOString().slice(0, 10)) /
      divisor(new Date(day).toISOString().slice(0, 10));
  const base =
    window?.cycle === "Off-cycle" ? 0 : Math.round(unroundedBase * 100) / 100;
  const own = records.filter((r) => r.employee_id === employee.id),
    inputs: HRRecord[] = [];
  let unpaidDays = 0,
    unpaidAmount = 0;
  for (const leave of own.filter(
    (r) => r.kind === "leave" && r.data.status === "Approved",
  )) {
    const type = records.find((r) => r.id === leave.data.leaveTypeId);
    if (!(type ? type.data.paid === false : leave.data.type === "Unpaid"))
      continue;
    const from =
        String(leave.data.startDate) > first
          ? String(leave.data.startDate)
          : first,
      to =
        String(leave.data.endDate) < last ? String(leave.data.endDate) : last;
    if (from > to) continue;
    const unit = leave.data.unit,
      portion =
        unit === "Morning" || unit === "Afternoon"
          ? 0.5
          : unit === "Hours"
            ? Number(leave.data.hours) / Number(employee.data.hoursPerDay || 8)
            : 1;
    const days = workingDays(from, to, workDays, holidays) * portion;
    if (days && window?.cycle !== "Off-cycle") {
      unpaidDays += days;
      for (let day = Date.parse(from); day <= Date.parse(to); day += 86400000) {
        const date = new Date(day).toISOString().slice(0, 10);
        if (workingDays(date, date, workDays, holidays))
          unpaidAmount += (salaryAt(date) / divisor(date)) * portion;
      }
      inputs.push(leave);
    }
  }
  const unpaidDeduction = Math.round(unpaidAmount * 100) / 100;
  let overtime = 0;
  for (const ot of own.filter(
    (r) =>
      r.kind === "overtime" &&
      r.data.status === "Approved" &&
      String(r.data.date) >= first &&
      String(r.data.date) <= last &&
      !r.data.payrollId,
  )) {
    if (employee.data.overtimeEligible) {
      const rate = overtimeRates[String(ot.data.type)];
      if (!Number.isFinite(rate) || rate < 1)
        throw new Error("Configure a valid overtime rate");
      overtime +=
        (salaryAt(String(ot.data.date)) /
          26 /
          Number(employee.data.hoursPerDay || 8)) *
        Number(ot.data.hours) *
        rate;
      inputs.push(ot);
    }
  }
  const claims = own.filter(
    (r) =>
      r.kind === "claim" &&
      r.data.status === "Approved" &&
      String(r.data.date) <= end &&
      !r.data.payrollId &&
      !r.data.voucherId,
  );
  inputs.push(...claims);
  const attendance = own.filter(
      (r) =>
        r.kind === "attendance" &&
        String(r.data.workDate) >= first &&
        String(r.data.workDate) <= last,
    ),
    lateMinutes = attendance
      .filter((r) => !r.data.lateExcused)
      .reduce((n, r) => n + Number(r.data.lateMinutes || 0), 0);
  return {
    base,
    employeeTitle:
      changes.filter((r) => String(r.data.effectiveDate) <= last).at(-1)?.data
        .title ||
      (changes.length ? changes[0].data.previousTitle : employee.data.title),
    unpaidDeduction,
    overtime: Math.round(overtime * 100) / 100,
    reimbursements:
      Math.round(claims.reduce((n, r) => n + Number(r.data.amount), 0) * 100) /
      100,
    inputRecordIds: inputs.map((r) => r.id),
    note: `${window ? `${window.cycle}: ${start} to ${end}. ` : ""}Calendar-day proration: ${payableDays} payable days using each date’s calendar-month divisor. Unpaid working days: ${unpaidDays}. Unexcused lateness: ${lateMinutes} minutes (HR enters any verified pay adjustment). Overtime uses approved hours and configured type rates; HR must review eligibility and normal rest-day pay.`,
    inputSummary: { payableDays, daysInMonth, unpaidDays },
  };
}
