import { localDate } from "./calculations";
import { hasPayroll, specialistAllows } from "./workflow-config";
import { fail } from "./errors";
import type { Actor, Company, HRRecord } from "./types";
/** Complete aggregate of already-authorized records, rather than counting the model's truncated context. */
export function hrBrief(
  actor: Actor,
  company: Company,
  input: HRRecord[],
  now = new Date(),
) {
  if (actor.role !== "owner" || actor.companyId !== company.id)
    fail("The company brief is available to its owner", 403);
  const records = input.filter((r) => r.company_id === actor.companyId),
    today = localDate(now, company.settings.timezone);
  const employees = records.filter(
    (r) => r.kind === "employee" && r.data.status !== "Archived",
  );
  const departments = [
    null,
    ...records.filter((r) => r.kind === "department").map((r) => r.id),
  ].map((id) => {
    const people = employees.filter(
      (e) => (e.data.departmentId || null) === id,
    );
    return {
      id,
      name: id
        ? String(records.find((r) => r.id === id)?.data.name)
        : "Unassigned",
      headcount: people.length,
      ...(hasPayroll(actor) &&
      specialistAllows(company.settings, "payroll", "read")
        ? {
            monthlyBaseSalaryMYR:
              Math.round(
                people.reduce((sum, e) => sum + Number(e.data.salary || 0), 0) *
                  100,
              ) / 100,
          }
        : {}),
    };
  });
  const leaveToday = records.filter(
    (r) =>
      r.kind === "leave" &&
      r.data.status === "Approved" &&
      String(r.data.startDate) <= today &&
      String(r.data.endDate) >= today,
  );
  const present = new Set(
    records
      .filter(
        (r) =>
          r.kind === "attendance" &&
          r.data.workDate === today &&
          r.data.clockIn,
      )
      .map((r) => r.employee_id),
  );
  const off = new Set(leaveToday.map((r) => r.employee_id));
  const pending = records.filter(
    (r) =>
      [
        "leave",
        "claim",
        "overtime",
        "time_off",
        "lateness",
        "attendance_correction",
        "goal_update",
        "profile_change",
      ].includes(r.kind) && r.data.status === "Pending",
  );
  const counts = Object.fromEntries(
    [...new Set(pending.map((r) => r.kind))].map((kind) => [
      kind,
      pending.filter((r) => r.kind === kind).length,
    ]),
  );
  const jobCounts = records
    .filter((r) => r.kind === "job" && r.data.status === "Published")
    .map((j) => ({
      id: j.id,
      title: j.data.title,
      applications: records.filter(
        (r) => r.kind === "candidate" && r.data.jobId === j.id,
      ).length,
    }));
  const payrollRuns = records
    .filter((r) => r.kind === "payroll_run")
    .slice(0, 12)
    .map((run) => {
      const items = records.filter(
        (r) => r.kind === "payroll" && r.data.runId === run.id,
      );
      return {
        id: run.id,
        period: run.data.period,
        status: run.data.status,
        employees: items.length,
        grossMYR:
          Math.round(
            items.reduce((sum, r) => sum + Number(r.data.gross || 0), 0) * 100,
          ) / 100,
        netMYR:
          Math.round(
            items.reduce((sum, r) => sum + Number(r.data.net || 0), 0) * 100,
          ) / 100,
      };
    });
  return {
    date: today,
    timezone: company.settings.timezone,
    headcount: employees.length,
    departments,
    attendance: specialistAllows(company.settings, "attendance", "read")
      ? {
          clockedInToday: employees.filter((e) => present.has(e.id)).length,
          approvedLeaveOverlapsToday: employees.filter((e) => off.has(e.id))
            .length,
          noClockOrApprovedLeave: employees.filter(
            (e) => !present.has(e.id) && !off.has(e.id),
          ).length,
          note: "Leave date overlaps include half-day/hourly requests and weekends. No clock record does not establish absence.",
        }
      : null,
    pendingByType: counts,
    oldestPendingDate: pending.length
      ? pending.map((r) => r.created_at).sort()[0]
      : null,
    publishedJobs: jobCounts,
    payrollRuns:
      hasPayroll(actor) && specialistAllows(company.settings, "payroll", "read")
        ? payrollRuns
        : null,
    sourceIds: records.map((r) => r.id),
  };
}
