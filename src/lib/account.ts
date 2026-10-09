import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { db, transaction } from "./db";
import {
  COOKIE,
  token,
  hashToken,
  rateLimit,
  passwordSchema,
  passwordHash,
  verifyPassword,
} from "./auth";
import { queueEmail } from "./notifications";
import { fail } from "./errors";
import type { Actor } from "./types";
function encryptionKey() {
  const raw = process.env.AUTH_ENCRYPTION_KEY;
  if (!raw || !/^[a-f0-9]{64}$/i.test(raw))
    fail("Configure AUTH_ENCRYPTION_KEY before enabling MFA", 503);
  return Buffer.from(raw, "hex");
}
function seal(value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const bytes = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), bytes]
    .map((b) => b.toString("hex"))
    .join(":");
}
function unseal(value: string) {
  const [iv, tag, bytes] = value.split(":").map((s) => Buffer.from(s, "hex"));
  const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(bytes), cipher.final()]).toString("utf8");
}
export async function requestAccountToken(
  input: unknown,
  purpose: "reset" | "verify",
  actor?: Actor,
) {
  const { email } = z.object({ email: z.email().toLowerCase() }).parse(input);
  await rateLimit(`account:${purpose}:${email}`, 3, 3600);
  const user = (
    await db.query<{ id: string }>("SELECT id FROM users WHERE email=$1", [
      email,
    ])
  ).rows[0];
  if (user && (purpose === "reset" || actor?.userId === user.id)) {
    const plain = token();
    await transaction(async (tx) => {
      await tx.query(
        "DELETE FROM account_tokens WHERE user_id=$1 AND purpose=$2",
        [user.id, purpose],
      );
      await tx.query(
        "INSERT INTO account_tokens(token_hash,user_id,purpose,expires_at) VALUES($1,$2,$3,now()+interval '30 minutes')",
        [hashToken(plain), user.id, purpose],
      );
      await queueEmail(
        tx,
        null,
        email,
        purpose === "reset"
          ? "Reset your Nonymauz People password"
          : "Verify your email",
        `${purpose === "reset" ? "Reset your password" : "Verify your email"} using this one-use link. It expires in 30 minutes.\n\n${process.env.APP_URL || "http://localhost:3000"}/account/${purpose}/${plain}`,
      );
    });
  }
  return {
    ok: true,
    message:
      "If this account is eligible, a link will be delivered to its email address.",
    deliveryConfigured: !!process.env.SMTP_HOST,
  };
}
export async function consumeAccountToken(
  input: unknown,
  purpose: "reset" | "verify",
) {
  const data = z
    .object({
      token: z.string().regex(/^[a-f0-9]{64}$/),
      password: purpose === "reset" ? passwordSchema : z.string().optional(),
    })
    .parse(input);
  const hash = purpose === "reset" ? await passwordHash(data.password!) : "";
  await transaction(async (tx) => {
    const row = (
      await tx.query<{ user_id: string }>(
        "SELECT user_id FROM account_tokens WHERE token_hash=$1 AND purpose=$2 AND used_at IS NULL AND expires_at>now() FOR UPDATE",
        [hashToken(data.token), purpose],
      )
    ).rows[0];
    if (!row) fail("This link has expired or was already used", 410);
    if (purpose === "reset") {
      await tx.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
        hash,
        row.user_id,
      ]);
      await tx.query("DELETE FROM sessions WHERE user_id=$1", [row.user_id]);
    } else
      await tx.query("UPDATE users SET email_verified_at=now() WHERE id=$1", [
        row.user_id,
      ]);
    await tx.query(
      "UPDATE account_tokens SET used_at=now() WHERE token_hash=$1",
      [hashToken(data.token)],
    );
  });
  return { ok: true };
}
export async function setupMFA(actor: Actor) {
  if (
    (
      await db.query<{ enabled: boolean }>(
        "SELECT enabled FROM user_mfa WHERE user_id=$1",
        [actor.userId],
      )
    ).rows[0]?.enabled
  )
    fail("MFA is already enabled", 409);
  const otp = await import("otplib");
  const secret = otp.generateSecret();
  const uri = otp.generateURI({
    issuer: "Nonymauz People",
    label: actor.email,
    secret,
  });
  const qr = await import("qrcode");
  await db.query(
    "INSERT INTO user_mfa(user_id,secret) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET secret=EXCLUDED.secret WHERE NOT user_mfa.enabled",
    [actor.userId, seal(secret)],
  );
  return { secret, qr: await qr.toDataURL(uri), uri };
}
export async function checkMFA(
  userId: string,
  code: string,
  allowPending = false,
) {
  await rateLimit(`mfa:${userId}`, 10, 900);
  const otp = await import("otplib");
  await transaction(async (tx) => {
    const row = (
      await tx.query<{
        secret: string;
        enabled: boolean;
        last_step: string;
        recovery_hashes: string[];
      }>("SELECT * FROM user_mfa WHERE user_id=$1 FOR UPDATE", [userId])
    ).rows[0];
    if (!row || (!row.enabled && !allowPending))
      fail("MFA setup is unavailable", 409);
    const hashes = row.recovery_hashes || [],
      hash = hashToken(code.trim());
    if (row.enabled && hashes.includes(hash)) {
      await tx.query(
        "UPDATE user_mfa SET recovery_hashes=$1 WHERE user_id=$2",
        [JSON.stringify(hashes.filter((h) => h !== hash)), userId],
      );
      return;
    }
    if (!/^\d{6}$/.test(code.trim()))
      fail("Authenticator code is incorrect or already used", 401);
    const result = await otp.verify({
      secret: unseal(row.secret),
      token: code.trim(),
      epochTolerance: 30,
      ...(Number(row.last_step) >= 0
        ? { afterTimeStep: Number(row.last_step) }
        : {}),
    });
    if (!result.valid)
      fail("Authenticator code is incorrect or already used", 401);
    await tx.query("UPDATE user_mfa SET last_step=$1 WHERE user_id=$2", [
      "timeStep" in result ? result.timeStep : Math.floor(Date.now() / 30000),
      userId,
    ]);
  });
}
export async function enableMFA(actor: Actor, input: unknown) {
  const { code } = z.object({ code: z.string().min(6).max(64) }).parse(input);
  if (
    (
      await db.query<{ enabled: boolean }>(
        "SELECT enabled FROM user_mfa WHERE user_id=$1",
        [actor.userId],
      )
    ).rows[0]?.enabled
  )
    fail("MFA is already enabled", 409);
  await checkMFA(actor.userId, code, true);
  const recovery = Array.from({ length: 10 }, () =>
    randomBytes(8).toString("hex"),
  );
  const session = (await cookies()).get(COOKIE)?.value;
  await transaction(async (tx) => {
    const result = await tx.query(
      "UPDATE user_mfa SET enabled=true,recovery_hashes=$1 WHERE user_id=$2 AND NOT enabled RETURNING user_id",
      [JSON.stringify(recovery.map(hashToken)), actor.userId],
    );
    if (!result.rows.length) fail("MFA is already enabled", 409);
    await tx.query(
      "DELETE FROM sessions WHERE user_id=$1 AND ($2::text IS NULL OR token_hash<>$2)",
      [actor.userId, session ? hashToken(session) : null],
    );
  });
  return { recoveryCodes: recovery };
}
export async function disableMFA(actor: Actor, input: unknown) {
  const { password, code } = z
    .object({
      password: z.string().min(1).max(128),
      code: z.string().min(6).max(64),
    })
    .parse(input);
  const user = (
    await db.query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE id=$1",
      [actor.userId],
    )
  ).rows[0];
  if (!(await verifyPassword(password, user.password_hash)))
    fail("Password is incorrect", 401);
  await checkMFA(actor.userId, code);
  await db.query("DELETE FROM user_mfa WHERE user_id=$1", [actor.userId]);
  return { ok: true };
}
export async function accountStatus(actor: Actor) {
  return {
    emailVerified: !!(
      await db.query<{ email_verified_at: string }>(
        "SELECT email_verified_at FROM users WHERE id=$1",
        [actor.userId],
      )
    ).rows[0]?.email_verified_at,
    mfaEnabled: !!(
      await db.query<{ enabled: boolean }>(
        "SELECT enabled FROM user_mfa WHERE user_id=$1",
        [actor.userId],
      )
    ).rows[0]?.enabled,
    smtpConfigured: !!process.env.SMTP_HOST,
    mfaConfigured: !!process.env.AUTH_ENCRYPTION_KEY,
  };
}
