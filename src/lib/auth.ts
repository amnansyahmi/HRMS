import {
  randomBytes,
  randomUUID,
  createHash,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { db, transaction, type DB } from "./db";
import { fail } from "./errors";
import { checkMFA } from "./account";
import { queueEmail } from "./notifications";
import { defaultEmployeeStatuses, defaultSpecialists } from "./workflow-config";
import type { Actor, Company, Role } from "./types";
export const COOKIE = "hrms_session";
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const token = () => randomBytes(32).toString("hex");
export const demoEnabled = () => process.env.DEMO_MODE !== "false";
export const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters")
  .max(128);
export async function passwordHash(
  password: string,
  salt = randomBytes(16).toString("hex"),
) {
  const key = await new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, 64, (e, key) => (e ? reject(e) : resolve(key))),
  );
  return `${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(password: string, hash: string) {
  const [salt, stored] = hash.split(":");
  const actual = (await passwordHash(password, salt)).split(":")[1];
  const a = Buffer.from(actual, "hex"),
    b = Buffer.from(stored, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
export function assertOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (process.env.NODE_ENV === "production" && !process.env.APP_URL)
    fail("Configure APP_URL before using this deployment", 503);
  const allowed = new URL(process.env.APP_URL || request.url).origin;
  if (origin !== allowed) fail("Request origin is not allowed", 403);
}
export async function rateLimit(key: string, limit: number, seconds: number) {
  const result = await db.query<{ count: number }>(
    `INSERT INTO rate_limits(key, window_start, count) VALUES($1, now(), 1) ON CONFLICT(key) DO UPDATE SET count = CASE WHEN rate_limits.window_start < now() - ($2 * interval '1 second') THEN 1 ELSE rate_limits.count + 1 END, window_start = CASE WHEN rate_limits.window_start < now() - ($2 * interval '1 second') THEN now() ELSE rate_limits.window_start END RETURNING count`,
    [hashToken(key), seconds],
  );
  if (result.rows[0].count > limit)
    fail("Too many attempts. Please wait and try again.", 429);
}
export async function audit(
  tx: DB,
  actor: Actor,
  action: string,
  entityId: string | null = null,
  details: unknown = {},
) {
  await tx.query(
    "INSERT INTO audit_log(id, company_id, user_id, action, entity_id, details) VALUES($1,$2,$3,$4,$5,$6)",
    [
      randomUUID(),
      actor.companyId,
      actor.userId,
      action,
      entityId,
      JSON.stringify(details),
    ],
  );
}
export async function createSession(userId: string, companyId: string) {
  const session = token();
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,company_id,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",
    [hashToken(session), userId, companyId],
  );
  (await cookies()).set(COOKIE, session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 86400,
  });
}
export async function getActor(): Promise<Actor> {
  const session = (await cookies()).get(COOKIE)?.value;
  if (!session) fail("Please sign in to continue", 401);
  const result = await db.query<Actor>(
    `SELECT u.id AS "userId", u.name, u.email, s.company_id AS "companyId", m.role, m.employee_id AS "employeeId", m.payroll_access AS "payrollAccess" FROM sessions s JOIN users u ON u.id=s.user_id JOIN memberships m ON m.user_id=u.id AND m.company_id=s.company_id WHERE s.token_hash=$1 AND s.expires_at>now() AND (NOT EXISTS(SELECT 1 FROM companies c WHERE c.id=s.company_id AND c.is_demo) OR s.created_at>now()-interval '7 days')`,
    [hashToken(session)],
  );
  if (!result.rows[0]) fail("Your session expired. Please sign in again.", 401);
  return result.rows[0];
}
export async function getCompany(
  actor: Pick<Actor, "companyId">,
  tx: DB = db,
): Promise<Company> {
  const result = await tx.query<Company>(
    "SELECT id,name,slug,settings FROM companies WHERE id=$1",
    [actor.companyId],
  );
  if (!result.rows[0]) fail("Workspace not found", 404);
  const company = result.rows[0];
  return {
    ...company,
    settings: {
      ...defaultSettings,
      ...company.settings,
      aiSpecialists: {
        ...defaultSpecialists,
        ...company.settings.aiSpecialists,
      },
      aiAgents: { ...defaultSettings.aiAgents, ...company.settings.aiAgents },
    },
  };
}
export const defaultSettings = {
  timezone: "Asia/Kuala_Lumpur",
  workDays: [1, 2, 3, 4, 5],
  holidays: [],
  overtimeRates: { Normal: 1.5, "Rest day": 2, "Public holiday": 3 },
  employeeStatuses: defaultEmployeeStatuses,
  employeeTypes: ["Full-time", "Part-time", "Contract", "Intern"],
  clockReminderMinutes: 15,
  aiSpecialists: defaultSpecialists,
  aiEnabled: false,
  aiActionsEnabled: false,
  aiAgents: {
    hr: true,
    recruit: true,
    resume: true,
    meeting: true,
    preferences: true,
  },
  careersIntro: "Join our team. Explore opportunities and apply below.",
  registrationNo: "",
  taxNo: "",
};
export async function signup(input: unknown) {
  const data = z
    .object({
      name: z.string().trim().min(2).max(100),
      email: z.email().toLowerCase(),
      password: passwordSchema,
      company: z.string().trim().min(2).max(100),
    })
    .parse(input);
  await rateLimit("signup:" + data.email, 3, 3600);
  const userId = randomUUID(),
    companyId = randomUUID();
  const hash = await passwordHash(data.password);
  await transaction(async (tx) => {
    if (
      (await tx.query("SELECT id FROM users WHERE email=$1", [data.email])).rows
        .length
    )
      fail("This email already has an account. Please sign in.", 409);
    await tx.query(
      "INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,$4)",
      [userId, data.name, data.email, hash],
    );
    const slug =
      (data.company
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "company") +
      "-" +
      companyId.slice(0, 8);
    await tx.query(
      "INSERT INTO companies(id,name,slug,settings) VALUES($1,$2,$3,$4)",
      [companyId, data.company, slug, JSON.stringify(defaultSettings)],
    );
    await tx.query(
      "INSERT INTO memberships(user_id,company_id,role) VALUES($1,$2,'owner')",
      [userId, companyId],
    );
    await audit(
      tx,
      {
        userId,
        companyId,
        name: data.name,
        email: data.email,
        role: "owner",
        employeeId: null,
      },
      "Created workspace",
    );
  });
  await createSession(userId, companyId);
}
export async function login(input: unknown) {
  const data = z
    .object({
      email: z.email().toLowerCase(),
      password: z.string().min(1).max(128),
      code: z.string().max(64).default(""),
    })
    .parse(input);
  await rateLimit("login:" + data.email, 10, 900);
  const user = (
    await db.query<{ id: string; password_hash: string }>(
      "SELECT id,password_hash FROM users WHERE email=$1",
      [data.email],
    )
  ).rows[0];
  const dummy = "00000000000000000000000000000000:" + "00".repeat(64);
  const valid = await verifyPassword(
    data.password,
    user?.password_hash || dummy,
  );
  if (!user || !valid) fail("Email or password is incorrect", 401);
  const mfa = (
    await db.query<{ enabled: boolean }>(
      "SELECT enabled FROM user_mfa WHERE user_id=$1",
      [user.id],
    )
  ).rows[0];
  if (mfa?.enabled) {
    if (!data.code) fail("Enter your authenticator code or recovery code", 428);
    await checkMFA(user.id, data.code);
  }
  const member = (
    await db.query<{ company_id: string }>(
      "SELECT company_id FROM memberships WHERE user_id=$1 ORDER BY company_id LIMIT 1",
      [user.id],
    )
  ).rows[0];
  if (!member) fail("No active workspace membership", 403);
  await createSession(user.id, member.company_id);
}
export async function logout() {
  const jar = await cookies();
  const session = jar.get(COOKIE)?.value;
  if (session)
    await db.query("DELETE FROM sessions WHERE token_hash=$1", [
      hashToken(session),
    ]);
  jar.delete(COOKIE);
}
export async function createInvite(actor: Actor, input: unknown) {
  if (actor.role !== "owner")
    fail("Only the owner can manage workspace access", 403);
  const data = z
    .object({
      email: z.email().toLowerCase(),
      role: z.enum(["hr", "manager", "employee"]),
      employeeId: z.string().uuid().nullable().default(null),
    })
    .parse(input);
  if (data.role !== "hr" && !data.employeeId)
    fail("Link a manager or employee invitation to an employee record");
  if (data.employeeId) {
    const employee = (
      await db.query<{ data: { email: string } }>(
        "SELECT data FROM hr_records WHERE company_id=$1 AND id=$2 AND kind='employee' AND data->>'status'<>'Archived'",
        [actor.companyId, data.employeeId],
      )
    ).rows[0];
    if (!employee || employee.data.email !== data.email)
      fail("Invitation email must match the employee record");
    if (
      (
        await db.query(
          "SELECT user_id FROM memberships WHERE company_id=$1 AND employee_id=$2",
          [actor.companyId, data.employeeId],
        )
      ).rows.length
    )
      fail("This employee already has an account", 409);
  }
  const plain = token(),
    id = randomUUID();
  await transaction(async (tx) => {
    await tx.query(
      "DELETE FROM invites WHERE company_id=$1 AND email=$2 AND accepted_at IS NULL",
      [actor.companyId, data.email],
    );
    await tx.query(
      "INSERT INTO invites(id,company_id,email,role,employee_id,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '3 days')",
      [
        id,
        actor.companyId,
        data.email,
        data.role,
        data.employeeId,
        hashToken(plain),
      ],
    );
    await queueEmail(
      tx,
      actor.companyId,
      data.email,
      "Join your Nonymauz People workspace",
      `${actor.name} invited you to their workspace. Set up your account here:\n${process.env.APP_URL || "http://localhost:3000"}/invite/${plain}`,
    );
    await audit(tx, actor, "Created access invitation", id, {
      email: data.email,
      role: data.role,
    });
  });
  return {
    token: plain,
    url: `${process.env.APP_URL || "http://localhost:3000"}/invite/${plain}`,
  };
}
export async function acceptInvite(input: unknown) {
  const data = z
    .object({
      token: z.string().regex(/^[a-f0-9]{64}$/),
      name: z.string().trim().min(2).max(100),
      password: passwordSchema,
      code: z.string().max(64).default(""),
    })
    .parse(input);
  await rateLimit("invite:" + data.token, 5, 900);
  const existing = (
    await db.query<{ id: string; password_hash: string; enabled: boolean }>(
      "SELECT u.id,u.password_hash,coalesce(m.enabled,false) AS enabled FROM invites i JOIN users u ON u.email=i.email LEFT JOIN user_mfa m ON m.user_id=u.id WHERE i.token_hash=$1 AND i.expires_at>now() AND i.accepted_at IS NULL",
      [hashToken(data.token)],
    )
  ).rows[0];
  if (existing?.enabled) {
    if (!(await verifyPassword(data.password, existing.password_hash)))
      fail("Password is incorrect", 401);
    if (!data.code) fail("Enter your authenticator or recovery code", 428);
    await checkMFA(existing.id, data.code);
  }
  const hash = await passwordHash(data.password);
  const result = await transaction(async (tx) => {
    const invite = (
      await tx.query<{
        id: string;
        company_id: string;
        email: string;
        role: Role;
        employee_id: string | null;
      }>(
        "SELECT * FROM invites WHERE token_hash=$1 AND expires_at>now() AND accepted_at IS NULL FOR UPDATE",
        [hashToken(data.token)],
      )
    ).rows[0];
    if (!invite) fail("Invitation expired or already used", 410);
    if (invite.employee_id) {
      const employee = (
        await tx.query<{ data: { email: string; status: string } }>(
          "SELECT data FROM hr_records WHERE company_id=$1 AND id=$2 AND kind='employee'",
          [invite.company_id, invite.employee_id],
        )
      ).rows[0];
      if (
        !employee ||
        employee.data.status === "Archived" ||
        employee.data.email !== invite.email
      )
        fail("This employee invitation is no longer valid", 410);
    }
    let user = (
      await tx.query<{ id: string; password_hash: string }>(
        "SELECT id,password_hash FROM users WHERE email=$1",
        [invite.email],
      )
    ).rows[0];
    if (user) {
      if (!(await verifyPassword(data.password, user.password_hash)))
        fail(
          "This email already has an account. Enter its existing password.",
          401,
        );
    } else {
      user = { id: randomUUID(), password_hash: hash };
      await tx.query(
        "INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,$4)",
        [user.id, data.name, invite.email, hash],
      );
    }
    await tx.query(
      "INSERT INTO memberships(user_id,company_id,role,employee_id) VALUES($1,$2,$3,$4)",
      [user.id, invite.company_id, invite.role, invite.employee_id],
    );
    await tx.query("UPDATE invites SET accepted_at=now() WHERE id=$1", [
      invite.id,
    ]);
    await audit(
      tx,
      {
        userId: user.id,
        companyId: invite.company_id,
        name: data.name,
        email: invite.email,
        role: invite.role,
        employeeId: invite.employee_id,
      },
      "Accepted invitation",
      invite.id,
    );
    return { userId: user.id, companyId: invite.company_id };
  });
  await createSession(result.userId, result.companyId);
}
