import { describe, expect, it } from "vitest";
import { directoryPeople, reportingGroups } from "@/lib/people-directory";
import { personalWorkday, elapsedWork } from "@/lib/personal-workday";
import { readAIEvents, visibleAIText } from "@/lib/ai-stream";
import { defaultSettings } from "@/lib/auth";
import type { HRRecord, Workspace } from "@/lib/types";
const record = (
  id: string,
  kind: HRRecord["kind"],
  data: HRRecord["data"],
  employee_id: string | null = null,
): HRRecord => ({
  id,
  kind,
  data,
  employee_id,
  company_id: "company",
  created_at: "2026-10-10",
  updated_at: "2026-10-10",
});
const filters = {
  search: "",
  department: "",
  status: "",
  employment: "",
  sort: "name-asc",
};
describe("People directory", () => {
  const employees = [
    record("a", "employee", {
      name: "Zara",
      departmentId: "d",
      employmentStatus: "Probation",
      employmentType: "Full-time",
      salary: 99999,
    }),
    record("b", "employee", {
      name: "Amnan",
      status: "Active",
      employmentType: "Contract",
    }),
  ];
  const departments = [record("d", "department", { name: "Design" })];
  it("combines filters and searches department display names without private pay fields", () => {
    expect(
      directoryPeople(employees, departments, {
        ...filters,
        search: "design",
        status: "Probation",
        employment: "Full-time",
      }).map((r) => r.id),
    ).toEqual(["a"]);
    expect(
      directoryPeople(employees, departments, { ...filters, search: "99999" }),
    ).toEqual([]);
    expect(
      directoryPeople(employees, departments, {
        ...filters,
        department: "unassigned",
      }).map((r) => r.id),
    ).toEqual(["b"]);
  });
  it("sorts without mutating workspace record order", () => {
    expect(
      directoryPeople(employees, departments, filters).map((r) => r.id),
    ).toEqual(["b", "a"]);
    expect(
      directoryPeople(employees, departments, {
        ...filters,
        sort: "name-desc",
      }).map((r) => r.id),
    ).toEqual(["a", "b"]);
    expect(employees.map((r) => r.id)).toEqual(["a", "b"]);
  });
  it("handles circular, missing and self managers without recursion or archived employees", () => {
    const groups = reportingGroups([
      record("a", "employee", { managerId: "b" }),
      record("b", "employee", { managerId: "a" }),
      record("c", "employee", { managerId: "c" }),
      record("d", "employee", { managerId: "unknown" }),
      record("e", "employee", { status: "Archived" }),
    ]);
    expect(groups.flatMap((g) => g.reports.map((r) => r.id)).sort()).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(
      groups.find((g) => g.id === "unassigned")?.reports.map((r) => r.id),
    ).toEqual(["c", "d"]);
  });
});
describe("Personal workday", () => {
  it("keeps money and recent requests personal; scopes holiday and publication data", () => {
    const workspace = {
      actor: { companyId: "company", employeeId: "me" },
      company: { settings: { ...defaultSettings, holidays: ["2026-10-14"] } },
      records: [
        record("me", "employee", { state: "Selangor" }),
        record("claim", "claim", { amount: 120, status: "Pending" }, "me"),
        record("other", "claim", { amount: 900, status: "Pending" }, "other"),
        {
          ...record(
            "foreign",
            "claim",
            { amount: 1000, status: "Pending" },
            "me",
          ),
          company_id: "foreign",
        },
        record("local", "holiday", {
          state: "Selangor",
          title: "State holiday",
          date: "2026-10-12",
        }),
        record("wrong-state", "holiday", {
          state: "Sabah",
          date: "2026-10-11",
        }),
        record("draft", "announcement", { published: false, title: "Draft" }),
        record("expired", "announcement", {
          published: true,
          expiresOn: "2026-10-10",
        }),
        record("live", "announcement", { published: true, title: "Team news" }),
      ],
    } as Workspace;
    const result = personalWorkday(workspace, "2026-10-11");
    expect(result.pendingAmount).toBe(120);
    expect(result.recent.map((r) => r.id)).toEqual(["claim"]);
    expect(result.holiday).toEqual({
      date: "2026-10-12",
      title: "State holiday",
      days: 1,
    });
    expect(result.announcement?.id).toBe("live");
  });
  it("handles an invalid or future clock time", () => {
    expect(elapsedWork("bad", 0)).toBeNull();
    expect(
      elapsedWork("2026-10-11T08:00:00Z", Date.parse("2026-10-11T10:03:00Z")),
    ).toBe("2h 03m");
    expect(elapsedWork("2026-10-11T08:00:00Z", 0)).toBe("0h 00m");
  });
});
describe("AI event stream", () => {
  it("withholds every partial protocol fence and preserves text after a complete action", () => {
    const protocol = '```hr-action\n{"amount":999}\n```';
    for (let n = 1; n < protocol.length; n++)
      expect(visibleAIText("Ready.\n" + protocol.slice(0, n))).toBe("Ready.");
    expect(visibleAIText("Ready.\n" + protocol + "\nConfirm below.")).toBe(
      "Ready.\n\nConfirm below.",
    );
    expect(
      visibleAIText('```resume-evidence\n[{"quote":"private"}]\n```'),
    ).toBe("");
  });
  it("decodes split UTF-8 and multiple events before the saved completion", async () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ type: "text", text: "Selamat — pagi" }) +
        "\n" +
        JSON.stringify({ type: "complete", result: { saved: true } }),
    );
    const stream = new ReadableStream({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });
    const events: unknown[] = [];
    await readAIEvents(new Response(stream), (e) => events.push(e));
    expect(events).toEqual([
      { type: "text", text: "Selamat — pagi" },
      { type: "complete", result: { saved: true } },
    ]);
  });
  it("rejects interrupted and failed streams instead of presenting unsaved answers as final", async () => {
    await expect(
      readAIEvents(
        new Response('{"type":"text","text":"Partial"}\n'),
        () => {},
      ),
    ).rejects.toThrow("before the answer was saved");
    await expect(
      readAIEvents(
        new Response('{"type":"error","message":"Retry safely"}\n'),
        () => {},
      ),
    ).rejects.toThrow("Retry safely");
  });
});
