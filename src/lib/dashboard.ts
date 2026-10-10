import { localDate } from "./calculations";
import { addCalendarDays, calendarEvents } from "./hr-calendar";
import { requestKinds, reviewOptions } from "./request-workflow";
import { isStaff, type Workspace } from "./types";

export const dashboardWidgets = [
  {
    id: "workday",
    label: "My workday",
    detail: "Clock status and personal leave balance",
  },
  {
    id: "agenda",
    label: "This week",
    detail: "Shifts, holidays and approved time away",
  },
  {
    id: "requests",
    label: "Requests",
    detail: "Pending requests and review actions",
  },
  {
    id: "attendance",
    label: "Working today",
    detail: "The latest attendance for each person",
  },
  {
    id: "digest",
    label: "HR digest",
    detail: "Due work and upcoming follow-ups",
  },
  {
    id: "activity",
    label: "Attendance activity",
    detail: "Daily attendance across the last seven days",
  },
  {
    id: "request-mix",
    label: "Request breakdown",
    detail: "Pending requests grouped by type",
  },
  { id: "goals", label: "Goals", detail: "Progress on your available goals" },
] as const;
export type DashboardWidget = (typeof dashboardWidgets)[number]["id"];
export function parseHiddenWidgets(value: string | null): DashboardWidget[] {
  try {
    const parsed: unknown = JSON.parse(value || "[]");
    return Array.isArray(parsed)
      ? dashboardWidgets.filter((w) => parsed.includes(w.id)).map((w) => w.id)
      : [];
  } catch {
    return [];
  }
}
export function pendingDashboardRequests(workspace: Workspace) {
  const { actor } = workspace;
  const records = workspace.records.filter(
    (r) => r.company_id === actor.companyId,
  );
  return records.filter(
    (r) =>
      [...requestKinds, "profile_change"].includes(r.kind) &&
      r.data.status === "Pending" &&
      ((!!actor.employeeId && r.employee_id === actor.employeeId) ||
        (r.kind === "profile_change" && r.data.submittedBy === actor.userId) ||
        reviewOptions(actor, r, records).some((o) =>
          ["Approved", "Rejected", "Returned"].includes(o),
        )),
  );
}
/** Input is the server-authorized workspace; never fetch broader records for widgets. */
export function dashboardSnapshot(workspace: Workspace, now = new Date()) {
  const { actor, company } = workspace;
  if (company.id !== actor.companyId)
    throw new Error("Dashboard workspace does not match this account");
  const records = workspace.records.filter(
    (r) => r.company_id === actor.companyId,
  );
  const today = localDate(now, company.settings.timezone);
  const employees = records.filter(
    (r) => r.kind === "employee" && r.data.status !== "Archived",
  );
  const attendance = records.filter((r) => r.kind === "attendance");
  const active = attendance.filter((r) => !r.data.clockOut && r.employee_id);
  const latest = new Map<string, (typeof records)[number]>();
  for (const r of [...attendance].sort((a, b) =>
    String(b.data.clockIn).localeCompare(String(a.data.clockIn)),
  )) {
    if (
      r.employee_id &&
      (r.data.workDate === today || !r.data.clockOut) &&
      !latest.has(r.employee_id)
    )
      latest.set(r.employee_id, r);
  }
  const events = calendarEvents(
    actor,
    company,
    records,
    today,
    addCalendarDays(today, 6),
    isStaff(actor) || actor.role === "manager" ? "team" : "mine",
  );
  return {
    today,
    records,
    employees,
    events,
    pending: pendingDashboardRequests(workspace),
    attendance: [...latest.values()],
    clockedIn: new Set(active.map((r) => r.employee_id)).size,
    away: new Set(
      events
        .filter(
          (e) => e.date === today && ["leave", "time_off"].includes(e.kind),
        )
        .map((e) => e.employeeId),
    ).size,
    open: active.find((r) => r.employee_id === actor.employeeId),
    own: employees.find((r) => r.id === actor.employeeId),
    jobs: records.filter(
      (r) => r.kind === "job" && r.data.status === "Published",
    ),
    goals: records.filter(
      (r) => r.kind === "goal" && r.data.status !== "Completed",
    ),
  };
}
export function goalPercent(progress: unknown, target: unknown) {
  const p = Number(progress),
    t = Number(target);
  return Number.isFinite(p) && Number.isFinite(t) && t > 0
    ? Math.round(Math.min(100, Math.max(0, (p / t) * 100)))
    : 0;
}

/** Count a person once per work date, even when they clock in more than once. */
export function dashboardAnalytics(
  snapshot: ReturnType<typeof dashboardSnapshot>,
) {
  const days = Array.from({ length: 7 }, (_, i) => ({
    date: addCalendarDays(snapshot.today, i - 6),
    people: new Set<string>(),
  }));
  const byDate = new Map(days.map((day) => [day.date, day.people]));
  for (const record of snapshot.records) {
    if (
      record.kind !== "attendance" ||
      !record.employee_id ||
      !Number.isFinite(Date.parse(String(record.data.clockIn || "")))
    )
      continue;
    byDate.get(String(record.data.workDate))?.add(record.employee_id);
  }
  const categories = [
    { id: "leave", label: "Leave", kinds: ["leave"], tone: "blue" },
    { id: "claims", label: "Claims", kinds: ["claim"], tone: "amber" },
    {
      id: "time",
      label: "Time requests",
      kinds: ["overtime", "time_off", "attendance_correction", "lateness"],
      tone: "teal",
    },
    {
      id: "profile",
      label: "Profile changes",
      kinds: ["profile_change"],
      tone: "violet",
    },
    {
      id: "goals",
      label: "Goal updates",
      kinds: ["goal_update"],
      tone: "rose",
    },
  ];
  const requests = categories.map(({ kinds, ...category }) => ({
    ...category,
    count: snapshot.pending.filter((record) => kinds.includes(record.kind))
      .length,
  }));
  return {
    attendance: days.map(({ date, people }) => ({ date, count: people.size })),
    requests,
    totalRequests: snapshot.pending.length,
  };
}
