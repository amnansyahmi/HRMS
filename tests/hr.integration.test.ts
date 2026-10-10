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
    expect(body.stream).toBe(false);
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
import { cancelAIProposal } from "@/lib/ai-actions";
import { pendingInvitations, revokeInvitation } from "@/lib/access";
import { holidaysForState, parseHolidayCSV } from "@/lib/holidays";
import { hrBrief } from "@/lib/hr-brief";
import { hrReadFacts } from "@/lib/hr-read-facts";
import { resumeEvidence, skillsRubric } from "@/lib/resume-evidence";
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
    })) as { employeeId: string; invitationUrl?: string };
    expect(result.invitationUrl).toMatch(/\/invite\/[a-f0-9]{64}$/);
    const second = await operation(owner, "candidate-hire", {
      id: candidate.id,
      data: { startDate: "2026-11-01", salary: 9000 },
    });
    expect(second).toEqual({ employeeId: result.employeeId });
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

import { getCompany } from "@/lib/auth";
import { saveCompanyConfig, setPayrollAccess } from "@/lib/company-config";
import { resubmitClaim } from "@/lib/claims";
import { refreshPayroll, recalculatePayroll } from "@/lib/hr";
import { filterAIRecords } from "@/lib/ai-policy";

import { extendedFields } from "@/components/extended-fields";
const proposalText = (
  action: string,
  data: Record<string, unknown>,
  recordId?: string,
) =>
  "Review this change.\n```hr-action\n" +
  JSON.stringify({ action, data, recordId, label: "Confirm proposed change" }) +
  "\n```";
const settingsWith = async (patch: Record<string, unknown>) => {
  const company = await getCompany(owner);
  await saveCompanyConfig(owner, {
    name: company.name,
    settings: { ...company.settings, ...patch },
  });
  return company;
};
describe("workflow completion", () => {
  it("uses schema-compatible equipment fields in the actual form", () => {
    expect(extendedFields.asset!.map((field) => field.key)).toEqual(
      expect.arrayContaining(["serial", "issuedDate", "returnedDate"]),
    );
    expect(
      extendedFields.asset!.some((field) =>
        ["serialNo", "issuedOn", "returnedOn"].includes(field.key),
      ),
    ).toBe(false);
  });
  it("returns a claim with a reason and resubmits the same record with protected history", async () => {
    const e = await freshEmployee(),
      claimant = asEmployee(e),
      claim = await createRecord(claimant, "claim", { data: expense() });
    await expect(
      reviewRequest(owner, { id: claim.id, decision: "Returned", note: " " }),
    ).rejects.toThrow("reason");
    await reviewRequest(owner, {
      id: claim.id,
      decision: "Returned",
      note: "Correct the amount",
    });
    const returned = await recordById(owner, claim.id);
    await expect(
      resubmitClaim(owner, {
        id: claim.id,
        updatedAt: returned.updated_at,
        data: { amount: 20 },
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      resubmitClaim(claimant, {
        id: claim.id,
        updatedAt: claim.updated_at,
        data: { amount: 20 },
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      resubmitClaim(
        { ...claimant, companyId: other.companyId },
        { id: claim.id, updatedAt: returned.updated_at, data: { amount: 20 } },
      ),
    ).rejects.toMatchObject({ status: 404 });
    const result = await resubmitClaim(claimant, {
      id: claim.id,
      updatedAt: returned.updated_at,
      data: {
        amount: 20,
        status: "Paid",
        history: [],
        reviewedBy: owner.userId,
        approvalStep: 2,
        payrollId: randomUUID(),
      },
    });
    expect(result.id).toBe(claim.id);
    expect(result.data.payrollId).toBeUndefined();
    expect(result.data).toMatchObject({
      status: "Pending",
      amount: 20,
      reviewedBy: null,
      approvalStep: 0,
    });
    expect(
      (result.data.history as { action: string; note: string }[]).map(
        (event) => event.action,
      ),
    ).toEqual(["Submitted", "Returned", "Resubmitted"]);
    expect((result.data.history as { note: string }[])[1].note).toBe(
      "Correct the amount",
    );
    await expect(
      resubmitClaim(claimant, {
        id: claim.id,
        updatedAt: result.updated_at,
        data: { amount: 1 },
      }),
    ).rejects.toMatchObject({ status: 409 });
    await reviewRequest(owner, { id: claim.id, decision: "Approved" });
    expect((await recordById(owner, claim.id)).data.status).toBe("Approved");
  });
  it("rechecks claim policy limits when a returned claim is corrected", async () => {
    const e = await freshEmployee(),
      policy = await createRecord(owner, "claim_type", {
        data: {
          name: "Correction limit",
          limit: 40,
          period: "Per request",
          receiptRequired: false,
        },
      });
    const claim = await createRecord(asEmployee(e), "claim", {
      data: expense("2026-10-08", { claimTypeId: policy.id }),
    });
    await reviewRequest(owner, {
      id: claim.id,
      decision: "Returned",
      note: "Check total",
    });
    const returned = await recordById(owner, claim.id);
    await expect(
      resubmitClaim(asEmployee(e), {
        id: claim.id,
        updatedAt: returned.updated_at,
        data: { amount: 41 },
      }),
    ).rejects.toThrow("limit");
    expect((await recordById(owner, claim.id)).data.status).toBe("Returned");
  });
  it("adds reusable designations and custom statuses while protecting in-use access semantics", async () => {
    const original = await getCompany(owner);
    const statuses = [
      ...original.settings.employeeStatuses,
      { name: "Permanent", access: "Active" as const },
    ];
    await saveCompanyConfig(owner, {
      name: original.name,
      settings: {
        ...original.settings,
        employeeStatuses: statuses,
        employeeTypes: [...original.settings.employeeTypes, "Apprentice"],
      },
    });
    const designation = await createRecord(owner, "designation", {
      data: { name: "Staff engineer" },
    });
    let e = await freshEmployee({
      designationId: designation.id,
      employmentStatus: "Permanent",
      employmentType: "Apprentice",
    });
    expect(e.data).toMatchObject({
      title: "Staff engineer",
      employmentStatus: "Permanent",
      status: "Active",
    });
    await expect(
      saveCompanyConfig(employeeActor(), {
        name: original.name,
        settings: original.settings,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      saveCompanyConfig(owner, {
        name: original.name,
        settings: {
          ...original.settings,
          employeeStatuses: [
            ...original.settings.employeeStatuses,
            { name: "Permanent", access: "Archived" },
          ],
          employeeTypes: [...original.settings.employeeTypes, "Apprentice"],
        },
      }),
    ).rejects.toThrow("in-use");
    await expect(
      saveCompanyConfig(owner, {
        name: original.name,
        settings: original.settings,
      }),
    ).rejects.toThrow("in-use");
    e = await updateRecord(owner, "employee", e.id, {
      updatedAt: e.updated_at,
      data: { employmentStatus: "Active", employmentType: "Full-time" },
    });
    await saveCompanyConfig(owner, {
      name: original.name,
      settings: original.settings,
    });
    e = await updateRecord(owner, "employee", e.id, {
      updatedAt: e.updated_at,
      data: { employmentStatus: "Resigned", endDate: "2026-10-08" },
    });
    expect(e.data.status).toBe("Archived");
    await expect(clock(asEmployee(e), { action: "in" })).rejects.toMatchObject({
      status: 403,
    });
  });
  it("separates payroll reading, preparation, approval and payments", async () => {
    const e = await freshEmployee(),
      viewer = { ...asEmployee(e), payrollAccess: ["read"] as const };
    await expect(
      generatePayroll(
        { ...viewer, payrollAccess: ["read"] },
        { period: "2028-01" },
      ),
    ).rejects.toMatchObject({ status: 403 });
    const preparer: Actor = {
      ...asEmployee(e),
      payrollAccess: ["read", "prepare"],
    };
    await generatePayroll(preparer, { period: "2028-01", employeeId: e.id });
    const draft = (await visibleRecords(preparer)).find(
      (r) =>
        r.kind === "payroll" &&
        r.employee_id === e.id &&
        r.data.period === "2028-01",
    )!;
    expect(draft).toBeDefined();
    await expect(
      updateRecord(
        { ...asEmployee(e), payrollAccess: ["read"] },
        "payroll",
        draft.id,
        { updatedAt: draft.updated_at, data: { reviewed: true } },
      ),
    ).rejects.toMatchObject({ status: 403 });
    await updateRecord(preparer, "payroll", draft.id, {
      updatedAt: draft.updated_at,
      data: { reviewed: true },
    });
    await expect(
      publishPayroll(preparer, { period: "2028-01" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      publishPayroll(
        { ...preparer, payrollAccess: ["read", "approve"] },
        { period: "2028-01" },
      ),
    ).rejects.toThrow("Another payroll approver");
    await publishPayroll(owner, { period: "2028-01" });
    expect(
      (await visibleRecords({ ...owner, role: "hr", payrollAccess: [] })).some(
        (r) => r.id === draft.id,
      ),
    ).toBe(false);
    const claim = await createRecord(asEmployee(e), "claim", {
      data: expense(),
    });
    await reviewRequest(owner, { id: claim.id, decision: "Approved" });
    await expect(
      reviewRequest(
        { ...owner, role: "hr", payrollAccess: ["read"] },
        { id: claim.id, decision: "Paid" },
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("persists payroll grants in membership and refreshes them for each session", async () => {
    await expect(
      setPayrollAccess(employeeActor(), {
        userId: employeeUserId,
        permissions: ["read"],
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      setPayrollAccess(owner, { userId: other.userId, permissions: ["read"] }),
    ).rejects.toMatchObject({ status: 404 });
    await setPayrollAccess(owner, {
      userId: employeeUserId,
      permissions: ["prepare"],
    });
    await createSession(employeeUserId, owner.companyId);
    expect((await getActor()).payrollAccess).toEqual(["read", "prepare"]);
    await setPayrollAccess(owner, { userId: employeeUserId, permissions: [] });
    expect((await getActor()).payrollAccess).toEqual([]);
  });
  it("prepares weekly and fortnightly runs with dated proration and overlap protection", async () => {
    const e = await freshEmployee({ salary: 3100 });
    const weekly = await generatePayroll(owner, {
      cycle: "Weekly",
      startDate: "2027-01-01",
      endDate: "2027-01-07",
      payDate: "2027-01-08",
      employeeId: e.id,
    });
    const weeklyDraft = (await visibleRecords(owner)).find(
      (r) => r.kind === "payroll" && r.data.runId === weekly.runId,
    )!;
    expect(weeklyDraft.data).toMatchObject({
      base: 700,
      cycle: "Weekly",
      period: "2027-01",
      statutoryMode: "Manual",
    });
    expect(
      (await generatePayroll(owner, { runId: weekly.runId! })).created,
    ).toBe(0);
    await expect(
      generatePayroll(owner, {
        cycle: "Weekly",
        startDate: "2027-01-07",
        endDate: "2027-01-13",
        employeeId: e.id,
      }),
    ).rejects.toThrow("overlap");
    await expect(
      generatePayroll(owner, {
        cycle: "Weekly",
        startDate: "2027-01-09",
        endDate: "2027-01-13",
        employeeId: e.id,
      }),
    ).rejects.toThrow("7 days");
    const fortnight = await generatePayroll(owner, {
      cycle: "Fortnightly",
      startDate: "2027-01-29",
      endDate: "2027-02-11",
      payDate: "2027-02-12",
      employeeId: e.id,
    });
    const draft = (await visibleRecords(owner)).find(
      (r) => r.kind === "payroll" && r.data.runId === fortnight.runId,
    )!;
    expect(Number(draft.data.base)).toBeCloseTo(3 * 100 + (11 * 3100) / 28, 2);
    expect(draft.data.period).toBe("2027-02");
    await updateRecord(owner, "payroll", weeklyDraft.id, {
      updatedAt: weeklyDraft.updated_at,
      data: { reviewed: true },
    });
    await publishPayroll(owner, { runId: weekly.runId! });
    expect((await recordById(owner, draft.id)).data.status).toBe("Draft");
    expect((await recordById(owner, weekly.runId!)).data.status).toBe(
      "Published",
    );
    const published = (await visibleRecords(asEmployee(e))).filter(
      (r) => r.kind === "payroll",
    );
    expect(published.map((r) => r.id)).toContain(weeklyDraft.id);
  });
  it("uses off-cycle pay without duplicate salary and allows final settlement for leavers", async () => {
    let e = await freshEmployee({ salary: 3100, endDate: "2026-10-09" });
    const off = await generatePayroll(owner, {
      cycle: "Off-cycle",
      startDate: "2026-10-01",
      endDate: "2026-10-09",
      employeeId: e.id,
    });
    const offDraft = (await visibleRecords(owner)).find(
      (r) => r.kind === "payroll" && r.data.runId === off.runId,
    )!;
    expect(offDraft.data.base).toBe(0);
    e = await updateRecord(owner, "employee", e.id, {
      updatedAt: e.updated_at,
      data: { employmentStatus: "Resigned" },
    });
    await expect(
      generatePayroll(owner, {
        cycle: "Final settlement",
        startDate: "2026-10-01",
        endDate: "2026-10-09",
      }),
    ).rejects.toThrow("one employee");
    const final = await generatePayroll(owner, {
      cycle: "Final settlement",
      startDate: "2026-10-01",
      endDate: "2026-10-09",
      employeeId: e.id,
    });
    const draft = (await visibleRecords(owner)).find(
      (r) => r.kind === "payroll" && r.data.runId === final.runId,
    )!;
    expect(draft.data.base).toBe(900);
    await updateRecord(owner, "payroll", draft.id, {
      updatedAt: draft.updated_at,
      data: { reviewed: true },
    });
    await publishPayroll(owner, { runId: final.runId! });
  });
  it("refreshes changed payroll inputs and removes stale payment references", async () => {
    const e = await freshEmployee();
    const claim = await createRecord(asEmployee(e), "claim", {
      data: expense("2026-08-01"),
    });
    await reviewRequest(owner, { id: claim.id, decision: "Approved" });
    const run = await generatePayroll(owner, {
      cycle: "Off-cycle",
      startDate: "2026-08-01",
      endDate: "2026-08-05",
      employeeId: e.id,
    });
    const draft = (await visibleRecords(owner)).find(
      (r) => r.kind === "payroll" && r.data.runId === run.runId,
    )!;
    await operation(owner, "voucher-prepare", {
      id: claim.id,
      data: { recordIds: [claim.id], title: "Claim payment" },
    });
    await updateRecord(owner, "payroll", draft.id, {
      updatedAt: draft.updated_at,
      data: { bonus: 100, reviewed: true },
    });
    await expect(publishPayroll(owner, { runId: run.runId! })).rejects.toThrow(
      "another payment",
    );
    const refreshed = await refreshPayroll(owner, { id: draft.id });
    expect(refreshed).toMatchObject({
      bonus: 100,
      reimbursements: 0,
      reviewed: false,
      inputRecordIds: [],
    });
  });
  it("reconciles statutory bands once for the month and subtracts interim deductions", async () => {
    const e = await freshEmployee({
      salary: 3100,
      taxProfileVerified: true,
      epfCategory: "Part A",
      socsoCategory: "First",
      taxResident: true,
      taxScheme: "Standard",
      eisEligible: true,
    });
    const first = await generatePayroll(owner, {
      cycle: "Fortnightly",
      startDate: "2026-03-01",
      endDate: "2026-03-14",
      payDate: "2026-03-14",
      employeeId: e.id,
    });
    const draft1 = (await visibleRecords(owner)).find(
      (r) => r.kind === "payroll" && r.data.runId === first.runId,
    )!;
    await expect(recalculatePayroll(owner, { id: draft1.id })).rejects.toThrow(
      "interim",
    );
    await updateRecord(owner, "payroll", draft1.id, {
      updatedAt: draft1.updated_at,
      data: { epfEmployee: 154, epfEmployer: 182, reviewed: true },
    });
    await publishPayroll(owner, { runId: first.runId! });
    const last = await generatePayroll(owner, {
      cycle: "Final settlement",
      startDate: "2026-03-15",
      endDate: "2026-03-31",
      payDate: "2026-03-31",
      employeeId: e.id,
    });
    const draft2 = (await visibleRecords(owner)).find(
      (r) => r.kind === "payroll" && r.data.runId === last.runId,
    )!;
    const result = await recalculatePayroll(owner, { id: draft2.id });
    expect(Number(result.epfEmployee) + 154).toBe(341);
    expect(Number(result.epfEmployer) + 182).toBe(403);
    expect(result.statutoryMode).toBe("Reconciled");
    expect((result.calculation as Record<string, unknown>).taxableNormal).toBe(
      1700,
    );
    expect(
      (result.calculation as Record<string, unknown>).priorPayslipIds,
    ).toEqual([draft1.id]);
  });
  it("enforces specialist read controls and rejects tools disabled after card preparation", async () => {
    const original = await settingsWith({
      aiEnabled: true,
      aiActionsEnabled: true,
    });
    try {
      const e = await freshEmployee(),
        claim = await createRecord(asEmployee(e), "claim", { data: expense() });
      const card = await saveAIProposal(
        owner,
        proposalText("review", { decision: "Approved" }, claim.id),
        [claim],
        "claims",
      );
      expect(card.cards).toHaveLength(1);
      const current = await getCompany(owner);
      await settingsWith({
        aiSpecialists: {
          ...current.settings.aiSpecialists,
          claims: { enabled: true, tools: ["read"] },
          payroll: { enabled: false, tools: [] },
        },
      });
      await expect(
        confirmAIProposal(owner, { id: card.cards[0].id }),
      ).rejects.toMatchObject({ status: 403 });
      expect((await recordById(owner, claim.id)).data.status).toBe("Pending");
      expect(
        (
          await saveAIProposal(
            owner,
            proposalText("review", { decision: "Approved" }, claim.id),
            [claim],
            "claims",
          )
        ).cards,
      ).toHaveLength(0);
      const filtered = filterAIRecords((await getCompany(owner)).settings, [
        e,
        { ...e, kind: "payroll" },
      ]);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].data.salary).toBeUndefined();
    } finally {
      await saveCompanyConfig(owner, {
        name: original.name,
        settings: original.settings,
      });
    }
  });
  it("allows owner-only reminder configuration cards with exact previews and stale-settings checks", async () => {
    const original = await getCompany(owner);
    await settingsWith({
      aiEnabled: true,
      aiActionsEnabled: true,
      aiSpecialists: {
        ...original.settings.aiSpecialists,
        attendance: { enabled: true, tools: ["read", "clock", "configure"] },
      },
    });
    try {
      expect(
        (
          await saveAIProposal(
            employeeActor(),
            proposalText("configure", { clockReminderMinutes: 20 }),
            [],
            "attendance",
          )
        ).cards,
      ).toHaveLength(0);
      expect(
        (
          await saveAIProposal(
            owner,
            proposalText("configure", {
              clockReminderMinutes: 20,
              aiEnabled: false,
            }),
            [],
            "attendance",
          )
        ).cards,
      ).toHaveLength(0);
      const card = await saveAIProposal(
        owner,
        proposalText("configure", { clockReminderMinutes: 20 }),
        [],
        "attendance",
      );
      expect(card.cards[0].preview).toEqual({ clockReminderMinutes: 20 });
      await settingsWith({ clockReminderMinutes: 25 });
      await expect(
        confirmAIProposal(owner, { id: card.cards[0].id }),
      ).rejects.toMatchObject({ status: 409 });
      const fresh = await saveAIProposal(
        owner,
        proposalText("configure", { clockReminderMinutes: 20 }),
        [],
        "attendance",
      );
      await confirmAIProposal(owner, { id: fresh.cards[0].id });
      expect((await getCompany(owner)).settings.clockReminderMinutes).toBe(20);
    } finally {
      await saveCompanyConfig(owner, {
        name: original.name,
        settings: original.settings,
      });
    }
  });
  it("uses only fresh confirmation coordinates for AI clock-in and prevents replay", async () => {
    const original = await settingsWith({
      aiEnabled: true,
      aiActionsEnabled: true,
    });
    try {
      const e = await freshEmployee(),
        actor = asEmployee(e),
        site = await createRecord(owner, "location", {
          data: {
            name: "Verified site",
            geofence: true,
            latitude: 3.1,
            longitude: 101.6,
            radius: 100,
          },
        });
      const text = proposalText("clock", {
        action: "in",
        locationId: site.id,
        coordinates: { latitude: 3.1, longitude: 101.6, accuracy: 5 },
      });
      const card = await saveAIProposal(actor, text, [site], "attendance");
      expect(card.cards[0].requiresLocation).toBe(true);
      expect(card.cards[0].preview.coordinates).toBeUndefined();
      await expect(
        confirmAIProposal(actor, { id: card.cards[0].id }),
      ).rejects.toThrow("phone location");
      const fresh = await saveAIProposal(actor, text, [site], "attendance");
      await confirmAIProposal(actor, {
        id: fresh.cards[0].id,
        coordinates: { latitude: 3.1, longitude: 101.6, accuracy: 5 },
      });
      await expect(
        confirmAIProposal(actor, { id: fresh.cards[0].id }),
      ).rejects.toMatchObject({ status: 409 });
      await clock(actor, { action: "out" });
    } finally {
      await saveCompanyConfig(owner, {
        name: original.name,
        settings: original.settings,
      });
    }
  });
  it("sends configured pre-shift reminders once and supports next-day midnight starts", async () => {
    const original = await settingsWith({ clockReminderMinutes: 15 });
    const e = await freshEmployee();
    await db.query(
      "UPDATE memberships SET employee_id=$1 WHERE company_id=$2 AND user_id=$3",
      [e.id, owner.companyId, employeeUserId],
    );
    try {
      await createRecord(owner, "shift", {
        data: {
          name: "Midnight rotation",
          start: "00:05",
          end: "08:05",
          days: [1, 2, 3, 4, 5, 6, 0],
          employeeIds: [e.id],
          departmentIds: [],
        },
      });
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-08T15:55:00Z")); // 23:55 Kuala Lumpur, ten minutes before tomorrow's shift.
      await maintenance();
      await maintenance();
      const notifications = (
        await db.query<{ body: string }>(
          "SELECT body FROM notifications WHERE company_id=$1 AND user_id=$2 AND title='Your shift starts soon'",
          [owner.companyId, employeeUserId],
        )
      ).rows;
      expect(notifications).toHaveLength(1);
      expect(notifications[0].body).toContain("2026-10-09");
      await settingsWith({ clockReminderMinutes: 0 });
      vi.setSystemTime(new Date("2026-10-09T15:55:00Z"));
      await maintenance();
      expect(
        (
          await db.query(
            "SELECT id FROM notifications WHERE company_id=$1 AND user_id=$2 AND title='Your shift starts soon'",
            [owner.companyId, employeeUserId],
          )
        ).rows,
      ).toHaveLength(1);
    } finally {
      vi.useRealTimers();
      await db.query(
        "UPDATE memberships SET employee_id=$1 WHERE company_id=$2 AND user_id=$3",
        [employee.id, owner.companyId, employeeUserId],
      );
      await saveCompanyConfig(owner, {
        name: original.name,
        settings: original.settings,
      });
    }
  });
});

import { aiPolicyKey } from "@/lib/ai-policy";
describe("payroll and assistant change guards", () => {
  it("reconciles a monthly draft against a published bonus and rejects changed monthly totals", async () => {
    const e = await freshEmployee({
      salary: 3100,
      taxProfileVerified: true,
      epfCategory: "Part A",
      socsoCategory: "First",
      taxResident: true,
      taxScheme: "Standard",
      eisEligible: true,
    });
    const off = await generatePayroll(owner, {
      cycle: "Off-cycle",
      title: "First bonus",
      startDate: "2026-04-01",
      endDate: "2026-04-10",
      employeeId: e.id,
    });
    const first = (await visibleRecords(owner)).find(
      (r) => r.kind === "payroll" && r.data.runId === off.runId,
    )!;
    await updateRecord(owner, "payroll", first.id, {
      updatedAt: first.updated_at,
      data: { bonus: 100, epfEmployee: 11, epfEmployer: 13, reviewed: true },
    });
    await publishPayroll(owner, { runId: off.runId! });
    await generatePayroll(owner, { period: "2026-04", employeeId: e.id });
    let monthly = (await visibleRecords(owner)).find(
      (r) =>
        r.kind === "payroll" &&
        !r.data.runId &&
        r.data.period === "2026-04" &&
        r.employee_id === e.id,
    )!;
    expect(monthly.data.epfEmployee).toBe(341);
    expect(monthly.data.statutoryMode).toBe("Reconciled");
    monthly = await updateRecord(owner, "payroll", monthly.id, {
      updatedAt: monthly.updated_at,
      data: { reviewed: true },
    });
    const secondRun = await generatePayroll(owner, {
      cycle: "Off-cycle",
      title: "Second bonus",
      startDate: "2026-04-01",
      endDate: "2026-04-10",
      employeeId: e.id,
    });
    expect(secondRun.runId).not.toBe(off.runId);
    const second = (await visibleRecords(owner)).find(
      (r) => r.kind === "payroll" && r.data.runId === secondRun.runId,
    )!;
    await updateRecord(owner, "payroll", second.id, {
      updatedAt: second.updated_at,
      data: { bonus: 100, epfEmployee: 11, epfEmployer: 13, reviewed: true },
    });
    await publishPayroll(owner, { runId: secondRun.runId! });
    await expect(publishPayroll(owner, { period: "2026-04" })).rejects.toThrow(
      "Monthly totals changed",
    );
    await recalculatePayroll(owner, { id: monthly.id });
    monthly = await recordById(owner, monthly.id);
    await updateRecord(owner, "payroll", monthly.id, {
      updatedAt: monthly.updated_at,
      data: { reviewed: true },
    });
    await publishPayroll(owner, { period: "2026-04" });
  });
  it("hides old AI answers when specialist or payroll permissions change", async () => {
    const original = await settingsWith({ aiEnabled: true });
    const threadId = randomUUID();
    try {
      const current = await getCompany(owner);
      await db.query(
        "INSERT INTO ai_messages(id,company_id,user_id,thread_id,role,content,sources) VALUES($1,$2,$3,$4,'assistant','Authorized salary answer',$5)",
        [
          randomUUID(),
          owner.companyId,
          owner.userId,
          threadId,
          JSON.stringify([
            {
              id: employee.id,
              kind: "employee",
              label: "Employee",
              policy: aiPolicyKey(current.settings, owner),
            },
          ]),
        ],
      );
      expect(await aiHistory(owner, threadId)).toHaveLength(1);
      expect(
        await aiHistory(
          {
            ...owner,
            role: "employee",
            employeeId: employee.id,
            payrollAccess: [],
          },
          threadId,
        ),
      ).toHaveLength(0);
      await settingsWith({
        aiSpecialists: {
          ...current.settings.aiSpecialists,
          payroll: { enabled: false, tools: [] },
        },
      });
      expect(await aiHistory(owner, threadId)).toHaveLength(0);
    } finally {
      await saveCompanyConfig(owner, {
        name: original.name,
        settings: original.settings,
      });
    }
  });
});

describe("specialist context routing", () => {
  it("gives the recruitment specialist authorized candidates and honors disabled read controls", async () => {
    const original = await settingsWith({ aiEnabled: true });
    try {
      const candidate = await createRecord(owner, "candidate", {
        data: {
          name: "Specialist context candidate",
          email: "specialist-candidate@example.test",
          consent: true,
          jobId: job.id,
          resume: "React specialist with testing experience",
        },
      });
      const mock = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: "specialist-test",
              object: "chat.completion",
              created: 1,
              model: "test-alias",
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: "Review the supplied candidate evidence.",
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
      const reply = await askAI(owner, {
        mode: "recruitment",
        message: "Review Specialist context candidate",
      });
      expect(reply.sources.map((source) => source.id)).toContain(candidate.id);
      await expect(
        askAI(employeeActor(), {
          mode: "recruitment",
          message: "Read candidates",
        }),
      ).rejects.toMatchObject({ status: 403 });
      const current = await getCompany(owner);
      await settingsWith({
        aiSpecialists: {
          ...current.settings.aiSpecialists,
          recruitment: { enabled: true, tools: [] },
        },
      });
      await expect(
        askAI(owner, { mode: "recruitment", message: "Read candidates" }),
      ).rejects.toMatchObject({ status: 403 });
      expect(mock).toHaveBeenCalledTimes(1);
    } finally {
      await saveCompanyConfig(owner, {
        name: original.name,
        settings: original.settings,
      });
    }
  });
});

describe("final scheduled payday", () => {
  it("reconciles a weekly final payday before the calendar month ends", async () => {
    const e = await freshEmployee({
      salary: 3100,
      taxProfileVerified: true,
      epfCategory: "Part A",
      socsoCategory: "First",
      taxResident: true,
      taxScheme: "Standard",
      eisEligible: true,
    });
    const run = await generatePayroll(owner, {
      cycle: "Weekly",
      startDate: "2026-05-22",
      endDate: "2026-05-28",
      payDate: "2026-05-29",
      finalInMonth: true,
      employeeId: e.id,
    });
    const draft = (await visibleRecords(owner)).find(
      (r) => r.kind === "payroll" && r.data.runId === run.runId,
    )!;
    expect(draft.data.finalInMonth).toBe(true);
    expect(
      (await recalculatePayroll(owner, { id: draft.id })).statutoryMode,
    ).toBe("Reconciled");
  });
});

import {
  submitProfileChange,
  reviewProfileChange,
} from "@/lib/profile-changes";
import { reviewOptions, approvalStage } from "@/lib/request-workflow";
import { calendarEvents, calendarEmployees } from "@/lib/hr-calendar";
import { exportCalendar } from "@/lib/calendar-export";
import { appUrlIssue, deploymentChecks } from "@/lib/deployment-config";
import { GET as exportGet } from "@/app/api/export/route";
import { GET as setupGet } from "@/app/api/setup/route";

describe("contact update requests", () => {
  it("applies only reviewed contact changes and preserves employment fields", async () => {
    const e = await freshEmployee({ phone: "0120000000" });
    const request = await submitProfileChange(asEmployee(e), {
      employeeUpdatedAt: e.updated_at,
      changes: { phone: "0131234567", address: "New address" },
      reason: "Moved house",
    });
    expect((await recordById(owner, e.id)).data.phone).toBe("0120000000");
    expect(request.data.previous).toMatchObject({ phone: "0120000000" });
    await expect(
      reviewProfileChange(asEmployee(e), {
        id: request.id,
        expectedUpdatedAt: request.updated_at,
        decision: "Approved",
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      reviewProfileChange(managerActor(), {
        id: request.id,
        expectedUpdatedAt: request.updated_at,
        decision: "Approved",
      }),
    ).rejects.toMatchObject({ status: 403 });
    await reviewProfileChange(owner, {
      id: request.id,
      expectedUpdatedAt: request.updated_at,
      decision: "Approved",
      note: "Confirmed with employee",
    });
    const updated = await recordById(owner, e.id);
    expect(updated.data).toMatchObject({
      phone: "0131234567",
      address: "New address",
      salary: e.data.salary,
      email: e.data.email,
      status: e.data.status,
    });
    await expect(
      reviewProfileChange(owner, {
        id: request.id,
        expectedUpdatedAt: request.updated_at,
        decision: "Approved",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("rejects unsupported fields, stale submissions and concurrent pending changes", async () => {
    const e = await freshEmployee();
    for (const changes of [
      { salary: "1" },
      { bankAccount: "123" },
      { email: "changed@test.invalid" },
      { managerId: owner.userId },
    ])
      await expect(
        submitProfileChange(asEmployee(e), {
          employeeUpdatedAt: e.updated_at,
          changes,
          reason: "Changed",
        }),
      ).rejects.toMatchObject({ status: 400 });
    await expect(
      submitProfileChange(asEmployee(e), {
        employeeUpdatedAt: "old",
        changes: { phone: "123" },
        reason: "Changed",
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      submitProfileChange(asEmployee(e), {
        employeeUpdatedAt: e.updated_at,
        changes: { phone: "" },
        reason: "No change",
      }),
    ).rejects.toMatchObject({ status: 400 });
    const payload = {
      employeeUpdatedAt: e.updated_at,
      changes: { phone: "123" },
      reason: "New phone",
    };
    const request = await submitProfileChange(asEmployee(e), payload);
    await expect(
      submitProfileChange(asEmployee(e), payload),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      updateRecord(owner, "profile_change", request.id, {
        updatedAt: request.updated_at,
        data: { status: "Approved" },
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      createRecord(owner, "profile_change", {
        employeeId: e.id,
        data: request.data,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("does not overwrite contact fields that HR changed after submission", async () => {
    const e = await freshEmployee(),
      request = await submitProfileChange(asEmployee(e), {
        employeeUpdatedAt: e.updated_at,
        changes: { phone: "456" },
        reason: "New phone",
      });
    await updateRecord(owner, "employee", e.id, {
      updatedAt: e.updated_at,
      data: { phone: "HR update" },
    });
    await expect(
      reviewProfileChange(owner, {
        id: request.id,
        expectedUpdatedAt: request.updated_at,
        decision: "Approved",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await recordById(owner, e.id)).data.phone).toBe("HR update");
  });
  it("allows unrelated HR changes and merges without losing them", async () => {
    const e = await freshEmployee(),
      request = await submitProfileChange(asEmployee(e), {
        employeeUpdatedAt: e.updated_at,
        changes: { address: "New home" },
        reason: "Moved",
      });
    await updateRecord(owner, "employee", e.id, {
      updatedAt: e.updated_at,
      data: { title: "Senior Engineer" },
    });
    await reviewProfileChange(owner, {
      id: request.id,
      expectedUpdatedAt: request.updated_at,
      decision: "Approved",
    });
    expect((await recordById(owner, e.id)).data).toMatchObject({
      address: "New home",
      title: "Senior Engineer",
    });
  });
  it("keeps proposed details private from managers, colleagues and other tenants", async () => {
    const e = await freshEmployee(),
      request = await submitProfileChange(asEmployee(e), {
        employeeUpdatedAt: e.updated_at,
        changes: { address: "Private home" },
        reason: "Moved",
      });
    expect(
      (await visibleRecords(managerActor())).some((r) => r.id === request.id),
    ).toBe(false);
    expect(
      (await visibleRecords(employeeActor())).some((r) => r.id === request.id),
    ).toBe(false);
    expect(
      (await visibleRecords(asEmployee(e))).some((r) => r.id === request.id),
    ).toBe(true);
    await expect(
      reviewProfileChange(other, {
        id: request.id,
        expectedUpdatedAt: request.updated_at,
        decision: "Approved",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("supports reasoned rejection, own cancellation and resubmission as a new request", async () => {
    const e = await freshEmployee(),
      payload = {
        employeeUpdatedAt: e.updated_at,
        changes: { phone: "789" },
        reason: "Changed",
      };
    const request = await submitProfileChange(asEmployee(e), payload);
    await expect(
      reviewProfileChange(owner, {
        id: request.id,
        expectedUpdatedAt: request.updated_at,
        decision: "Rejected",
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      reviewProfileChange(owner, {
        id: request.id,
        expectedUpdatedAt: request.updated_at,
        decision: "Cancelled",
      }),
    ).rejects.toMatchObject({ status: 403 });
    await reviewProfileChange(asEmployee(e), {
      id: request.id,
      expectedUpdatedAt: request.updated_at,
      decision: "Cancelled",
    });
    const second = await submitProfileChange(asEmployee(e), payload);
    await reviewProfileChange(owner, {
      id: second.id,
      expectedUpdatedAt: second.updated_at,
      decision: "Rejected",
      note: "Please confirm the number",
    });
    expect((await recordById(owner, e.id)).data.phone).toBe(e.data.phone);
    expect((await recordById(owner, second.id)).data.reviewNote).toBe(
      "Please confirm the number",
    );
  });
});

describe("approval inbox permissions", () => {
  it("shows the manager and HR stages while withholding self approval", async () => {
    const e = await freshEmployee(),
      policy = await createRecord(owner, "claim_type", {
        data: {
          name: "Staged inbox",
          limit: 100,
          period: "Per request",
          receiptRequired: false,
          approval: "Manager then HR",
        },
      });
    const claim = await createRecord(asEmployee(e), "claim", {
      data: expense("2026-09-15", { claimTypeId: policy.id }),
    });
    let records = await visibleRecords(owner);
    expect(approvalStage(claim, records)).toBe("Awaiting manager");
    expect(reviewOptions(owner, claim, records)).not.toContain("Approved");
    expect(reviewOptions(managerActor(), claim, records)).toContain("Approved");
    expect(reviewOptions(asEmployee(e), claim, records)).toEqual(["Cancelled"]);
    await reviewRequest(managerActor(), {
      id: claim.id,
      decision: "Approved",
      expectedUpdatedAt: claim.updated_at,
    });
    const updated = await recordById(owner, claim.id);
    records = await visibleRecords(owner);
    expect(approvalStage(updated, records)).toBe("Awaiting HR");
    expect(reviewOptions(managerActor(), updated, records)).not.toContain(
      "Approved",
    );
    expect(reviewOptions(owner, updated, records)).toContain("Approved");
    await expect(
      reviewRequest(owner, {
        id: claim.id,
        decision: "Approved",
        expectedUpdatedAt: claim.updated_at,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("keeps HR-only approvals and linked claim payments out of unsupported controls", async () => {
    const e = await freshEmployee(),
      policy = await createRecord(owner, "claim_type", {
        data: {
          name: "HR-only inbox",
          limit: 100,
          period: "Per request",
          receiptRequired: false,
          approval: "HR only",
        },
      });
    const claim = await createRecord(asEmployee(e), "claim", {
        data: expense("2026-09-15", { claimTypeId: policy.id }),
      }),
      records = await visibleRecords(owner);
    expect(reviewOptions(managerActor(), claim, records)).not.toContain(
      "Approved",
    );
    expect(
      reviewOptions(
        owner,
        {
          ...claim,
          data: { ...claim.data, status: "Approved", voucherId: randomUUID() },
        },
        records,
      ),
    ).not.toContain("Paid");
    expect(reviewOptions(other, claim, records)).toEqual([]);
  });
});

describe("scoped calendar and downloads", () => {
  it("limits employees to themselves and managers to direct reports", async () => {
    const records = await visibleRecords(owner);
    expect(
      calendarEmployees(employeeActor(), records).map((e) => e.id),
    ).toEqual([employee.id]);
    const team = calendarEmployees(managerActor(), records);
    expect(team.some((e) => e.id === colleague.id)).toBe(false);
    expect(
      team.every(
        (e) =>
          e.id === managerEmployee.id ||
          e.data.managerId === managerEmployee.id,
      ),
    ).toBe(true);
  });
  it("omits request reasons, medical types and pending events from exports", async () => {
    const e = await freshEmployee(),
      company = await getCompany(owner);
    const request = await createRecord(asEmployee(e), "leave", {
      data: {
        ...leaveData("2026-11-02"),
        type: "Sick",
        reason: "Private diagnosis",
      },
    });
    const records = await visibleRecords(owner),
      pending = calendarEvents(
        asEmployee(e),
        company,
        records,
        "2026-11-01",
        "2026-11-05",
        "mine",
        true,
      );
    expect(pending.some((ev) => ev.recordId === request.id)).toBe(true);
    expect(exportCalendar(pending, company.settings.timezone)).not.toContain(
      request.id,
    );
    await reviewRequest(owner, { id: request.id, decision: "Approved" });
    const approved = calendarEvents(
      asEmployee(e),
      company,
      await visibleRecords(owner),
      "2026-11-01",
      "2026-11-05",
      "mine",
    );
    const ics = exportCalendar(approved, company.settings.timezone);
    expect(ics).toContain("Away");
    expect(ics).not.toContain("Private diagnosis");
    expect(ics).not.toContain("Sick");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261102");
    expect(ics).toContain("DTEND;VALUE=DATE:20261103");
  });
  it("exports rotating overnight shifts in UTC and honors the same filters", async () => {
    const e = await freshEmployee(),
      company = await getCompany(owner);
    const shift = await createRecord(owner, "shift", {
      data: {
        name: "Night",
        start: "22:00",
        end: "06:00",
        days: [1, 2, 3, 4, 5],
        employeeIds: [e.id],
        anchorDate: "2026-11-02",
        rotationWeeks: 2,
        activeWeeks: [1],
      },
    });
    const records = await visibleRecords(owner);
    const events = calendarEvents(
      asEmployee(e),
      company,
      records,
      "2026-11-02",
      "2026-11-09",
      "mine",
    );
    expect(
      events.some((ev) => ev.recordId === shift.id && ev.date === "2026-11-09"),
    ).toBe(false);
    const ics = exportCalendar(events, "Asia/Kuala_Lumpur");
    expect(ics).toContain("DTSTART:20261102T140000Z");
    expect(ics).toContain("DTEND:20261102T220000Z");
    expect(
      calendarEvents(
        asEmployee(e),
        company,
        records,
        "2026-11-02",
        "2026-11-02",
        "team",
      ).every((ev) => !ev.employeeId || ev.employeeId === e.id),
    ).toBe(true);
  });
  it("handles 24:00, escapes injection text and folds UTF-8 safely", () => {
    const events = [
      {
        id: "test",
        recordId: null,
        employeeId: null,
        date: "2026-11-02",
        title: "漢".repeat(50) + "\nBEGIN:VEVENT;bad,slash\\",
        kind: "time_off" as const,
        status: "Approved",
        start: "23:00",
        end: "24:00",
        overnight: false,
      },
    ];
    const ics = exportCalendar(events, "Asia/Kuala_Lumpur");
    expect(ics).toContain("DTEND:20261102T160000Z");
    expect(ics.match(/\r\nBEGIN:VEVENT/g)).toHaveLength(1);
    expect(
      ics.split("\r\n").every((line) => Buffer.byteLength(line) <= 75),
    ).toBe(true);
    expect(ics).not.toContain("�");
    expect(() =>
      exportCalendar(
        [{ ...events[0], date: "2026-03-08", start: "02:30", end: "03:30" }],
        "America/New_York",
      ),
    ).toThrow("does not exist");
  });
  it("rejects oversized ranges and exports only authorized calendar records", async () => {
    await createSession(employeeUserId, owner.companyId);
    const response = await exportGet(
      new Request(
        "http://localhost:3000/api/export?type=calendar&start=2026-11-01&end=2026-11-30&scope=team",
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const text = await response.text();
    expect(text).not.toContain(String(colleague.data.name));
    expect(
      (
        await exportGet(
          new Request(
            "http://localhost:3000/api/export?type=calendar&start=2026-01-01&end=2026-12-31",
          ),
        )
      ).status,
    ).toBe(400);
    const company = await getCompany(owner);
    expect(() =>
      calendarEvents(owner, company, [], "2026-01-01", "2026-12-31"),
    ).toThrow("1–62 days");
    await createSession(owner.userId, owner.companyId);
  });
});

describe("deployment diagnostics and notification reading", () => {
  it("validates canonical URLs without disclosing their contents", () => {
    expect(appUrlIssue({ NODE_ENV: "production" })).toContain("APP_URL");
    for (const url of [
      "not a url",
      "http://example.test",
      "https://user:secret@example.test",
      "https://example.test/path",
      "https://example.test/?secret=abc",
    ])
      expect(
        appUrlIssue({ NODE_ENV: "production", APP_URL: url }),
      ).toBeTruthy();
    expect(
      appUrlIssue({ NODE_ENV: "production", APP_URL: "https://example.test" }),
    ).toBeNull();
    expect(
      appUrlIssue({
        NODE_ENV: "development",
        APP_URL: "http://localhost:3000",
      }),
    ).toBeNull();
    const checks = JSON.stringify(
      deploymentChecks({
        DATABASE_URL: "private-db-url",
        AI_NONYMAUZ_API_KEY: "private-token",
        APP_URL: "https://private-domain.test",
      }),
    );
    expect(checks).not.toContain("private-db-url");
    expect(checks).not.toContain("private-token");
    expect(checks).not.toContain("private-domain");
  });
  it("restricts setup checks to owners", async () => {
    await createSession(employeeUserId, owner.companyId);
    expect((await setupGet()).status).toBe(403);
    await createSession(owner.userId, owner.companyId);
    const response = await setupGet();
    expect(response.status).toBe(200);
    expect((await response.json()).databaseConnected).toBe(true);
  });
  it("marks only the requested user/company notification as read", async () => {
    const id = randomUUID(),
      second = randomUUID();
    for (const notificationId of [id, second])
      await db.query(
        "INSERT INTO notifications(id,company_id,user_id,title,body,href) VALUES($1,$2,$3,'Test','Update','/?view=approvals')",
        [notificationId, owner.companyId, owner.userId],
      );
    await expect(
      operation(employeeActor(), "notification-read", { id }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      operation(other, "notification-read", { id }),
    ).rejects.toMatchObject({ status: 404 });
    await operation(owner, "notification-read", { id });
    await operation(owner, "notification-read", { id });
    const rows = (
      await db.query<{ id: string; read_at: string | null }>(
        "SELECT id,read_at FROM notifications WHERE id=ANY($1::uuid[])",
        [[id, second]],
      )
    ).rows;
    expect(rows.find((r) => r.id === id)?.read_at).toBeTruthy();
    expect(rows.find((r) => r.id === second)?.read_at).toBeNull();
  });
});

describe("multi-run annual preparation worksheets", () => {
  it("counts distinct published months separately from runs and includes commissions", async () => {
    const e = await freshEmployee({ name: "Worksheet multi-run person" });
    for (const day of ["01", "15"]) {
      const run = await generatePayroll(owner, {
        cycle: "Off-cycle",
        startDate: `2026-03-${day}`,
        endDate: `2026-03-${day}`,
        payDate: `2026-03-${day}`,
        employeeId: e.id,
        title: `Worksheet bonus ${day}`,
      });
      const draft = (await visibleRecords(owner)).find(
        (r) => r.kind === "payroll" && r.data.runId === run.runId,
      )!;
      await updateRecord(owner, "payroll", draft.id, {
        updatedAt: draft.updated_at,
        data: { bonus: 100, commission: 50, reviewed: true },
      });
      await publishPayroll(owner, { runId: run.runId! });
    }
    await createSession(owner.userId, owner.companyId);
    const response = await exportGet(
      new Request("http://localhost:3000/api/export?type=EA&year=2026"),
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    const lines = text.split("\r\n"),
      header = lines.find((l) =>
        l.startsWith('"Employee","Email","Published months"'),
      )!;
    expect(header).toContain('"Published runs"');
    expect(header).toContain('"commission (MYR)"');
    const row = lines
      .find((l) => l.startsWith('"Worksheet multi-run person"'))!
      .split(",");
    expect(row[2]).toBe('"1"');
    expect(row[3]).toBe('"2"');
    expect(row[header.split(",").indexOf('"commission (MYR)"')]).toBe('"100"');
    expect(text).not.toContain('"NaN"');
  });
});

describe("complete public HIRA workflows", () => {
  it("reserves daily limits independently and groups trips across dates", async () => {
    const e = await freshEmployee();
    const daily = await createRecord(owner, "claim_type", {
      data: {
        name: "Daily meals",
        limit: 100,
        period: "Daily",
        receiptRequired: false,
      },
    });
    const claim = (date: string, extra = {}) =>
      createRecord(asEmployee(e), "claim", {
        data: expense(date, { claimTypeId: daily.id, amount: 70, ...extra }),
      });
    await claim("2026-10-01");
    await expect(claim("2026-10-01")).rejects.toMatchObject({ status: 400 });
    await claim("2026-10-02");
    const trip = await createRecord(owner, "claim_type", {
      data: {
        name: "Trip budget",
        limit: 100,
        period: "Per trip",
        receiptRequired: false,
      },
    });
    await expect(claim("2026-10-03", { claimTypeId: trip.id })).rejects.toThrow(
      "trip reference",
    );
    await claim("2026-10-03", {
      claimTypeId: trip.id,
      tripReference: "CLIENT-A",
    });
    await expect(
      claim("2026-11-03", {
        claimTypeId: trip.id,
        tripReference: " client-a ",
      }),
    ).rejects.toThrow("balance");
    await claim("2026-11-03", {
      claimTypeId: trip.id,
      tripReference: "CLIENT-B",
    });
  });
  it("imports reviewed state holidays atomically, deduplicates and checks roles", async () => {
    const sarawak = holidaysForState("Sarawak");
    expect(sarawak.some((r) => r.title.includes("Deepavali"))).toBe(false);
    expect(sarawak.filter((r) => r.title.includes("Gawai"))).toHaveLength(2);
    const rows = [
      {
        title: "Import boundary holiday",
        date: "2026-12-30",
        state: "Sarawak",
      },
    ];
    await expect(
      operation(asEmployee(employee), "holidays-import", {
        data: { rows, reviewed: true },
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      operation(owner, "holidays-import", { data: { rows } }),
    ).rejects.toThrow("Review");
    await expect(
      operation(owner, "holidays-import", {
        data: {
          rows: [...rows, { ...rows[0], date: "2026-02-30" }],
          reviewed: true,
        },
      }),
    ).rejects.toThrow();
    expect(
      (await visibleRecords(owner)).filter(
        (r) => r.kind === "holiday" && r.data.title === rows[0].title,
      ),
    ).toHaveLength(0);
    expect(
      await operation(owner, "holidays-import", {
        data: { rows: [...rows, ...rows], reviewed: true },
      }),
    ).toEqual({ created: 1, skipped: 1 });
    expect(
      await operation(owner, "holidays-import", {
        data: { rows, reviewed: true },
      }),
    ).toEqual({ created: 0, skipped: 1 });
    expect(
      await operation(other, "holidays-import", {
        data: { rows, reviewed: true },
      }),
    ).toEqual({ created: 1, skipped: 0 });
    expect(
      parseHolidayCSV(
        'title,date,state\n"Holiday, reviewed",2026-12-31,National\n',
      )[0].title,
    ).toBe("Holiday, reviewed");
  });
  it("exposes invitation metadata only to owners and revokes the private link", async () => {
    const e = await freshEmployee(),
      rows = await pendingInvitations(owner),
      invitation = rows.find((r) => r.employee_id === e.id)!;
    expect(invitation).toBeDefined();
    expect(invitation).not.toHaveProperty("token_hash");
    await expect(pendingInvitations(asEmployee(e))).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      revokeInvitation(other, { id: invitation.id }),
    ).rejects.toMatchObject({ status: 404 });
    await revokeInvitation(owner, { id: invitation.id });
    expect(
      new Date(
        (await pendingInvitations(owner)).find((r) => r.id === invitation.id)!
          .expires_at,
      ).getTime(),
    ).toBeLessThanOrEqual(Date.now());
  });
  it("saves exactly the reviewed AI letter wording and rejects incomplete drafts", async () => {
    const previous = await settingsWith({
      aiEnabled: true,
      aiActionsEnabled: true,
    });
    try {
      const e = await freshEmployee();
      const data = {
        title: "Reference reviewed by HR",
        type: "Reference",
        effectiveDate: "2026-10-09",
        body: "Dear colleague,\n\nThis is the exact reviewed wording.\n\nHR team",
      };
      const incomplete = await saveAIProposal(
        owner,
        proposalText(
          "letter-draft",
          { type: "Reference", effectiveDate: data.effectiveDate },
          e.id,
        ),
        [e],
        "letters",
      );
      expect(incomplete.cards).toHaveLength(0);
      const forbidden = await saveAIProposal(
        asEmployee(e),
        proposalText("letter-draft", data, e.id),
        [e],
        "letters",
      );
      expect(forbidden.cards).toHaveLength(0);
      const proposal = await saveAIProposal(
        owner,
        proposalText("letter-draft", data, e.id),
        [e],
        "letters",
      );
      expect(proposal.cards[0].preview.body).toBe(data.body);
      const result = await confirmAIProposal(owner, {
        id: proposal.cards[0].id,
      });
      expect((result.result as HRRecord).data).toMatchObject({
        ...data,
        status: "Draft",
      });
      await expect(
        confirmAIProposal(owner, { id: proposal.cards[0].id }),
      ).rejects.toMatchObject({ status: 409 });
    } finally {
      await saveCompanyConfig(owner, {
        name: previous.name,
        settings: previous.settings,
      });
    }
  });
  it("prepares independent action cards and cancellation cannot mutate another card", async () => {
    const previous = await settingsWith({
      aiEnabled: true,
      aiActionsEnabled: true,
    });
    try {
      const e = await freshEmployee(),
        a = await createRecord(asEmployee(e), "claim", { data: expense() }),
        b = await createRecord(asEmployee(e), "claim", {
          data: expense("2026-09-16"),
        });
      const text =
        proposalText("review", { decision: "Approved" }, a.id) +
        "\n" +
        proposalText("review", { decision: "Approved" }, b.id);
      const result = await saveAIProposal(owner, text, [a, b], "claims");
      expect(result.cards).toHaveLength(2);
      await expect(
        cancelAIProposal(other, { id: result.cards[0].id }),
      ).rejects.toMatchObject({ status: 409 });
      await cancelAIProposal(owner, { id: result.cards[0].id });
      await expect(
        confirmAIProposal(owner, { id: result.cards[0].id }),
      ).rejects.toMatchObject({ status: 409 });
      await confirmAIProposal(owner, { id: result.cards[1].id });
      expect((await recordById(owner, a.id)).data.status).toBe("Pending");
      expect((await recordById(owner, b.id)).data.status).toBe("Approved");
      expect(
        (await saveAIProposal(owner, text, [a, b], "chro")).cards,
      ).toHaveLength(0);
    } finally {
      await saveCompanyConfig(owner, {
        name: previous.name,
        settings: previous.settings,
      });
    }
  });
  it("computes the owner brief from full authorized records and observes payroll read controls", async () => {
    const company = await getCompany(owner),
      record = {
        ...employee,
        data: { ...employee.data, salary: 4321, departmentId: null },
      };
    const brief = hrBrief(
      owner,
      company,
      [record, { ...record, id: randomUUID(), company_id: other.companyId }],
      new Date("2026-10-08T17:00:00Z"),
    );
    expect(brief.date).toBe("2026-10-09");
    expect(brief.headcount).toBe(1);
    expect(brief.departments[0].monthlyBaseSalaryMYR).toBe(4321);
    const restricted = {
      ...company,
      settings: {
        ...company.settings,
        aiSpecialists: {
          ...company.settings.aiSpecialists,
          payroll: { enabled: false, tools: [] },
        },
      },
    };
    expect(
      hrBrief(owner, restricted, [record]).departments[0],
    ).not.toHaveProperty("monthlyBaseSalaryMYR");
    expect(hrBrief(owner, restricted, [record]).payrollRuns).toBeNull();
    expect(() => hrBrief(asEmployee(employee), company, [record])).toThrow(
      "owner",
    );
  });
  it("scores only configured job skills with exact resume evidence and rejects fabricated quotations", () => {
    const criteria = skillsRubric.parse([
        { label: "React development", weight: 70 },
        { label: "API implementation", weight: 30 },
      ]),
      resume = "Built React interfaces with measured performance improvements.";
    const output = (quote: string) =>
      "```resume-evidence\n" +
      JSON.stringify([
        { index: 0, grade: 3, quote, gap: "Confirm measurement" },
        { index: 1, grade: 0, quote: "", gap: "Ask about APIs" },
      ]) +
      "\n```";
    expect(resumeEvidence(output(resume), resume, criteria)).toContain(
      "70/100",
    );
    expect(
      resumeEvidence(output("Fabricated skill evidence"), resume, criteria),
    ).not.toContain("70/100");
    expect(
      skillsRubric.safeParse([{ label: "Gender", weight: 1 }]).success,
    ).toBe(false);
    expect(resumeEvidence(output(resume), resume, criteria)).not.toContain(
      "resume-evidence",
    );
  });
});

describe("deterministic assistant lookups", () => {
  it("uses role-scoped reservations and withholds disabled specialist data", async () => {
    const e = await freshEmployee(),
      actor = asEmployee(e),
      company = await getCompany(owner);
    const policy = await createRecord(owner, "claim_type", {
      data: {
        name: "Lookup daily limit",
        limit: 100,
        period: "Daily",
        receiptRequired: false,
      },
    });
    await createRecord(actor, "claim", {
      data: expense("2026-10-09", { claimTypeId: policy.id, amount: 30 }),
    });
    const visible = await visibleRecords(actor),
      now = new Date("2026-10-08T17:00:00Z");
    const facts = hrReadFacts(actor, company, visible, now);
    expect(facts.date).toBe("2026-10-09");
    expect(facts.pendingApprovalCount).toBe(0);
    expect(
      facts.ownClaimBalances?.find((r) => r.policyId === policy.id),
    ).toMatchObject({ reservedOrPaidMYR: 30, availableMYR: 70 });
    const restricted = {
      ...company,
      settings: {
        ...company.settings,
        aiSpecialists: {
          ...company.settings.aiSpecialists,
          payroll: { enabled: false, tools: [] },
        },
      },
    };
    const filtered = hrReadFacts(
      actor,
      restricted,
      filterAIRecords(restricted.settings, visible),
      now,
    );
    expect(filtered.ownOvertimeEstimateInputs).toBeNull();
    expect(
      filtered.ownClaimBalances?.find((r) => r.policyId === policy.id),
    ).toMatchObject({ availableMYR: 70 });
  });
});

import { aiAttachments } from "@/lib/ai-attachments";
import { reserveAIUsage, finishAIUsage, aiUsage } from "@/lib/ai-usage";
import { buildHRDigest } from "@/lib/hr-digest";
describe("workspace enhancement permissions", () => {
  it("keeps chat attachments private to their uploader and workspace", async () => {
    const file = await uploadFile(
      owner,
      new File(["Private attachment"], "private.txt"),
    );
    expect((await aiAttachments(owner, [file.id]))[0].extracted_text).toBe(
      "Private attachment",
    );
    await expect(
      aiAttachments(employeeActor(), [file.id]),
    ).rejects.toMatchObject({ status: 404 });
    await expect(aiAttachments(other, [file.id])).rejects.toMatchObject({
      status: 404,
    });
  });
  it("reserves monthly AI capacity atomically and records safe usage totals", async () => {
    const current = await getCompany(owner);
    const count = (await aiUsage(owner)).requests;
    await db.query("UPDATE companies SET settings=$1 WHERE id=$2", [
      JSON.stringify({
        ...current.settings,
        aiRouting: {
          generalModel: "",
          analysisModel: "",
          visionModel: "",
          monthlyRequestLimit: count + 1,
        },
      }),
      owner.companyId,
    ]);
    try {
      const results = await Promise.allSettled([
        reserveAIUsage(owner, "hr", "test"),
        reserveAIUsage(owner, "hr", "test"),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const success = results.find(
        (r) => r.status === "fulfilled",
      ) as PromiseFulfilledResult<string>;
      await finishAIUsage(success.value, "Succeeded", 120, {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      });
      expect((await aiUsage(owner)).requests).toBe(count + 1);
      await expect(aiUsage(employeeActor())).rejects.toMatchObject({
        status: 403,
      });
      expect((await aiUsage(other)).requests).toBe(0);
    } finally {
      await db.query("UPDATE companies SET settings=$1 WHERE id=$2", [
        JSON.stringify(current.settings),
        owner.companyId,
      ]);
    }
  });
  it("requires fresh private attendance photos at both clock actions and uses server time", async () => {
    const e = await freshEmployee(),
      actor = asEmployee(e),
      current = await getCompany(owner);
    await db.query("UPDATE companies SET settings=$1 WHERE id=$2", [
      JSON.stringify({
        ...current.settings,
        attendanceEvidence: { photoRequired: true, locationRequired: true },
      }),
      owner.companyId,
    ]);
    const coordinates = { latitude: 3.14, longitude: 101.69, accuracy: 20 };
    const photo = () =>
      uploadFile(
        actor,
        new File([Buffer.from([255, 216, 255, 217])], "clock.jpg"),
      );
    try {
      await expect(clock(actor, { action: "in", coordinates })).rejects.toThrow(
        "Take a photo",
      );
      const foreign = await uploadFile(
        other,
        new File([Buffer.from([255, 216, 255, 217])], "foreign.jpg"),
      );
      await expect(
        clock(actor, {
          action: "in",
          coordinates,
          photoId: foreign.id,
          capturedAt: new Date().toISOString(),
        }),
      ).rejects.toThrow("fresh attendance photo");
      const file = await photo(),
        capturedAt = new Date(Date.now() - 60000).toISOString();
      const opened = await clock(actor, {
        action: "in",
        coordinates,
        photoId: file.id,
        capturedAt,
      });
      expect(Date.parse(String(opened.data.clockIn))).toBeGreaterThan(
        Date.parse(capturedAt),
      );
      expect(opened.data.clockInEvidence).toMatchObject({
        photoId: file.id,
        capturedAt,
      });
      expect((await downloadFile(owner, file.id)).status).toBe(200);
      await expect(downloadFile(other, file.id)).rejects.toMatchObject({
        status: 404,
      });
      await expect(
        clock(actor, {
          action: "out",
          coordinates,
          photoId: file.id,
          capturedAt: new Date().toISOString(),
        }),
      ).rejects.toThrow("new photo");
      const second = await photo();
      await expect(
        clock(actor, {
          action: "out",
          photoId: second.id,
          capturedAt: new Date().toISOString(),
        }),
      ).rejects.toThrow("fresh phone location");
      const closed = await clock(actor, {
        action: "out",
        coordinates,
        photoId: second.id,
        capturedAt: new Date().toISOString(),
      });
      expect(closed.data.clockOutEvidence).toMatchObject({
        photoId: second.id,
      });
    } finally {
      await db.query("UPDATE companies SET settings=$1 WHERE id=$2", [
        JSON.stringify(current.settings),
        owner.companyId,
      ]);
    }
  });
  it("deduplicates scheduled digests for a recipient and date", async () => {
    const current = await getCompany(owner);
    await db.query("UPDATE companies SET settings=$1 WHERE id=$2", [
      JSON.stringify({
        ...current.settings,
        digest: { enabled: true, frequency: "daily", hour: 0 },
      }),
      owner.companyId,
    ]);
    try {
      expect(
        buildHRDigest(owner, current, await visibleRecords(owner)).total,
      ).toBeGreaterThanOrEqual(0);
      await maintenance();
      await maintenance();
      const rows = (
        await db.query<{ count: string }>(
          "SELECT count(*) AS count FROM notifications WHERE company_id=$1 AND user_id=$2 AND title='Your HR digest'",
          [owner.companyId, owner.userId],
        )
      ).rows;
      expect(Number(rows[0].count)).toBe(1);
    } finally {
      await db.query("UPDATE companies SET settings=$1 WHERE id=$2", [
        JSON.stringify(current.settings),
        owner.companyId,
      ]);
    }
  });
});

it("sends selected private document evidence and keeps cross-company focus out of AI", async () => {
  const current = await getCompany(owner),
    e = await freshEmployee();
  await db.query("UPDATE companies SET settings=$1 WHERE id=$2", [
    JSON.stringify({ ...current.settings, aiEnabled: true }),
    owner.companyId,
  ]);
  const file = await uploadFile(
    owner,
    new File(["Attachment evidence for this review."], "evidence.txt"),
  );
  const mock = vi.fn(async () =>
    Response.json({
      id: "attachment-test",
      model: "test-alias",
      choices: [
        {
          message: {
            role: "assistant",
            content: `Review this evidence [source:${file.id}]`,
          },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
    }),
  );
  vi.stubGlobal("fetch", mock);
  vi.stubEnv("AI_NONYMAUZ_BASE_URL", "https://nonymauz.example/v1");
  vi.stubEnv("AI_NONYMAUZ_API_KEY", "test-key");
  vi.stubEnv("AI_NONYMAUZ_MODEL", "test-alias");
  try {
    const reply = await askAI(owner, {
      message: "Review this selected employee with my attachment.",
      recordId: e.id,
      fileIds: [file.id],
    });
    const request = JSON.parse(
      String((mock.mock.calls[0] as unknown as [unknown, RequestInit])[1].body),
    );
    expect(JSON.stringify(request.messages)).toContain(
      "Attachment evidence for this review.",
    );
    expect(JSON.stringify(request.messages)).toContain(
      `Focus on the selected employee record ${e.id}`,
    );
    expect(request.mode).toBe("deep");
    expect(reply.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: file.id, kind: "attachment" }),
      ]),
    );
    expect(await aiHistory(owner, reply.threadId)).toHaveLength(2);
    const foreign = await createRecord(other, "employee", {
      data: empData("Other workspace", `${randomUUID()}@example.test`),
    });
    await expect(
      askAI(owner, { message: "Review", recordId: foreign.id }),
    ).rejects.toMatchObject({ status: 404 });
    expect(mock).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await db.query("UPDATE companies SET settings=$1 WHERE id=$2", [
      JSON.stringify(current.settings),
      owner.companyId,
    ]);
  }
});

it("allows separate work sessions on one date while retaining one open clock", async () => {
  const actor = asEmployee(await freshEmployee());
  const first = await clock(actor, { action: "in", location: "Remote" });
  await clock(actor, { action: "out" });
  const second = await clock(actor, { action: "in", location: "Remote" });
  expect(second.id).not.toBe(first.id);
  expect(second.data.workDate).toBe(first.data.workDate);
  await expect(clock(actor, { action: "in" })).rejects.toMatchObject({
    status: 409,
  });
  await clock(actor, { action: "out" });
});
