import { randomUUID } from "node:crypto";
import { db, type DB, transaction } from "./db";
import type { Actor } from "./types";
export async function queueEmail(
  tx: DB,
  companyId: string | null,
  to: string,
  subject: string,
  body: string,
  dedupe?: string,
) {
  if (to.endsWith(".invalid")) return;
  if (
    companyId &&
    (
      await tx.query<{ is_demo: boolean }>(
        "SELECT is_demo FROM companies WHERE id=$1",
        [companyId],
      )
    ).rows[0]?.is_demo
  )
    return;
  await tx.query(
    "INSERT INTO email_outbox(id,company_id,recipient,subject,body,dedupe_key) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(dedupe_key) DO NOTHING",
    [randomUUID(), companyId, to, subject, body, dedupe || null],
  );
}
export async function notify(
  tx: DB,
  actor: Actor,
  title: string,
  body: string,
  href: string,
  employeeId?: string,
  reviewers: boolean | "hr" = false,
) {
  const members = (
    await tx.query<{ user_id: string; email: string }>(
      `SELECT m.user_id,u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.company_id=$1 AND ${reviewers === "hr" ? "m.role IN ('owner','hr')" : reviewers ? "(m.role IN ('owner','hr') OR (m.role='manager' AND m.employee_id=(SELECT (data->>'managerId')::uuid FROM hr_records WHERE company_id=$1 AND id=$2)))" : "m.employee_id=$2"}`,
      reviewers === "hr"
        ? [actor.companyId]
        : [actor.companyId, employeeId || null],
    )
  ).rows;
  for (const member of members) {
    await tx.query(
      "INSERT INTO notifications(id,company_id,user_id,title,body,href) VALUES($1,$2,$3,$4,$5,$6)",
      [randomUUID(), actor.companyId, member.user_id, title, body, href],
    );
    if (process.env.EMAIL_NOTIFICATIONS === "true")
      await queueEmail(
        tx,
        actor.companyId,
        member.email,
        title,
        body + "\n\n" + (process.env.APP_URL || "http://localhost:3000") + href,
      );
  }
}
export async function flushEmails(limit = 20) {
  if (!process.env.SMTP_HOST || !process.env.EMAIL_FROM)
    return { configured: false, sent: 0 };
  const nodemailer = await import("nodemailer");
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
    connectionTimeout: 10000,
    socketTimeout: 15000,
  });
  let sent = 0;
  for (let n = 0; n < limit; n++) {
    const message = await transaction(async (tx) => {
      const row = (
        await tx.query<{
          id: string;
          recipient: string;
          subject: string;
          body: string;
          attempts: number;
        }>(
          "SELECT * FROM email_outbox WHERE (status='Pending' OR (status='Sending' AND available_at<now()-interval '10 minutes')) AND available_at<=now() AND attempts<5 ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
        )
      ).rows[0];
      if (row)
        await tx.query(
          "UPDATE email_outbox SET status='Sending',available_at=now(),attempts=attempts+1 WHERE id=$1",
          [row.id],
        );
      return row;
    });
    if (!message) break;
    try {
      await transport.sendMail({
        from: process.env.EMAIL_FROM,
        to: message.recipient,
        subject: message.subject,
        text: message.body,
        messageId: `<${message.id}@${new URL(process.env.APP_URL || "http://localhost").hostname}>`,
      });
      await db.query(
        "UPDATE email_outbox SET status='Sent',last_error=NULL WHERE id=$1",
        [message.id],
      );
      sent++;
    } catch {
      await db.query(
        "UPDATE email_outbox SET status=CASE WHEN attempts>=5 THEN 'Failed' ELSE 'Pending' END,available_at=now()+interval '10 minutes',last_error='SMTP delivery failed; verify the configured provider' WHERE id=$1",
        [message.id],
      );
    }
  }
  return { configured: true, sent };
}
