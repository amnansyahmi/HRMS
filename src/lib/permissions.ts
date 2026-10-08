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
export function canRead(actor: Actor, record: HRRecord, team: string[]) {
  if (record.company_id !== actor.companyId) return false;
  if (isStaff(actor)) return true;
  if (["employee", "department", "policy"].includes(record.kind)) return true;
  if (record.kind === "shift")
    return (record.data.employeeIds as string[]).some((id) =>
      team.includes(id),
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
  if (["leave", "claim", "goal", "attendance"].includes(record.kind))
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
  if (record.kind === "assessment_result") {
    const data = { ...record.data };
    delete data.tokenHash;
    return { ...record, data };
  }
  return record;
}
export function canCreate(actor: Actor, kind: Kind, employeeId: string | null) {
  if (["attendance", "payroll", "assessment_result"].includes(kind))
    return false;
  if (isStaff(actor)) return true;
  if (["leave", "claim"].includes(kind))
    return employeeId !== null && employeeId === actor.employeeId;
  return kind === "goal" && actor.role === "manager";
}
