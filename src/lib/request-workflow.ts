import { hasPayroll } from "./workflow-config";
import { isStaff, type Actor, type HRRecord, type Kind } from "./types";

export const requestKinds: Kind[] = [
  "leave",
  "claim",
  "overtime",
  "time_off",
  "attendance_correction",
  "lateness",
  "goal_update",
];
export const requestLabels: Partial<Record<Kind, string>> = {
  leave: "Leave",
  claim: "Claim",
  overtime: "Overtime",
  time_off: "Time off",
  attendance_correction: "Clock correction",
  lateness: "Lateness",
  goal_update: "Goal progress",
  profile_change: "Profile change",
};
export type ReviewDecision =
  "Approved" | "Rejected" | "Returned" | "Cancelled" | "Paid";
export function ownsRequest(
  actor: Actor,
  record: HRRecord,
  employees: HRRecord[],
) {
  return (
    (record.kind === "profile_change" &&
      record.data.submittedBy === actor.userId) ||
    record.employee_id === actor.employeeId ||
    employees.find((e) => e.id === record.employee_id)?.data.email ===
      actor.email
  );
}
export function requestPolicy(record: HRRecord, records: HRRecord[]) {
  return records.find(
    (p) =>
      p.id ===
      record.data[record.kind === "leave" ? "leaveTypeId" : "claimTypeId"],
  );
}
export function approvalStage(record: HRRecord, records: HRRecord[]) {
  if (record.data.status !== "Pending") return String(record.data.status);
  if (record.kind === "profile_change") return "Awaiting HR";
  const rule = requestPolicy(record, records)?.data.approval;
  const employee = records.find(
    (e) => e.kind === "employee" && e.id === record.employee_id,
  );
  return rule === "HR only" ||
    (rule === "Manager then HR" && Number(record.data.approvalStep) > 0)
    ? "Awaiting HR"
    : rule === "Manager then HR" && employee?.data.managerId
      ? "Awaiting manager"
      : "Awaiting reviewer";
}
/** Mirrors review permissions for UI affordances; mutations always recheck on the server. */
export function reviewOptions(
  actor: Actor,
  record: HRRecord,
  records: HRRecord[],
): ReviewDecision[] {
  if (
    record.company_id !== actor.companyId ||
    ![...requestKinds, "profile_change"].includes(record.kind)
  )
    return [];
  const employees = records.filter((r) => r.kind === "employee"),
    own = ownsRequest(actor, record, employees);
  if (own) return record.data.status === "Pending" ? ["Cancelled"] : [];
  if (record.kind === "profile_change")
    return isStaff(actor) && record.data.status === "Pending"
      ? ["Approved", "Rejected"]
      : [];
  if (
    record.kind === "claim" &&
    record.data.status === "Approved" &&
    hasPayroll(actor, "pay") &&
    !record.data.payrollId &&
    !record.data.voucherId
  )
    return ["Paid"];
  const employee = employees.find((e) => e.id === record.employee_id);
  if (
    record.data.status !== "Pending" ||
    !(
      isStaff(actor) ||
      (actor.role === "manager" &&
        actor.employeeId &&
        employee?.data.managerId === actor.employeeId)
    )
  )
    return [];
  const stage = approvalStage(record, records);
  const approve =
    stage === "Awaiting HR"
      ? isStaff(actor)
      : stage === "Awaiting manager"
        ? actor.employeeId === employee?.data.managerId
        : true;
  return [
    ...(approve ? ["Approved" as const] : []),
    "Rejected",
    ...(record.kind === "claim" ? ["Returned" as const] : []),
  ];
}
