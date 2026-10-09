import { it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { migration } from "@/lib/migration";
it("round-trips an encrypted backup, preserves private bytes and revokes sessions", async () => {
  const root = await mkdtemp(join(tmpdir(), "hrms-backup-")),
    source = join(root, "source"),
    target = join(root, "target"),
    file = join(root, "data.nphr"),
    user = randomUUID(),
    company = randomUUID(),
    employee = randomUUID(),
    doc = randomUUID();
  const run = promisify(execFile),
    env = {
      ...process.env,
      NODE_ENV: "test" as const,
      DATABASE_URL: "",
      BACKUP_ENCRYPTION_KEY: "34".repeat(32),
    };
  let database: PGlite | undefined;
  try {
    database = new PGlite(source);
    await database.exec(migration);
    await database.query(
      "INSERT INTO users(id,name,email,password_hash) VALUES($1,'Backup test','backup@example.test','dummy')",
      [user],
    );
    await database.query(
      "INSERT INTO companies(id,name,slug) VALUES($1,'Backup company','backup-company')",
      [company],
    );
    await database.query(
      'INSERT INTO hr_records(id,company_id,kind,data) VALUES($1,$2,\'employee\',\'{"name":"Backup Employee","email":"backup@example.test"}\')',
      [employee, company],
    );
    await database.query(
      "INSERT INTO hr_records(id,company_id,kind,employee_id,data) VALUES($1,$2,'document',$3,'{\"title\":\"Private document\"}')",
      [doc, company, employee],
    );
    await database.query(
      "INSERT INTO memberships(user_id,company_id,role,employee_id) VALUES($1,$2,'owner',$3)",
      [user, company, employee],
    );
    await database.query(
      "INSERT INTO sessions(token_hash,user_id,company_id,expires_at) VALUES('hashed-session',$1,$2,now()+interval '1 day')",
      [user, company],
    );
    await database.query(
      "INSERT INTO files(id,company_id,uploaded_by,filename,mime,bytes,size) VALUES($1,$2,$3,'private.bin','application/octet-stream',$4,5)",
      [randomUUID(), company, user, Buffer.from([0, 1, 2, 255, 3])],
    );
    await database.close();
    database = undefined;
    await run(
      process.execPath,
      ["--import", "tsx", "scripts/backup.mts", "backup", file],
      { env: { ...env, HRMS_DATA_DIR: source }, timeout: 30000 },
    );
    const encrypted = await readFile(file);
    expect(encrypted.subarray(0, 5).toString()).toBe("NPHR1");
    expect(encrypted.toString()).not.toContain("Backup Employee");
    await expect(
      run(
        process.execPath,
        [
          "--import",
          "tsx",
          "scripts/backup.mts",
          "restore",
          file,
          "--empty-database-only",
        ],
        {
          env: {
            ...env,
            HRMS_DATA_DIR: target,
            BACKUP_ENCRYPTION_KEY: "56".repeat(32),
          },
          timeout: 30000,
        },
      ),
    ).rejects.toThrow();
    await run(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/backup.mts",
        "restore",
        file,
        "--empty-database-only",
      ],
      { env: { ...env, HRMS_DATA_DIR: target }, timeout: 30000 },
    );
    database = new PGlite(target);
    const row = (
      await database.query<{ employee_id: string }>(
        "SELECT employee_id FROM hr_records WHERE id=$1",
        [doc],
      )
    ).rows[0];
    expect(row.employee_id).toBe(employee);
    expect(
      (await database.query("SELECT token_hash FROM sessions")).rows,
    ).toHaveLength(0);
    const bytes = (
      await database.query<{ bytes: Uint8Array }>("SELECT bytes FROM files")
    ).rows[0].bytes;
    expect(Buffer.from(bytes)).toEqual(Buffer.from([0, 1, 2, 255, 3]));
    await database.close();
    database = undefined;
    await expect(
      run(
        process.execPath,
        [
          "--import",
          "tsx",
          "scripts/backup.mts",
          "restore",
          file,
          "--empty-database-only",
        ],
        { env: { ...env, HRMS_DATA_DIR: target }, timeout: 30000 },
      ),
    ).rejects.toThrow("Restore target must be empty");
  } finally {
    if (database) await database.close();
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
