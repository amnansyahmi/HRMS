import { sameClaimPeriod } from "./claim-period";
import { leaveEntitlement } from "./leave-entitlement";
import { getCompany } from "./auth";
import { type DB } from "./db";
import { fail } from "./errors";
import { workingDays, localDate } from "./calculations";
import type { Actor, Data, HRRecord } from "./types";
export { requestKinds } from "./request-workflow";
import { requestKinds } from "./request-workflow";
export const employeeKinds = [
  ...requestKinds,
  "goal",
  "document",
  "asset",
  "job_history",
  "lifecycle",
  "letter",
  "evaluation",
];
export async function companyHolidays(tx: DB, actor: Actor, state = "") {
  const company = await getCompany(actor, tx);
  const holidays = (
    await tx.query<HRRecord>(
      "SELECT * FROM hr_records WHERE company_id=$1 AND kind='holiday' AND (data->>'state'='National' OR data->>'state'=$2)",
      [actor.companyId, state],
    )
  ).rows;
  return [
    ...new Set([
      ...company.settings.holidays,
      ...holidays.map((r) => String(r.data.date)),
    ]),
  ];
}
export async function selectedPolicy(
  tx: DB,
  actor: Actor,
  kind: "leave" | "claim",
  data: Data,
  employee: HRRecord,
) {
  const key = kind === "leave" ? "leaveTypeId" : "claimTypeId";
  if (!data[key]) return null;
  const policy = (
    await tx.query<HRRecord>(
      "SELECT * FROM hr_records WHERE company_id=$1 AND id=$2 AND kind=$3",
      [actor.companyId, data[key], kind + "_type"],
    )
  ).rows[0];
  if (
    !policy ||
    (policy.data.departmentId &&
      policy.data.departmentId !== employee.data.departmentId)
  )
    fail("This policy does not apply to the employee");
  if (kind === "leave") data.type = policy.data.name;
  else data.category = policy.data.name;
  if (
    policy.data.receiptRequired &&
    !data[kind === "leave" ? "evidenceId" : "receiptId"]
  )
    fail("This policy requires an attachment");
  return policy;
}
export function leavePortion(data: Data) {
  return data.unit === "Morning"
    ? [9 / 24, 13 / 24]
    : data.unit === "Afternoon"
      ? [13 / 24, 17 / 24]
      : data.unit === "Hours"
        ? [
            Number(data.startHour ?? 9) / 24,
            (Number(data.startHour ?? 9) + Number(data.hours)) / 24,
          ]
        : [0, 1];
}
export async function leaveDays(
  tx: DB,
  actor: Actor,
  employee: HRRecord,
  data: Data,
  excludeId: string | null = null,
) {
  const company = await getCompany(actor, tx),
    start = String(data.startDate),
    end = String(data.endDate);
  if (start.slice(0, 4) !== end.slice(0, 4))
    fail("Split leave requests that cross calendar years");
  if (data.unit !== "Full day" && start !== end)
    fail("Partial leave must be on one date");
  const policy = await selectedPolicy(tx, actor, "leave", data, employee);
  const working = workingDays(
    start,
    end,
    company.settings.workDays,
    await companyHolidays(tx, actor, String(employee.data.state || "")),
  );
  if (!working) fail("This date range has no working days");
  const hoursPerDay = Number(employee.data.hoursPerDay || 8);
  if (
    data.unit === "Hours" &&
    (Number(data.hours) > hoursPerDay ||
      Number(data.startHour ?? 9) + Number(data.hours) > 24)
  )
    fail("Hours cannot exceed the employee’s working day");
  const days =
    working *
    (data.unit === "Morning" || data.unit === "Afternoon"
      ? 0.5
      : data.unit === "Hours"
        ? Number(data.hours) / hoursPerDay
        : 1);
  const leaves = (
    await tx.query<HRRecord>(
      "SELECT * FROM hr_records WHERE company_id=$1 AND employee_id=$2 AND kind='leave' AND data->>'status' IN ('Pending','Approved') AND ($3::uuid IS NULL OR id<>$3)",
      [actor.companyId, employee.id, excludeId],
    )
  ).rows;
  const interval = leavePortion(data);
  if (
    leaves.some(
      (l) =>
        String(l.data.startDate) <= end &&
        String(l.data.endDate) >= start &&
        (start !== end ||
          l.data.startDate !== l.data.endDate ||
          Math.max(interval[0], leavePortion(l.data)[0]) <
            Math.min(interval[1], leavePortion(l.data)[1])),
    )
  )
    fail("This request overlaps existing leave", 409);
  const balance = leaveEntitlement(
    employee,
    policy,
    String(data.type),
    start,
    localDate(new Date(), company.settings.timezone),
    leaves,
  );
  if (balance && days > balance.available + 0.000001)
    fail(
      `Insufficient ${String(data.type).toLowerCase()} leave balance. ${balance.available.toFixed(2)} days available.`,
    );
  const off = (
    await tx.query<HRRecord>(
      "SELECT * FROM hr_records WHERE company_id=$1 AND employee_id=$2 AND kind='time_off' AND data->>'status' IN ('Pending','Approved') AND data->>'date'>=$3 AND data->>'date'<=$4",
      [actor.companyId, employee.id, start, end],
    )
  ).rows;
  if (
    off.some((r) => {
      const bounds = [String(r.data.start), String(r.data.end)].map((v) => {
        const [h, m] = v.split(":").map(Number);
        return (h * 60 + m) / 1440;
      });
      return (
        Math.max(interval[0], bounds[0]) < Math.min(interval[1], bounds[1])
      );
    })
  )
    fail("This leave overlaps a time-off request", 409);
  return Math.round(days * 10000) / 10000;
}
export async function claimBalance(
  tx: DB,
  actor: Actor,
  employee: HRRecord,
  data: Data,
  excludeId: string | null = null,
) {
  const policy = await selectedPolicy(tx, actor, "claim", data, employee);
  if (!policy) return null;
  if (Number(policy.data.mileageRate) > 0) {
    if (!Number(data.mileageKm)) fail("Enter the distance claimed");
    data.amount =
      Math.round(
        Number(data.mileageKm) * Number(policy.data.mileageRate) * 100,
      ) / 100;
  }
  const period = policy.data.period;
  if (period === "Per trip" && !String(data.tripReference || "").trim())
    fail("Enter a trip reference for this claim policy");
  const rows = (
    await tx.query<HRRecord>(
      "SELECT * FROM hr_records WHERE company_id=$1 AND employee_id=$2 AND kind='claim' AND data->>'claimTypeId'=$3 AND data->>'status' IN ('Pending','Approved','Paid') AND ($4::uuid IS NULL OR id<>$4)",
      [actor.companyId, employee.id, policy.id, excludeId],
    )
  ).rows;
  const used =
      period === "Per request"
        ? 0
        : rows
            .filter((r) => sameClaimPeriod(period, r.data, data))
            .reduce((n, r) => n + Number(r.data.amount), 0),
    available = Math.max(0, Number(policy.data.limit) - used);
  if (Number(data.amount) > available + 0.001)
    fail(
      `Claim exceeds the available ${String(policy.data.name)} balance (${available.toFixed(2)} MYR)`,
    );
  return { used, available, limit: Number(policy.data.limit) };
}
export function approvalRule(policy: HRRecord | null) {
  return String(policy?.data.approval || "Manager or HR");
}

export async function checkTimeOff(
  tx: DB,
  actor: Actor,
  employeeId: string,
  data: Data,
  excludeId: string | null = null,
) {
  const minutes = (v: unknown) => {
      const [h, m] = String(v).split(":").map(Number);
      return (h * 60 + m) / 1440;
    },
    interval = [minutes(data.start), minutes(data.end)];
  const rows = (
    await tx.query<HRRecord>(
      "SELECT * FROM hr_records WHERE company_id=$1 AND employee_id=$2 AND kind IN ('leave','time_off') AND data->>'status' IN ('Pending','Approved') AND ($3::uuid IS NULL OR id<>$3)",
      [actor.companyId, employeeId, excludeId],
    )
  ).rows;
  if (
    rows.some((r) => {
      if (
        r.kind === "leave" &&
        (String(r.data.startDate) > String(data.date) ||
          String(r.data.endDate) < String(data.date))
      )
        return false;
      if (r.kind === "time_off" && r.data.date !== data.date) return false;
      const bounds =
        r.kind === "leave"
          ? leavePortion(r.data)
          : [minutes(r.data.start), minutes(r.data.end)];
      return (
        Math.max(interval[0], bounds[0]) < Math.min(interval[1], bounds[1])
      );
    })
  )
    fail("Time off overlaps an existing request", 409);
}
