import { employeeKinds, requestKinds } from "./policies";
import type { Actor, HRRecord, Kind } from "./types";
import { isStaff } from "./types";
export function teamIds(actor: Actor, employees: HRRecord[]) {
  return employees
    .filter(
      (e) =>
        e.id === actor.employeeId ||
        (actor.role === "manager" && e.data.managerId === actor.employeeId),
    )
    .map((e) => e.id);
}
export function canRead(
  actor: Actor,
  record: HRRecord,
  team: string[],
  departmentId?: unknown,
) {
  if (record.company_id !== actor.companyId) return false;
  if (record.kind === "meeting")
    return (
      actor.role === "owner" ||
      record.data.createdBy === actor.userId ||
      ((record.data.sharedEmployeeIds as string[]) || []).includes(
        actor.employeeId || "",
      )
    );
  if (isStaff(actor)) return true;
  if (
    [
      "employee",
      "department",
      "policy",
      "location",
      "holiday",
      "leave_type",
      "claim_type",
      "review_cycle",
      "evaluation_template",
    ].includes(record.kind)
  )
    return true;
  if (record.kind === "goal" && record.data.scope === "Company") return true;
  if (record.kind === "goal" && record.data.scope === "Team")
    return record.data.departmentId === departmentId;
  if (record.kind === "announcement")
    return (
      !!record.data.published &&
      (!record.data.departmentId ||
        record.data.departmentId === departmentId) &&
      (!record.data.expiresOn ||
        String(record.data.expiresOn) >= new Date().toISOString().slice(0, 10))
    );
  if (record.kind === "assessment_result" && record.employee_id)
    return team.includes(record.employee_id);
  if (record.kind === "letter")
    return (
      record.employee_id === actor.employeeId && record.data.status === "Issued"
    );
  if (record.kind === "document")
    return record.employee_id === actor.employeeId;
  if (record.kind === "shift")
    return (
      ((record.data.departmentIds as string[]) || []).includes(
        String(departmentId),
      ) || (record.data.employeeIds as string[]).some((id) => team.includes(id))
    );
  if (
    ["job", "candidate", "assessment", "assessment_result", "meeting"].includes(
      record.kind,
    )
  )
    return false;
  if (record.kind === "payroll")
    return (
      record.employee_id === actor.employeeId &&
      record.data.status === "Published"
    );
  if ([...employeeKinds, "attendance"].includes(record.kind))
    return !!record.employee_id && team.includes(record.employee_id);
  return false;
}
export function redact(actor: Actor, record: HRRecord): HRRecord {
  if (
    record.kind === "employee" &&
    !isStaff(actor) &&
    record.id !== actor.employeeId
  ) {
    const { name, title, departmentId, managerId, status, employmentType } =
      record.data;
    return {
      ...record,
      data: { name, title, departmentId, managerId, status, employmentType },
    };
  }
  if (
    record.kind === "job_history" &&
    !isStaff(actor) &&
    record.employee_id !== actor.employeeId
  ) {
    const data = { ...record.data };
    delete data.previousSalary;
    delete data.newSalary;
    return { ...record, data };
  }
  if (record.kind === "assessment_result") {
    const data = { ...record.data };
    delete data.tokenHash;
    return { ...record, data };
  }
  return record;
}
export function canCreate(actor: Actor, kind: Kind, employeeId: string | null) {
  if (
    [
      "attendance",
      "payroll",
      "assessment_result",
      "job_history",
      "payment_voucher",
    ].includes(kind)
  )
    return false;
  if (isStaff(actor)) return true;
  if (requestKinds.includes(kind) || kind === "document")
    return employeeId !== null && employeeId === actor.employeeId;
  return kind === "goal" && actor.role === "manager";
}
