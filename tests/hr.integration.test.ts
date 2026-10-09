import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined),
    set: (k: string, v: string) => jar.set(k, v),
    delete: (k: string) => jar.delete(k),
  }),
}));
import {
  signup,
  getActor,
  defaultSettings,
  createInvite,
  acceptInvite,
  assertOrigin,
  rateLimit,
  hashToken,
  createSession,
} from "@/lib/auth";
import { db, connection } from "@/lib/db";
import {
  createRecord,
  updateRecord,
  visibleRecords,
  reviewRequest,
  generatePayroll,
  publishPayroll,
  clock,
  recordById,
} from "@/lib/hr";
import {
  careers,
  applyToJob,
  inviteAssessment,
  publicAssessment,
  submitAssessment,
} from "@/lib/recruitment";
import { uploadFile, downloadFile } from "@/lib/files";
import { askAI, aiHistory } from "@/lib/ai";
import {
  workingDays,
  payrollTotals,
  csv,
  assignedShift,
} from "@/lib/calculations";
import { demoEnabled } from "@/lib/auth";
import type { Actor, HRRecord } from "@/lib/types";
let employeeUserId: string;
let owner: Actor,
  other: Actor,
  employee: HRRecord,
  colleague: HRRecord,
  staffEmployee: HRRecord,
  managerEmployee: HRRecord,
  job: HRRecord,
  dir: string;
const empData = (
  name: string,
  email: string,
  managerId: string | null = null,
) => ({
  name,
  email,
  title: "Engineer",
  departmentId: null,
  managerId,
  startDate: "2026-01-01",
  endDate: null,
  employmentType: "Full-time",
  status: "Active",
  salary: 4000,
  annualLeave: 14,
  sickLeave: 14,
  phone: "",
});
const leaveData = (startDate: string, endDate = startDate) => ({
  type: "Annual",
  startDate,
  endDate,
  reason: "Personal time",
});
const employeeActor = (): Actor => ({
  ...owner,
  userId: employeeUserId || owner.userId,
  role: "employee",
  employeeId: employee.id,
  email: String(employee.data.email),
});
const managerActor = (): Actor => ({
  ...owner,
  role: "manager",
  employeeId: managerEmployee.id,
  email: String(managerEmployee.data.email),
});
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "hrms-test-"));
  process.env.HRMS_DATA_DIR = dir;
  delete process.env.DATABASE_URL;
  process.env.APP_URL = "http://localhost:3000";
  await signup({
    name: "Test Owner",
    email: "owner@example.test",
    password: "test-password-123",
    company: "First Company",
  });
  owner = await getActor();
  await signup({
    name: "Other Owner",
    email: "other@example.test",
    password: "test-password-123",
    company: "Other Company",
  });
  other = await getActor();
  managerEmployee = await createRecord(owner, "employee", {
    data: empData("Manager", "manager@example.test"),
  });
  employee = await createRecord(owner, "employee", {
    data: empData("Employee", "employee@example.test", managerEmployee.id),
  });
  colleague = await createRecord(owner, "employee", {
    data: empData("Colleague", "colleague@example.test"),
  });
  staffEmployee = await createRecord(owner, "employee", {
    data: empData("Test Owner", owner.email),
  });
  job = await createRecord(owner, "job", {
    data: {
      title: "Frontend Engineer",
      departmentId: null,
      location: "KL",
      employmentType: "Full-time",
      description: "Build accessible React interfaces for customers.",
      requirements: "React, TypeScript and testing",
      status: "Published",
    },
  });
}, 30000);
afterAll(async () => {
  vi.unstubAllGlobals();
  const conn = await connection();
  if ("end" in conn) await conn.end();
  else await conn.close();
  await rm(dir, { recursive: true, force: true });
});
describe("identity and isolation", () => {
  it("stores hashed sessions and resolves company membership", async () => {
    await createSession(owner.userId, owner.companyId);
    expect((await getActor()).companyId).toBe(owner.companyId);
    const sessions = await db.query<{ token_hash: string }>(
      "SELECT token_hash FROM sessions",
    );
    expect(sessions.rows.every((s) => s.token_hash.length === 64)).toBe(true);
  });
  it("rejects cross-company record IDs and attachments", async () => {
    await expect(
      recordById(other, employee.id, "employee"),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      createRecord(other, "employee", {
        data: {
          ...empData("Invalid", "invalid@example.test"),
          managerId: managerEmployee.id,
        },
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("prevents employees from creating staff records", async () => {
    await expect(
      createRecord(employeeActor(), "employee", {
        data: empData("Bad", "bad@example.test"),
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("redacts another employee’s salary and contact details", async () => {
    const records = await visibleRecords(employeeActor());
    const profile = records.find((r) => r.id === colleague.id)!;
    expect(profile.data.salary).toBeUndefined();
    expect(profile.data.email).toBeUndefined();
    expect(records.find((r) => r.id === employee.id)?.data.salary).toBe(4000);
  });
  it("rejects missing and foreign mutation origins", () => {
    expect(() =>
      assertOrigin(new Request("http://localhost:3000/api/workspace")),
    ).toThrow();
    expect(() =>
      assertOrigin(
        new Request("http://localhost:3000/api/workspace", {
          headers: { origin: "https://evil.test" },
        }),
      ),
    ).toThrow();
    expect(() =>
      assertOrigin(
        new Request("http://localhost:3000/api/workspace", {
          headers: { origin: "http://localhost:3000" },
        }),
      ),
    ).not.toThrow();
  });
  it("enforces persistent request limits", async () => {
    const key = randomUUID();
    await rateLimit(key, 1, 900);
    await expect(rateLimit(key, 1, 900)).rejects.toMatchObject({ status: 429 });
  });
  it("makes invitations one-use and links the employee", async () => {
    const invitation = await createInvite(owner, {
      email: employee.data.email,
      role: "employee",
      employeeId: employee.id,
    });
    await acceptInvite({
      token: invitation.token,
      name: "Employee",
      password: "employee-password-123",
    });
    const actor = await getActor();
    employeeUserId = actor.userId;
    expect(actor.employeeId).toBe(employee.id);
    expect(actor.role).toBe("employee");
    await expect(
      acceptInvite({
        token: invitation.token,
        name: "Employee",
        password: "employee-password-123",
      }),
    ).rejects.toMatchObject({ status: 410 });
    const stored = (
      await db.query<{ token_hash: string }>(
        "SELECT token_hash FROM invites WHERE email=$1",
        [employee.data.email],
      )
    ).rows[0];
    expect(stored.token_hash).toBe(hashToken(invitation.token));
  });
  it("allows temporary one-click demo access until explicitly disabled", () => {
    const before = process.env.NODE_ENV;
    process.env.DEMO_MODE = "true";
    vi.stubEnv("NODE_ENV", "production");
    expect(demoEnabled()).toBe(true);
    vi.stubEnv("NODE_ENV", before || "test");
    process.env.VERCEL = "1";
    expect(demoEnabled()).toBe(true);
    process.env.DEMO_MODE = "false";
    expect(demoEnabled()).toBe(false);
    process.env.DEMO_MODE = "true";
    delete process.env.VERCEL;
  });
});
describe("leave and claim workflows", () => {
  it("excludes weekends and configured holidays", () => {
    expect(
      workingDays("2026-10-05", "2026-10-09", [1, 2, 3, 4, 5], ["2026-10-07"]),
    ).toBe(4);
  });
  it("ignores forged leave status and computed days", async () => {
    const request = await createRecord(owner, "leave", {
      employeeId: employee.id,
      data: { ...leaveData("2026-11-02"), status: "Approved", days: 99 },
    });
    expect(request.data.status).toBe("Pending");
    expect(request.data.days).toBe(1);
  });
  it("prevents overlaps and overdrawn balances including pending requests", async () => {
    await expect(
      createRecord(owner, "leave", {
        employeeId: employee.id,
        data: leaveData("2026-11-02"),
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      createRecord(owner, "leave", {
        employeeId: employee.id,
        data: leaveData("2026-12-01", "2026-12-31"),
      }),
    ).rejects.toThrow(/balance/);
  });
  it("serializes concurrent overlapping submissions", async () => {
    const result = await Promise.allSettled([
      createRecord(owner, "leave", {
        employeeId: colleague.id,
        data: leaveData("2026-11-10"),
      }),
      createRecord(owner, "leave", {
        employeeId: colleague.id,
        data: leaveData("2026-11-10"),
      }),
    ]);
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("allows a direct manager to approve once", async () => {
    const request = await createRecord(owner, "leave", {
      employeeId: employee.id,
      data: leaveData("2026-11-04"),
    });
    await reviewRequest(managerActor(), {
      id: request.id,
      decision: "Approved",
    });
    await expect(
      reviewRequest(managerActor(), { id: request.id, decision: "Approved" }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("blocks a manager from another team", async () => {
    const request = await createRecord(owner, "claim", {
      employeeId: colleague.id,
      data: {
        category: "Travel",
        date: "2026-10-08",
        amount: 50,
        description: "Workshop",
      },
    });
    await expect(
      reviewRequest(managerActor(), { id: request.id, decision: "Approved" }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("prevents self approval even when owner has no employee link", async () => {
    const request = await createRecord(owner, "claim", {
      employeeId: staffEmployee.id,
      data: {
        category: "Meals",
        date: "2026-10-08",
        amount: 12,
        description: "Client lunch",
      },
    });
    await expect(
      reviewRequest(owner, { id: request.id, decision: "Approved" }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("allows cancellation only by the request owner", async () => {
    const request = await createRecord(owner, "leave", {
      employeeId: employee.id,
      data: leaveData("2026-11-05"),
    });
    await expect(
      reviewRequest(owner, { id: request.id, decision: "Cancelled" }),
    ).rejects.toMatchObject({ status: 403 });
    await reviewRequest(employeeActor(), {
      id: request.id,
      decision: "Cancelled",
    });
    expect((await recordById(owner, request.id)).data.status).toBe("Cancelled");
  });
  it("records clock-in/out using server time and prevents duplicates", async () => {
    const actor = employeeActor();
    const record = await clock(actor, { action: "in", location: "Remote" });
    expect(record.data.clockOut).toBeNull();
    await expect(clock(actor, { action: "in" })).rejects.toMatchObject({
      status: 409,
    });
    const out = await clock(actor, { action: "out" });
    expect(out.data.clockOut).toBeTruthy();
    await expect(clock(actor, { action: "out" })).rejects.toMatchObject({
      status: 409,
    });
  });
});
describe("payroll integrity", () => {
  it("calculates amounts in integer cents and rejects net below zero", () => {
    expect(payrollTotals({ base: 0.1, allowance: 0.2, pcb: 0.1 })).toEqual({
      gross: 0.3,
      net: 0.2,
    });
    expect(() => payrollTotals({ base: 100, pcb: 101 })).toThrow();
  });
  it("prepares drafts idempotently and blocks unreviewed publication", async () => {
    expect((await generatePayroll(owner, { period: "2026-10" })).created).toBe(
      4,
    );
    expect((await generatePayroll(owner, { period: "2026-10" })).created).toBe(
      0,
    );
    await expect(publishPayroll(owner, { period: "2026-10" })).rejects.toThrow(
      /Review/,
    );
  });
  it("publishes reviewed snapshots and forbids subsequent editing", async () => {
    const drafts = (await visibleRecords(owner)).filter(
      (r) => r.kind === "payroll",
    );
    for (const draft of drafts)
      await updateRecord(owner, "payroll", draft.id, {
        updatedAt: draft.updated_at,
        data: {
          epfEmployee: 440,
          socsoEmployee: 20,
          eisEmployee: 7.9,
          pcb: 10,
          reviewed: true,
        },
      });
    await publishPayroll(owner, { period: "2026-10" });
    const published = (await visibleRecords(owner)).find(
      (r) => r.kind === "payroll",
    )!;
    await expect(
      updateRecord(owner, "payroll", published.id, {
        updatedAt: published.updated_at,
        data: { base: 1 },
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(published.data.net).toBe(3522.1);
  });
  it("reveals only the employee’s published payslips", async () => {
    const records = await visibleRecords(employeeActor());
    const payslips = records.filter((r) => r.kind === "payroll");
    expect(payslips).toHaveLength(1);
    expect(payslips[0].employee_id).toBe(employee.id);
  });
  it("rejects stale edits instead of overwriting another change", async () => {
    const changed = await updateRecord(owner, "employee", colleague.id, {
      updatedAt: colleague.updated_at,
      data: { title: "Senior Engineer" },
    });
    expect(changed.data.title).toBe("Senior Engineer");
    await expect(
      updateRecord(owner, "employee", colleague.id, {
        updatedAt: colleague.updated_at,
        data: { title: "Junior Engineer" },
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
describe("recruitment and private attachments", () => {
  it("exposes published jobs only", async () => {
    await createRecord(owner, "job", {
      data: { ...job.data, title: "Private role", status: "Draft" },
    });
    const company = (
      await db.query<{ slug: string }>(
        "SELECT slug FROM companies WHERE id=$1",
        [owner.companyId],
      )
    ).rows[0];
    const result = await careers(company.slug);
    expect(result.jobs).toHaveLength(1);
  });
  it("stores applications and scores a one-use assessment using a snapshot", async () => {
    const company = (
      await db.query<{ slug: string }>(
        "SELECT slug FROM companies WHERE id=$1",
        [owner.companyId],
      )
    ).rows[0];
    await applyToJob(company.slug, {
      name: "Candidate",
      email: "candidate@example.test",
      phone: "",
      jobId: job.id,
      resume:
        "Built React and TypeScript interfaces with accessible HTML and automated tests.",
      consent: true,
    });
    const candidate = (await visibleRecords(owner)).find(
      (r) => r.kind === "candidate",
    )!;
    const assessment = await createRecord(owner, "assessment", {
      data: {
        title: "Skills",
        type: "Skills",
        instructions: "Choose one",
        questions: [
          { prompt: "Correct choice?", options: ["A", "B"], correctIndex: 1 },
        ],
      },
    });
    const link = await inviteAssessment(owner, {
        assessmentId: assessment.id,
        candidateId: candidate.id,
      }),
      plain = link.url.split("/").pop()!;
    expect((await publicAssessment(plain)).questions[0]).not.toHaveProperty(
      "correctIndex",
    );
    await updateRecord(owner, "assessment", assessment.id, {
      updatedAt: assessment.updated_at,
      data: {
        questions: [
          { prompt: "Changed", options: ["A", "B"], correctIndex: 0 },
        ],
      },
    });
    expect((await submitAssessment(plain, { answers: [1] })).score).toBe(100);
    await expect(
      submitAssessment(plain, { answers: [1] }),
    ).rejects.toMatchObject({ status: 410 });
  });
  it("does not expose invite token hashes through staff views", async () => {
    const results = (await visibleRecords(owner)).filter(
      (r) => r.kind === "assessment_result",
    );
    expect(results[0].data.tokenHash).toBeUndefined();
  });
  it("requires applicant consent and rejects a closed job", async () => {
    const company = (
      await db.query<{ slug: string }>(
        "SELECT slug FROM companies WHERE id=$1",
        [owner.companyId],
      )
    ).rows[0];
    await expect(
      applyToJob(company.slug, {
        name: "No Consent",
        email: "no@example.test",
        jobId: job.id,
        resume: "Relevant skills and experience with software",
        consent: false,
      }),
    ).rejects.toThrow();
    const current = await recordById(owner, job.id, "job");
    await updateRecord(owner, "job", job.id, {
      updatedAt: current.updated_at,
      data: { status: "Closed" },
    });
    await expect(
      applyToJob(company.slug, {
        name: "Late",
        email: "late@example.test",
        jobId: job.id,
        resume: "Relevant skills and experience with software",
        consent: true,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("authorizes file downloads by company and record visibility", async () => {
    const file = await uploadFile(
      owner,
      new File(["Private receipt notes"], "receipt.txt", {
        type: "text/plain",
      }),
    );
    await expect(downloadFile(other, file.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(downloadFile(employeeActor(), file.id)).rejects.toMatchObject({
      status: 404,
    });
    expect(await (await downloadFile(owner, file.id)).text()).toBe(
      "Private receipt notes",
    );
  });
  it("neutralizes CSV spreadsheet formulas", () => {
    expect(csv([["=SUM(A1)", "Normal", "a,b"]])).toContain('"\'=SUM(A1)"');
  });
});
describe("AI integration boundary", () => {
  it("requires owner opt-in before sending HR data", async () => {
    await expect(
      askAI(owner, { message: "Who is on leave?" }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("uses the configured endpoint, bearer token, alias and disabled web tools", async () => {
    await db.query("UPDATE companies SET settings=$1 WHERE id=$2", [
      JSON.stringify({ ...defaultSettings, aiEnabled: true }),
      owner.companyId,
    ]);
    process.env.AI_NONYMAUZ_BASE_URL = "https://nonymauz.example/v1";
    process.env.AI_NONYMAUZ_API_KEY = "test-secret";
    process.env.AI_NONYMAUZ_MODEL = "test-alias";
    const mock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "chat-test",
            object: "chat.completion",
            created: 1,
            model: "test-alias",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: "Check your pending leave requests.",
                },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 8,
              total_tokens: 18,
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", mock);
    const reply = await askAI(owner, { message: "Who is on leave?" });
    expect(reply.text).toContain("pending");
    expect(reply.sources.length).toBeGreaterThan(0);
    const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe("https://nonymauz.example/v1/chat/completions");
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer test-secret",
    );
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("test-alias");
    expect(body.use_tools).toBe(false);
    expect(body.use_rag).toBe(false);
    expect(
      body.messages.some((m: { role: string }) => m.role === "system"),
    ).toBe(true);
    expect(await aiHistory(owner, reply.threadId)).toHaveLength(2);
    expect(await aiHistory(other, reply.threadId)).toHaveLength(0);
    vi.unstubAllGlobals();
  });
  it("does not grant employees recruitment assistants", async () => {
    await expect(
      askAI(employeeActor(), {
        message: "Review candidate",
        mode: "resume",
        recordId: job.id,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("handles upstream failure without storing a successful answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Unavailable", { status: 503 })),
    );
    await expect(
      askAI(owner, { message: "Help me with leave" }),
    ).rejects.toMatchObject({ status: 502 });
    vi.unstubAllGlobals();
  });
});

describe("shift occurrences", () => {
  it("assigns an after-midnight clock-in to the previous shift day", () => {
    const shift = {
      id: "night",
      data: { start: "22:00", end: "06:00", days: [3], graceMinutes: 5 },
    };
    expect(
      assignedShift(new Date("2026-10-07T16:30:00Z"), "Asia/Kuala_Lumpur", [
        shift,
      ]),
    ).toEqual({ id: "night", workDate: "2026-10-07", lateMinutes: 145 });
    expect(
      assignedShift(new Date("2026-10-07T13:55:00Z"), "Asia/Kuala_Lumpur", [
        shift,
      ])?.lateMinutes,
    ).toBe(0);
    expect(
      assignedShift(new Date("2026-10-08T01:00:00Z"), "Asia/Kuala_Lumpur", [
        shift,
      ]),
    ).toBeNull();
  });
});

// Expanded workflows use new profiles so each test has independent balances.
import { operation, onboarding, saveOnboarding } from "@/lib/operations";
import { recordPage } from "@/lib/hr";
import { payrollInputs } from "@/lib/payroll-inputs";
import { maintenance } from "@/lib/maintenance";
import {
  setupMFA,
  enableMFA,
  checkMFA,
  requestAccountToken,
  consumeAccountToken,
} from "@/lib/account";
import { saveAIProposal, confirmAIProposal } from "@/lib/ai-actions";
import {
  uploadAudioPart,
  audioResponse,
  transcribeMeeting,
  finishTranscription,
} from "@/lib/media";
const freshEmployee = (extra: Record<string, unknown> = {}) =>
  createRecord(owner, "employee", {
    data: {
      ...empData(
        "Workflow Person",
        `${randomUUID()}@example.test`,
        managerEmployee.id,
      ),
      ...extra,
    },
  });
const asEmployee = (e: HRRecord): Actor => ({
  ...employeeActor(),
  employeeId: e.id,
  email: String(e.data.email),
});
const expense = (date = "2026-09-15", extra: Record<string, unknown> = {}) => ({
  category: "Travel",
  date,
  amount: 30,
  description: "Client trip",
  ...extra,
});

describe("expanded HR workflows", () => {
  it("automatically prepares hashed employee invitations without granting elevated access", async () => {
    const e = await freshEmployee();
    const row = (
      await db.query<{ role: string; token_hash: string }>(
        "SELECT role,token_hash FROM invites WHERE employee_id=$1",
        [e.id],
      )
    ).rows[0];
    expect(row.role).toBe("employee");
    expect(row.token_hash).toHaveLength(64);
    const invitation = (e as HRRecord & { invitationUrl: string })
      .invitationUrl;
    expect(row.token_hash).toBe(hashToken(invitation.split("/").at(-1)!));
  });
  it("computes mileage and enforces monthly limits across concurrent requests", async () => {
    const e = await freshEmployee(),
      actor = asEmployee(e);
    const p = await createRecord(owner, "claim_type", {
      data: {
        name: "Mileage",
        limit: 100,
        period: "Monthly",
        receiptRequired: false,
        mileageRate: 0.5,
      },
    });
    const requests = await Promise.allSettled(
      [1, 2].map(() =>
        createRecord(actor, "claim", {
          data: expense("2026-09-15", {
            claimTypeId: p.id,
            mileageKm: 120,
            amount: 1,
          }),
        }),
      ),
    );
    expect(requests.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const claim = requests.find(
      (r) => r.status === "fulfilled",
    ) as PromiseFulfilledResult<HRRecord>;
    expect(claim.value.data.amount).toBe(60);
    await expect(
      reviewRequest(actor, { id: claim.value.id, decision: "Approved" }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("requires reporting-manager approval before the HR step", async () => {
    const e = await freshEmployee(),
      p = await createRecord(owner, "claim_type", {
        data: {
          name: "Two steps",
          limit: 100,
          period: "Per request",
          receiptRequired: false,
          approval: "Manager then HR",
        },
      });
    const claim = await createRecord(asEmployee(e), "claim", {
      data: expense("2026-09-15", { claimTypeId: p.id }),
    });
    await expect(
      reviewRequest(owner, { id: claim.id, decision: "Approved" }),
    ).rejects.toMatchObject({ status: 403 });
    await reviewRequest(managerActor(), { id: claim.id, decision: "Approved" });
    expect((await recordById(owner, claim.id)).data).toMatchObject({
      status: "Pending",
      approvalStep: 1,
    });
    await expect(
      reviewRequest(managerActor(), { id: claim.id, decision: "Approved" }),
    ).rejects.toMatchObject({ status: 403 });
    await reviewRequest(owner, { id: claim.id, decision: "Approved" });
    expect((await recordById(owner, claim.id)).data.status).toBe("Approved");
  });
  it("permits complementary half-days and rejects overlapping hourly leave", async () => {
    const e = await freshEmployee(),
      actor = asEmployee(e);
    const morning = await createRecord(actor, "leave", {
      data: { ...leaveData("2026-11-16"), unit: "Morning" },
    });
    expect(morning.data.days).toBe(0.5);
    await expect(
      createRecord(actor, "leave", {
        data: {
          ...leaveData("2026-11-16"),
          unit: "Hours",
          startHour: 11,
          hours: 1,
        },
      }),
    ).rejects.toMatchObject({ status: 409 });
    const afternoon = await createRecord(actor, "leave", {
      data: { ...leaveData("2026-11-16"), unit: "Afternoon" },
    });
    expect(afternoon.data.days).toBe(0.5);
  });
  it("uses state holidays and carries unused leave only until the policy deadline", async () => {
    const e = await freshEmployee({
        state: "Selangor",
        startDate: "2025-01-01",
      }),
      actor = asEmployee(e);
    await createRecord(owner, "holiday", {
      data: {
        title: "Configured state holiday",
        date: "2026-11-17",
        state: "Selangor",
      },
    });
    await expect(
      createRecord(actor, "leave", { data: leaveData("2026-11-17") }),
    ).rejects.toThrow("no working days");
    const p = await createRecord(owner, "leave_type", {
      data: {
        name: "Carried leave",
        annualDays: 1,
        carryDays: 2,
        carryExpiryMonth: 3,
      },
    });
    const leave = await createRecord(actor, "leave", {
      data: { ...leaveData("2026-02-02", "2026-02-03"), leaveTypeId: p.id },
    });
    expect(leave.data.days).toBe(2);
    await expect(
      createRecord(actor, "leave", {
        data: { ...leaveData("2026-04-06"), leaveTypeId: p.id },
      }),
    ).rejects.toThrow("Insufficient");
  });
  it("requires onboarding documents and applies only reviewed personal fields", async () => {
    const e = await freshEmployee(),
      link = (await operation(owner, "onboarding-link", {
        employeeId: e.id,
        data: { requiredDocuments: ["Identity"] },
      })) as { url: string };
    const plain = link.url.split("/").at(-1)!;
    const proposed = {
      phone: "0123456789",
      emergencyName: "Contact",
      emergencyPhone: "0120000000",
      salary: 99999,
      role: "owner",
    };
    await expect(
      saveOnboarding(plain, { data: proposed, submit: true }),
    ).rejects.toThrow("required document");
    await saveOnboarding(
      plain,
      { data: proposed },
      new File(["Employee identity document"], "identity.txt", {
        type: "text/plain",
      }),
      "Identity",
    );
    await saveOnboarding(plain, { data: proposed, submit: true });
    expect((await recordById(owner, e.id)).data.phone).toBe("");
    const row = (
      await db.query<{ id: string; proposed_data: Record<string, unknown> }>(
        "SELECT id,proposed_data FROM onboarding_links WHERE employee_id=$1",
        [e.id],
      )
    ).rows[0];
    expect(row.proposed_data.salary).toBeUndefined();
    const fileId = (row.proposed_data.documents as { fileId: string }[])[0]
      .fileId;
    await expect(downloadFile(other, fileId)).rejects.toMatchObject({
      status: 404,
    });
    await operation(owner, "onboarding-review", {
      id: row.id,
      data: { decision: "Approved" },
    });
    expect((await recordById(owner, e.id)).data).toMatchObject({
      phone: "0123456789",
      salary: 4000,
    });
    await expect(onboarding(plain)).rejects.toMatchObject({ status: 410 });
  });
  it("rolls back a bad employee-import batch atomically", async () => {
    const email = `${randomUUID()}@example.test`;
    await expect(
      operation(owner, "employees-import", {
        data: { rows: [empData("First", email), empData("Duplicate", email)] },
      }),
    ).rejects.toThrow();
    expect(
      (
        await db.query(
          "SELECT id FROM hr_records WHERE company_id=$1 AND kind='employee' AND data->>'email'=$2",
          [owner.companyId, email],
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("keeps equipment returns and letter issuance inside their workflows", async () => {
    const e = await freshEmployee(),
      asset = await createRecord(owner, "asset", {
        employeeId: e.id,
        data: { name: "Laptop", serial: "TEST123", issuedDate: "2026-09-01" },
      });
    const checklist = await createRecord(owner, "lifecycle", {
      employeeId: e.id,
      data: {
        title: "Exit",
        type: "Offboarding",
        dueDate: "2026-10-30",
        status: "Completed",
        items: [{ task: "Return laptop", done: false }],
      },
    });
    expect(checklist.data.status).toBe("In progress");
    await expect(
      operation(owner, "lifecycle-toggle", {
        id: checklist.id,
        data: { index: 0 },
      }),
    ).rejects.toThrow("equipment returns");
    await updateRecord(owner, "asset", asset.id, {
      updatedAt: asset.updated_at,
      data: { returnedDate: "2026-10-08", condition: "Returned" },
    });
    await operation(owner, "lifecycle-toggle", {
      id: checklist.id,
      data: { index: 0 },
    });
    expect((await recordById(owner, checklist.id)).data.status).toBe(
      "Completed",
    );
    const letter = await createRecord(owner, "letter", {
      employeeId: e.id,
      data: {
        title: "Confirmation",
        type: "Confirmation",
        effectiveDate: "2026-10-08",
        body: "Confirmed appointment",
        status: "Issued",
      },
    });
    expect(letter.data.status).toBe("Draft");
    await operation(owner, "letter-issue", { id: letter.id });
    const issued = await recordById(owner, letter.id);
    await expect(
      updateRecord(owner, "letter", letter.id, {
        updatedAt: issued.updated_at,
        data: { body: "Changed" },
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("hires a candidate once and carries their recruitment attachment to onboarding", async () => {
    const activeJob = await createRecord(owner, "job", {
      data: { ...job.data, status: "Published" },
    });
    const file = await uploadFile(
      owner,
      new File(["Candidate CV React developer"], "resume.txt", {
        type: "text/plain",
      }),
    );
    const candidate = await createRecord(owner, "candidate", {
      data: {
        name: "New Hire",
        email: `${randomUUID()}@example.test`,
        jobId: activeJob.id,
        stage: "Offer",
        resume: "React developer",
        resumeFileId: file.id,
        consent: true,
      },
    });
    const result = (await operation(owner, "candidate-hire", {
      id: candidate.id,
      data: { startDate: "2026-11-01", salary: 4500 },
    })) as { employeeId: string };
    const second = await operation(owner, "candidate-hire", {
      id: candidate.id,
      data: { startDate: "2026-11-01", salary: 9000 },
    });
    expect(second).toEqual(result);
    expect((await recordById(owner, result.employeeId)).data).toMatchObject({
      status: "Onboarding",
      salary: 4500,
    });
    expect(
      (await visibleRecords(owner)).filter(
        (r) => r.employee_id === result.employeeId && r.kind === "document",
      )[0].data.fileId,
    ).toBe(file.id);
  });
  it("preserves evaluation criteria snapshots and weighted historical scores", async () => {
    const e = await freshEmployee(),
      cycle = await createRecord(owner, "review_cycle", {
        data: {
          title: "2026 review",
          startDate: "2026-01-01",
          endDate: "2026-12-31",
        },
      });
    const template = await createRecord(owner, "evaluation_template", {
      data: {
        title: "Quarterly",
        criteria: [
          { title: "Delivery", weight: 75 },
          { title: "Teamwork", weight: 25 },
        ],
      },
    });
    const evaluation = await createRecord(owner, "evaluation", {
      employeeId: e.id,
      data: { cycleId: cycle.id, templateId: template.id },
    });
    await updateRecord(owner, "evaluation_template", template.id, {
      updatedAt: template.updated_at,
      data: { criteria: [{ title: "New criterion", weight: 100 }] },
    });
    await operation(asEmployee(e), "evaluation-submit", {
      id: evaluation.id,
      data: { selfComments: "Delivered release" },
    });
    await expect(
      operation(asEmployee(e), "evaluation-review", {
        id: evaluation.id,
        data: { ratings: [4, 2] },
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      await operation(owner, "evaluation-review", {
        id: evaluation.id,
        data: { ratings: [4, 2], feedback: "Good delivery" },
      }),
    ).toEqual({ score: 3.5 });
    const final = await recordById(owner, evaluation.id);
    expect(
      (final.data.templateSnapshot as { criteria: unknown[] }).criteria,
    ).toHaveLength(2);
    await expect(
      operation(owner, "evaluation-review", {
        id: evaluation.id,
        data: { ratings: [5, 5] },
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("prevents duplicate payment vouchers and records a real transfer reference", async () => {
    const e = await freshEmployee(),
      claim = await createRecord(asEmployee(e), "claim", { data: expense() });
    await reviewRequest(owner, { id: claim.id, decision: "Approved" });
    await expect(
      operation(owner, "voucher-prepare", {
        id: claim.id,
        data: { recordIds: [claim.id, claim.id] },
      }),
    ).rejects.toThrow();
    const voucher = (await operation(owner, "voucher-prepare", {
      id: claim.id,
    })) as HRRecord;
    expect(voucher.data.amount).toBe(30);
    await expect(
      operation(owner, "voucher-prepare", { id: claim.id }),
    ).rejects.toThrow("unpaid approved");
    await expect(
      reviewRequest(owner, { id: claim.id, decision: "Paid" }),
    ).rejects.toMatchObject({ status: 409 });
    await operation(owner, "voucher-pay", {
      id: voucher.id,
      data: { bankReference: "TEST-TRANSFER-001" },
    });
    expect((await recordById(owner, claim.id)).data.status).toBe("Paid");
  });
  it("uses effective salary changes for historical payroll instead of current salary", async () => {
    const e = await freshEmployee({ overtimeEligible: true });
    await operation(owner, "employment-change", {
      id: e.id,
      data: {
        title: "Senior Engineer",
        effectiveDate: "2026-09-16",
        newSalary: 6000,
      },
    });
    const updated = await recordById(owner, e.id),
      records = await visibleRecords(owner);
    expect(updated.data.salary).toBe(6000);
    expect(
      payrollInputs(updated, "2026-08", records, [1, 2, 3, 4, 5], []).base,
    ).toBe(4000);
    expect(
      payrollInputs(updated, "2026-09", records, [1, 2, 3, 4, 5], []).base,
    ).toBe(5000);
  });
  it("applies scheduled employment changes only when due and only once", async () => {
    const e = await freshEmployee();
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kuala_Lumpur",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const tomorrow = new Date(Date.parse(today) + 86400000)
      .toISOString()
      .slice(0, 10);
    await operation(owner, "employment-change", {
      id: e.id,
      data: {
        title: "Lead Engineer",
        effectiveDate: tomorrow,
        newSalary: 6500,
      },
    });
    await maintenance();
    expect((await recordById(owner, e.id)).data.salary).toBe(4000);
    await db.query(
      "UPDATE hr_records SET data=jsonb_set(data,'{effectiveDate}',to_jsonb($1::text)) WHERE company_id=$2 AND employee_id=$3 AND kind='job_history'",
      [today, owner.companyId, e.id],
    );
    await maintenance();
    await maintenance();
    expect((await recordById(owner, e.id)).data).toMatchObject({
      salary: 6500,
      title: "Lead Engineer",
    });
    expect(
      (
        await db.query(
          "SELECT id FROM audit_log WHERE entity_id=$1 AND action='Applied scheduled employment change'",
          [e.id],
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("uses configured overtime rates and excludes already linked overtime", async () => {
    const e = await freshEmployee({ overtimeEligible: true });
    const overtime = {
      ...e,
      id: randomUUID(),
      employee_id: e.id,
      kind: "overtime",
      data: {
        date: "2026-08-04",
        status: "Approved",
        type: "Normal",
        hours: 2,
      },
    } as HRRecord;
    const totals = payrollInputs(
      e,
      "2026-08",
      [overtime],
      [1, 2, 3, 4, 5],
      [],
      { Normal: 2 },
    );
    expect(totals.overtime).toBe(76.92);
    expect(totals.inputRecordIds).toContain(overtime.id);
    expect(
      payrollInputs(
        e,
        "2026-08",
        [{ ...overtime, data: { ...overtime.data, payrollId: randomUUID() } }],
        [1, 2, 3, 4, 5],
        [],
      ).overtime,
    ).toBe(0);
    expect(() =>
      payrollInputs(e, "2026-08", [overtime], [1, 2, 3, 4, 5], [], {
        Normal: 0,
      }),
    ).toThrow("Configure a valid overtime rate");
  });
  it("checks geofence accuracy and rejects another company's workplace", async () => {
    const e = await freshEmployee(),
      location = await createRecord(owner, "location", {
        data: {
          name: "KL office",
          geofence: true,
          latitude: 3.14,
          longitude: 101.69,
          radius: 200,
        },
      });
    await expect(
      clock(asEmployee(e), { action: "in", locationId: location.id }),
    ).rejects.toThrow("phone location");
    await expect(
      clock(asEmployee(e), {
        action: "in",
        locationId: location.id,
        coordinates: { latitude: 3.14, longitude: 101.69, accuracy: 500 },
      }),
    ).rejects.toThrow("accuracy");
    await expect(
      clock(
        { ...asEmployee(e), companyId: other.companyId },
        { action: "in", locationId: location.id },
      ),
    ).rejects.toMatchObject({ status: 404 });
    await clock(asEmployee(e), {
      action: "in",
      locationId: location.id,
      coordinates: { latitude: 3.14, longitude: 101.69, accuracy: 10 },
    });
    await clock(asEmployee(e), { action: "out" });
  });
  it("imports private calendar events idempotently and rejects recurring exports", async () => {
    const calendar =
      "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:test-meeting-1\r\nSUMMARY:Team review\r\nDTSTART;TZID=Asia/Kuala_Lumpur:20261110T090000\r\nDTEND;TZID=Asia/Kuala_Lumpur:20261110T100000\r\nEND:VEVENT\r\nEND:VCALENDAR";
    expect(
      await operation(owner, "calendar-import", { data: { calendar } }),
    ).toEqual({ created: 1 });
    expect(
      await operation(owner, "calendar-import", { data: { calendar } }),
    ).toEqual({ created: 0 });
    const meeting = (await visibleRecords(owner)).find(
      (r) => r.data.calendarUID === "test-meeting-1",
    )!;
    expect(meeting.data.calendarStartsAt).toBe("2026-11-10T01:00:00.000Z");
    expect(
      (await visibleRecords({ ...employeeActor(), role: "hr" })).some(
        (r) => r.id === meeting.id,
      ),
    ).toBe(false);
    await expect(
      operation(owner, "calendar-import", {
        data: {
          calendar: calendar.replace(
            "SUMMARY:",
            "RRULE:FREQ=WEEKLY\r\nSUMMARY:",
          ),
        },
      }),
    ).rejects.toThrow("individual occurrences");
  });
  it("rejects cyclic goals and hides team goals from other departments", async () => {
    const team = await createRecord(owner, "department", {
        data: { name: "Team A" },
      }),
      e = await freshEmployee({ departmentId: team.id });
    const company = await createRecord(owner, "goal", {
      data: {
        scope: "Company",
        title: "Company objective",
        target: 10,
        dueDate: "2026-12-01",
      },
    });
    const goal = await createRecord(owner, "goal", {
      data: {
        scope: "Team",
        departmentId: team.id,
        parentId: company.id,
        title: "Team objective",
        target: 5,
        dueDate: "2026-12-01",
      },
    });
    expect(goal.employee_id).toBeNull();
    expect(
      (await visibleRecords(asEmployee(e))).some((r) => r.id === goal.id),
    ).toBe(true);
    expect(
      (await visibleRecords(employeeActor())).some((r) => r.id === goal.id),
    ).toBe(false);
    await expect(
      updateRecord(owner, "goal", company.id, {
        updatedAt: company.updated_at,
        data: { parentId: goal.id },
      }),
    ).rejects.toThrow("cycle");
  });
  it("stores an AI proposal without mutating records, then checks actor, confirmation and replay", async () => {
    const e = await freshEmployee(),
      claim = await createRecord(asEmployee(e), "claim", { data: expense() });
    await db.query(
      "UPDATE companies SET settings=jsonb_set(jsonb_set(settings,'{aiEnabled}','true'),'{aiActionsEnabled}','true') WHERE id=$1",
      [owner.companyId],
    );
    const proposal = await saveAIProposal(
      owner,
      "Confirm this request.\n```hr-action\n" +
        JSON.stringify({
          action: "review",
          recordId: claim.id,
          data: { decision: "Approved" },
          label: "Approve claim",
        }) +
        "\n```",
      [claim],
    );
    expect((await recordById(owner, claim.id)).data.status).toBe("Pending");
    await expect(
      confirmAIProposal(other, { id: proposal.cards[0].id }),
    ).rejects.toMatchObject({ status: 403 });
    await confirmAIProposal(owner, { id: proposal.cards[0].id });
    expect((await recordById(owner, claim.id)).data.status).toBe("Approved");
    await expect(
      confirmAIProposal(owner, { id: proposal.cards[0].id }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("keeps audio chunks private and authorizes a one-use transcription callback", async () => {
    const meeting = await createRecord(owner, "meeting", {
      data: { title: "Private audio", date: "2026-10-08", transcript: "" },
    });
    const bytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 1, 2, 3, 4, 5]);
    const upload = await uploadAudioPart(
      owner,
      {
        meetingId: meeting.id,
        filename: "test.webm",
        part: 0,
        total: 1,
        duration: 5,
      },
      bytes,
    );
    const response = await audioResponse(upload.uploadId, owner, "bytes=2-5");
    expect(response.status).toBe(206);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      bytes.subarray(2, 6),
    );
    await expect(
      audioResponse(upload.uploadId, employeeActor(), null),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      transcribeMeeting(owner, { id: meeting.id }),
    ).rejects.toMatchObject({ status: 503 });
    const plain = "a".repeat(64),
      jobId = randomUUID();
    await db.query(
      "INSERT INTO media_jobs(id,company_id,meeting_id,callback_hash,audio_ids) VALUES($1,$2,$3,$4,'[]')",
      [jobId, owner.companyId, meeting.id, hashToken(plain)],
    );
    await expect(
      finishTranscription(jobId, "b".repeat(64), {
        status: "Complete",
        segments: [],
      }),
    ).rejects.toMatchObject({ status: 403 });
    await finishTranscription(jobId, plain, {
      status: "Complete",
      segments: [
        { start: 0, end: 3, speaker: "Speaker 1", text: "Hello team" },
      ],
    });
    expect((await recordById(owner, meeting.id)).data.transcript).toContain(
      "Hello team",
    );
    await expect(
      finishTranscription(jobId, plain, { status: "Complete", segments: [] }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("enables encrypted MFA, revokes other sessions and consumes recovery codes once", async () => {
    process.env.AUTH_ENCRYPTION_KEY = "12".repeat(32);
    await createSession(owner.userId, owner.companyId);
    await createSession(owner.userId, owner.companyId);
    const setup = await setupMFA(owner),
      otp = await import("otplib"),
      code = await otp.generate({ secret: setup.secret });
    const result = await enableMFA(owner, { code });
    expect(result.recoveryCodes).toHaveLength(10);
    const stored = (
      await db.query<{ secret: string }>(
        "SELECT secret FROM user_mfa WHERE user_id=$1",
        [owner.userId],
      )
    ).rows[0];
    expect(stored.secret).not.toContain(setup.secret);
    expect(
      (
        await db.query("SELECT token_hash FROM sessions WHERE user_id=$1", [
          owner.userId,
        ])
      ).rows,
    ).toHaveLength(1);
    await expect(checkMFA(owner.userId, code)).rejects.toMatchObject({
      status: 401,
    });
    await checkMFA(owner.userId, result.recoveryCodes[0]);
    await expect(
      checkMFA(owner.userId, result.recoveryCodes[0]),
    ).rejects.toMatchObject({ status: 401 });
  });
  it("returns generic password-reset responses and revokes sessions after one-use reset", async () => {
    const result = await requestAccountToken({ email: owner.email }, "reset");
    const missing = await requestAccountToken(
      { email: "missing@example.test" },
      "reset",
    );
    expect(missing).toEqual(result);
    const mail = (
      await db.query<{ body: string }>(
        "SELECT body FROM email_outbox WHERE recipient=$1 AND subject LIKE 'Reset%' ORDER BY created_at DESC LIMIT 1",
        [owner.email],
      )
    ).rows[0];
    const plain = mail.body.split("/account/reset/")[1].trim();
    expect(
      (
        await db.query<{ token_hash: string }>(
          "SELECT token_hash FROM account_tokens WHERE user_id=$1",
          [owner.userId],
        )
      ).rows[0].token_hash,
    ).toBe(hashToken(plain));
    await consumeAccountToken(
      { token: plain, password: "new-owner-password-123" },
      "reset",
    );
    expect(
      (
        await db.query("SELECT token_hash FROM sessions WHERE user_id=$1", [
          owner.userId,
        ])
      ).rows,
    ).toHaveLength(0);
    await expect(
      consumeAccountToken(
        { token: plain, password: "another-password-123" },
        "reset",
      ),
    ).rejects.toMatchObject({ status: 410 });
  });
  it("paginates all records without exposing another tenant or truncating older data", async () => {
    const seed = randomUUID();
    await db.query(
      "INSERT INTO hr_records(id,company_id,kind,data) SELECT gen_random_uuid(),$1,'policy',jsonb_build_object('title',$2::text || i::text,'body','Test policy','category','General') FROM generate_series(1,510) i",
      [owner.companyId, seed],
    );
    let page = await recordPage(owner);
    const records = [...page.records];
    expect(page.nextCursor).not.toBeNull();
    while (page.nextCursor) {
      page = await recordPage(owner, page.nextCursor);
      records.push(...page.records);
    }
    expect(new Set(records.map((r) => r.id)).size).toBe(records.length);
    expect(
      records.filter((r) => String(r.data.title).startsWith(seed)),
    ).toHaveLength(510);
    expect(records.every((r) => r.company_id === owner.companyId)).toBe(true);
  });
});
