import { describe, expect, it } from "vitest";
import { defaultSettings } from "@/lib/auth";
import {
  dashboardSnapshot,
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
