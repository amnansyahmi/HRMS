import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { transaction, connection } from "../src/lib/db.ts";
const tables = [
  "users",
  "companies",
  "hr_records",
  "memberships",
  "sessions",
  "invites",
  "audit_log",
  "files",
  "rate_limits",
  "ai_messages",
  "notifications",
  "email_outbox",
  "account_tokens",
  "user_mfa",
  "onboarding_links",
  "announcement_reads",
  "audio_uploads",
  "media_jobs",
  "ai_proposals",
  "ai_usage",
] as const;
const [mode, file, confirm] = process.argv.slice(2),
  key = process.env.BACKUP_ENCRYPTION_KEY;
if (!key || !/^[a-f0-9]{64}$/i.test(key))
  throw new Error(
    "BACKUP_ENCRYPTION_KEY must be a separate 32-byte hexadecimal key",
  );
if (!file || !["backup", "restore"].includes(mode))
  throw new Error(
    "Usage: node --import tsx scripts/backup.mts backup|restore path [--empty-database-only]",
  );
try {
  if (mode === "backup") {
    const snapshot = await transaction(async (tx) => {
      await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      const data: Record<string, unknown[]> = {};
      for (const table of tables) {
        const rows = (
          await tx.query<Record<string, unknown>>(`SELECT * FROM ${table}`)
        ).rows;
        data[table] = rows.map((row) => ({
          ...row,
          ...(table === "files"
            ? { bytes: Buffer.from(row.bytes as Uint8Array).toString("base64") }
            : {}),
        }));
      }
      return { version: 1, createdAt: new Date().toISOString(), data };
    });
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv),
      encrypted = Buffer.concat([
        cipher.update(JSON.stringify(snapshot), "utf8"),
        cipher.final(),
      ]);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(
      file,
      Buffer.concat([Buffer.from("NPHR1"), iv, cipher.getAuthTag(), encrypted]),
      { mode: 0o600 },
    );
    console.log(`Encrypted backup saved: ${file}`);
  } else {
    if (confirm !== "--empty-database-only")
      throw new Error(
        "Restore requires --empty-database-only and a separate empty target database",
      );
    const bytes = await readFile(file);
    if (bytes.subarray(0, 5).toString() !== "NPHR1")
      throw new Error("Unrecognised backup");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(key, "hex"),
      bytes.subarray(5, 17),
    );
    decipher.setAuthTag(bytes.subarray(17, 33));
    const snapshot = JSON.parse(
      Buffer.concat([
        decipher.update(bytes.subarray(33)),
        decipher.final(),
      ]).toString(),
    ) as { version: number; data: Record<string, Record<string, unknown>[]> };
    if (snapshot.version !== 1) throw new Error("Unsupported backup version");
    await transaction(async (tx) => {
      if (
        (await tx.query("SELECT id FROM companies LIMIT 1")).rows.length ||
        (await tx.query("SELECT id FROM users LIMIT 1")).rows.length
      )
        throw new Error("Restore target must be empty");
      for (const table of tables) {
        if (
          [
            "sessions",
            "account_tokens",
            "rate_limits",
            "ai_proposals",
          ].includes(table)
        )
          continue;
        for (const raw of snapshot.data[table] || []) {
          const row = { ...raw };
          if (table === "files")
            row.bytes = Buffer.from(String(row.bytes), "base64");
          if (table === "hr_records") row.employee_id = null;
          const columns = Object.keys(row);
          if (columns.some((c) => !/^[a-z_]+$/.test(c)))
            throw new Error("Invalid column in backup");
          const values = columns.map((c) =>
            row[c] && typeof row[c] === "object" && !Buffer.isBuffer(row[c])
              ? JSON.stringify(row[c])
              : row[c],
          );
          await tx.query(
            `INSERT INTO ${table}(${columns.join(",")}) VALUES(${columns.map((_, i) => "$" + (i + 1)).join(",")})`,
            values,
          );
        }
      }
      for (const row of snapshot.data.hr_records || [])
        if (row.employee_id)
          await tx.query("UPDATE hr_records SET employee_id=$1 WHERE id=$2", [
            row.employee_id,
            row.id,
          ]);
    });
    console.log(
      "Backup restored. Login sessions and reset tokens were revoked. Preserve the original AUTH_ENCRYPTION_KEY for MFA.",
    );
  }
} finally {
  const conn = await connection();
  if ("end" in conn) await conn.end();
  else await conn.close();
}
