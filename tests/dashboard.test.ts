import { describe, expect, it } from "vitest";
import { defaultSettings } from "@/lib/auth";
import {
  dashboardSnapshot,
  dashboardAnalytics,
  goalPercent,
  parseHiddenWidgets,
  pendingDashboardRequests,
} from "@/lib/dashboard";
import type { HRRecord, Workspace } from "@/lib/types";

const record = (
  id: string,
  kind: HRRecord["kind"],
  data: HRRecord["data"],
  employee_id: string | null = "me",
): HRRecord => ({
  id,
  kind,
  data,
  employee_id,
  company_id: "company",
  created_at: "2026-10-01",
  updated_at: "2026-10-01",
});
const workspace: Workspace = {
  actor: {
    companyId: "company",
    userId: "user",
    employeeId: "me",
    role: "employee",
    name: "Me",
    email: "me@example.test",
  },
  company: {
    id: "company",
    name: "Company",
    slug: "company",
    settings: { ...defaultSettings, timezone: "Asia/Kuala_Lumpur" },
  },
  companies: [],
  members: [],
  audit: [],
  records: [],
  notifications: [],
  ai: { configured: false, enabled: false, model: "" },
  demo: true,
  truncated: false,
  nextCursor: null,
};
const own = record("me", "employee", {
  name: "Me",
  status: "Active",
  state: "Selangor",
});
describe("authorized dashboard", () => {
  it("uses company dates, deduplicates sessions and includes an overnight open clock", () => {
    const morning = record("morning", "attendance", {
      workDate: "2026-10-10",
      clockIn: "2026-10-10T00:00:00Z",
      clockOut: "2026-10-10T01:00:00Z",
    });
    const current = record("current", "attendance", {
      workDate: "2026-10-10",
      clockIn: "2026-10-10T01:05:00Z",
      clockOut: null,
    });
    const night = record(
      "night",
      "attendance",
      {
        workDate: "2026-10-09",
        clockIn: "2026-10-09T15:00:00Z",
        clockOut: null,
      },
      "night-worker",
    );
    const foreign = {
      ...record(
        "foreign",
        "attendance",
        { workDate: "2026-10-10", clockOut: null },
        "foreign",
      ),
      company_id: "other",
    };
    const result = dashboardSnapshot(
      { ...workspace, records: [own, morning, current, night, foreign] },
      new Date("2026-10-09T23:00:00Z"),
    );
    expect(result.today).toBe("2026-10-10");
    expect(result.attendance.map((r) => r.id)).toEqual(["current", "night"]);
    expect(result.clockedIn).toBe(2);
    expect(result.open?.id).toBe("current");
    expect(result.records).not.toContain(foreign);
  });
  it("narrows agenda to the employee and never includes private leave explanations", () => {
    const other = record("other-person", "employee", {
      name: "Other",
      status: "Active",
    });
    const leave = record("leave", "leave", {
      startDate: "2026-10-12",
      endDate: "2026-10-13",
      status: "Approved",
      reason: "PRIVATE MEDICAL REASON",
      receipt: "PRIVATE FILE",
    });
    const pending = record("pending", "leave", {
      startDate: "2026-10-12",
      endDate: "2026-10-12",
      status: "Pending",
    });
    const otherLeave = { ...leave, id: "other-leave", employee_id: other.id };
    const result = dashboardSnapshot(
      { ...workspace, records: [own, other, leave, pending, otherLeave] },
      new Date("2026-10-12T01:00:00Z"),
    );
    expect(result.away).toBe(1);
    expect(result.events.map((e) => e.recordId)).toEqual(["leave", "leave"]);
    expect(JSON.stringify(result.events)).not.toContain("PRIVATE");
    expect(result.pending.map((r) => r.id)).toEqual(["pending"]);
    expect(() =>
      dashboardSnapshot({
        ...workspace,
        company: { ...workspace.company, id: "wrong" },
      }),
    ).toThrow("does not match");
  });
  it("counts own requests and only the manager's actionable team requests", () => {
    const manager = { ...workspace.actor, role: "manager" as const };
    const team = record("team", "employee", {
      managerId: "me",
      email: "team@example.test",
    });
    const other = record("other", "employee", {
      managerId: "someone-else",
      email: "other@example.test",
    });
    const pending = (id: string, employee: string) =>
      record(id, "leave", { status: "Pending" }, employee);
    const records = [
      own,
      team,
      other,
      pending("own", "me"),
      pending("team-request", "team"),
      pending("other-request", "other"),
    ];
    expect(
      pendingDashboardRequests({ ...workspace, actor: manager, records }).map(
        (r) => r.id,
      ),
    ).toEqual(["own", "team-request"]);
    expect(
      pendingDashboardRequests({ ...workspace, records }).map((r) => r.id),
    ).toEqual(["own"]);
  });
  it("includes an unlinked account's own profile request without treating all null employees as its own", () => {
    const actor = { ...workspace.actor, employeeId: null };
    const ownRequest = record(
      "own-profile",
      "profile_change",
      { status: "Pending", submittedBy: actor.userId },
      null,
    );
    const otherRequest = record(
      "other-profile",
      "profile_change",
      { status: "Pending", submittedBy: "someone-else" },
      null,
    );
    expect(
      pendingDashboardRequests({
        ...workspace,
        actor,
        records: [ownRequest, otherRequest],
      }).map((r) => r.id),
    ).toEqual(["own-profile"]);
  });
  it("bounds goal progress and accepts only known widget preferences", () => {
    expect(goalPercent(10, 0)).toBe(0);
    expect(goalPercent(Infinity, 10)).toBe(0);
    expect(goalPercent(-10, 100)).toBe(0);
    expect(goalPercent(150, 100)).toBe(100);
    expect(goalPercent(1, 3)).toBe(33);
    expect(parseHiddenWidgets('["goals","unknown","goals","agenda"]')).toEqual([
      "agenda",
      "goals",
    ]);
    expect(parseHiddenWidgets('{"agenda":true}')).toEqual([]);
    expect(parseHiddenWidgets("bad JSON")).toEqual([]);
  });
});

describe("dashboard charts", () => {
  it("counts person-days, drops malformed and out-of-period clocks and stays company-scoped", () => {
    const clock = (id: string, date: string, employee = "me") =>
      record(
        id,
        "attendance",
        { workDate: date, clockIn: `${date}T01:00:00Z` },
        employee,
      );
    const snapshot = dashboardSnapshot(
      {
        ...workspace,
        records: [
          clock("first", "2026-10-10"),
          clock("repeat", "2026-10-10"),
          clock("teammate", "2026-10-10", "team"),
          clock("yesterday", "2026-10-09"),
          clock("old", "2026-10-03"),
          clock("future", "2026-10-11"),
          { ...clock("foreign", "2026-10-10", "foreign"), company_id: "other" },
          {
            ...clock("invalid", "2026-10-10", "invalid"),
            data: { workDate: "2026-10-10", clockIn: "invalid" },
          },
          { ...clock("unlinked", "2026-10-10"), employee_id: null },
        ],
      },
      new Date("2026-10-10T02:00:00Z"),
    );
    expect(dashboardAnalytics(snapshot).attendance).toEqual([
      { date: "2026-10-04", count: 0 },
      { date: "2026-10-05", count: 0 },
      { date: "2026-10-06", count: 0 },
      { date: "2026-10-07", count: 0 },
      { date: "2026-10-08", count: 0 },
      { date: "2026-10-09", count: 1 },
      { date: "2026-10-10", count: 2 },
    ]);
  });
  it("groups every request type and excludes requests outside own or actionable scope", () => {
    const kinds = [
      "leave",
      "claim",
      "overtime",
      "time_off",
      "attendance_correction",
      "lateness",
      "goal_update",
      "profile_change",
    ] as const;
    const snapshot = dashboardSnapshot(
      {
        ...workspace,
        records: [
          ...kinds.map((kind) =>
            record(kind, kind, { status: "Pending", submittedBy: "user" }),
          ),
          record("approved", "leave", { status: "Approved" }),
          record("other-person", "claim", { status: "Pending" }, "other"),
        ],
      },
      new Date("2026-10-10T02:00:00Z"),
    );
    const analytics = dashboardAnalytics(snapshot);
    expect(analytics.totalRequests).toBe(8);
    expect(analytics.requests.map((category) => category.count)).toEqual([
      1, 1, 4, 1, 1,
    ]);
    expect(
      analytics.requests.reduce((sum, category) => sum + category.count, 0),
    ).toBe(analytics.totalRequests);
  });
  it("returns a zero-filled seven-day series and zero request categories for an empty workspace", () => {
    const result = dashboardAnalytics(
      dashboardSnapshot(workspace, new Date("2026-10-10T02:00:00Z")),
    );
    expect(result.attendance).toHaveLength(7);
    expect(result.attendance.every((day) => day.count === 0)).toBe(true);
    expect(result.requests.every((category) => category.count === 0)).toBe(
      true,
    );
    expect(result.totalRequests).toBe(0);
  });
});
