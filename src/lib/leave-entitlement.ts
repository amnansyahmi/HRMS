import type { HRRecord } from "./types";
export function leaveEntitlement(
  employee: HRRecord,
  policy: HRRecord | null,
  type: string,
  date: string,
  today: string,
  leaves: HRRecord[],
) {
  const year = date.slice(0, 4),
    own = leaves.filter(
      (l) =>
        l.employee_id === employee.id &&
        l.data.type === type &&
        ["Pending", "Approved"].includes(String(l.data.status)),
    );
  let allowance = policy
    ? Number(policy.data.annualDays)
    : type === "Annual"
      ? Number(employee.data.annualLeave)
      : type === "Sick"
        ? Number(employee.data.sickLeave)
        : null;
  if (allowance === null) return null;
  if (policy?.data.accrual === "Monthly") {
    const months = Math.min(
      Number(date.slice(5, 7)),
      today.slice(0, 4) === year
        ? Number(today.slice(5, 7))
        : Number(year) > Number(today.slice(0, 4))
          ? 0
          : 12,
    );
    const firstMonth =
      String(employee.data.startDate).slice(0, 4) === year
        ? Number(String(employee.data.startDate).slice(5, 7))
        : 1;
    allowance =
      Math.floor(
        ((allowance * Math.max(0, months - firstMonth + 1)) / 12) * 100,
      ) / 100;
  }
  const previousYear = String(Number(year) - 1),
    prevUsed = own
      .filter(
        (l) =>
          String(l.data.startDate).startsWith(previousYear) &&
          l.data.status === "Approved",
      )
      .reduce((n, l) => n + Number(l.data.days), 0);
  const carry =
    policy &&
    String(employee.data.startDate).slice(0, 4) <= previousYear &&
    Number(date.slice(5, 7)) <= Number(policy.data.carryExpiryMonth)
      ? Math.min(
          Number(policy.data.carryDays),
          Math.max(0, Number(policy.data.annualDays) - prevUsed),
        )
      : 0;
  allowance +=
    carry + (type === "Annual" ? Number(employee.data.carryForward || 0) : 0);
  const used = own
    .filter((l) => String(l.data.startDate).startsWith(year))
    .reduce((n, l) => n + Number(l.data.days), 0);
  return { allowance, used, available: Math.max(0, allowance - used) };
}
