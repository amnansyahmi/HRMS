import { describe, it, expect, vi, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { defaultSettings } from "@/lib/auth";
import { selectAIRoute } from "@/lib/ai-usage";
import { buildHRDigest } from "@/lib/hr-digest";
import { checkPayrollDrafts } from "@/lib/payroll-diagnostics";
import { payrollTotals } from "@/lib/calculations";
import type { Actor, Company, HRRecord, Kind } from "@/lib/types";
const actor: Actor = {
  companyId: randomUUID(),
  userId: randomUUID(),
  employeeId: randomUUID(),
  role: "employee",
  name: "Employee",
  email: "e@example.test",
};
const company: Company = {
  id: actor.companyId,
  name: "Workspace",
  slug: "workspace",
  settings: defaultSettings,
};
const record = (
  kind: Kind,
  data: Record<string, unknown>,
  employeeId: string | null = actor.employeeId,
): HRRecord => ({
  id: randomUUID(),
  company_id: company.id,
  kind,
  employee_id: employeeId,
  data,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
});
afterEach(() => vi.unstubAllEnvs());
describe("server-owned AI routes", () => {
  it("routes analysis and image attachments through explicit owner models", () => {
    vi.stubEnv("AI_NONYMAUZ_MODEL", "default");
    const settings = {
      ...defaultSettings,
      aiRouting: {
        generalModel: "fast",
        analysisModel: "deep",
        visionModel: "vision",
        monthlyRequestLimit: 10,
      },
    };
    expect(selectAIRoute(settings, "hr")).toEqual({
      model: "fast",
      mode: "normal",
    });
    expect(selectAIRoute(settings, "hr", true)).toEqual({
      model: "deep",
      mode: "deep",
    });
    expect(selectAIRoute(settings, "recruitment")).toEqual({
      model: "deep",
      mode: "deep",
    });
    expect(selectAIRoute(settings, "hr", true, true)).toEqual({
      model: "vision",
      mode: "vision",
    });
    expect(() => selectAIRoute(defaultSettings, "hr", false, true)).toThrow(
      "vision model",
    );
  });
});
describe("authorized HR digest", () => {
  it("includes actual meeting actions but omits another employee's dates", () => {
    const own = record("employee", { name: "Me", status: "Active" });
    own.id = actor.employeeId!;
    const other = record("employee", {
      name: "Other",
      status: "Active",
      endDate: "2026-10-10",
    });
    const meeting = record("meeting", {
      title: "Own follow-up",
      actions: [
        { task: "Follow up", done: false, dueDate: "2026-10-08" },
        { task: "Done", done: true, dueDate: "2026-10-01" },
      ],
    });
    const foreign = record("document", {
      title: "Foreign",
      expiryDate: "2026-10-10",
    });
    foreign.company_id = randomUUID();
    const result = buildHRDigest(
      actor,
      company,
      [own, other, meeting, foreign],
      new Date("2026-10-09T04:00:00Z"),
    );
    expect(result.items.map((i) => i.title)).toEqual(["Own follow-up"]);
    expect(result.items[0].detail).toBe("1 overdue follow-ups");
  });
});
describe("deterministic payroll review", () => {
  it("flags changed earnings, duplicate allocations and stale totals without changing records", () => {
    const earnings = {
      base: 4000,
      allowance: 0,
      overtime: 0,
      bonus: 0,
      commission: 0,
      epf: 0,
      socso: 0,
      eis: 0,
      pcb: 0,
      otherDeduction: 0,
      unpaidDeduction: 0,
      zakat: 0,
      reimbursements: 0,
    };
    const claim = record("claim", { amount: 30 });
    const draft = record("payroll", {
      ...earnings,
      ...payrollTotals(earnings),
      status: "Draft",
      period: "2026-10",
      reviewed: true,
      inputRecordIds: [claim.id],
    });
    const duplicate = record("payroll", { ...draft.data, gross: 4001 });
    const prior = record("payroll", {
      ...draft.data,
      period: "2026-09",
      status: "Published",
      gross: 2000,
    });
    const bank = record("employee", { name: "Me", bankAccount: "123" });
    bank.id = actor.employeeId!;
    const original = JSON.stringify([draft, duplicate]);
    const findings = checkPayrollDrafts(
      [draft, duplicate],
      [bank, claim, prior],
    ).findings;
    expect(findings.map((f) => f.code)).toEqual(
      expect.arrayContaining(["variance", "totals", "duplicate-input"]),
    );
    expect(JSON.stringify([draft, duplicate])).toBe(original);
  });
});
