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
  it("disables demo access in production and on Vercel", () => {
    const before = process.env.NODE_ENV;
    process.env.DEMO_MODE = "true";
    vi.stubEnv("NODE_ENV", "production");
    expect(demoEnabled()).toBe(false);
    vi.stubEnv("NODE_ENV", before || "test");
    process.env.VERCEL = "1";
    expect(demoEnabled()).toBe(false);
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
