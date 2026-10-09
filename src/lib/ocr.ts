import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { db } from "./db";
import { visibleRecords } from "./hr";
import { fail } from "./errors";
import { rateLimit } from "./auth";
import type { Actor } from "./types";
export function receiptSuggestions(text: string) {
  const amount = text.match(
    /(?:grand\s*total|total\s*(?:amount|paid|rm)?|jumlah)\s*[:\s]*(?:RM|MYR)?\s*([0-9,]+\.\d{2})/i,
  );
  const iso = text.match(
    /\b(20\d{2})[-/.](0[1-9]|1[0-2])[-/.]([0-2]\d|3[01])\b/,
  );
  const local = text.match(
    /\b([0-2]\d|3[01])[-/.](0[1-9]|1[0-2])[-/.](20\d{2})\b/,
  );
  const rawDate = iso
    ? `${iso[1]}-${iso[2]}-${iso[3]}`
    : local
      ? `${local[3]}-${local[2]}-${local[1]}`
      : null;
  const date =
    rawDate &&
    !Number.isNaN(Date.parse(rawDate)) &&
    new Date(rawDate).toISOString().slice(0, 10) === rawDate
      ? rawDate
      : null;
  return {
    amount: amount ? Number(amount[1].replaceAll(",", "")) : null,
    date,
    merchant:
      text
        .split("\n")
        .find((line) => line.trim().length > 2)
        ?.trim()
        .slice(0, 200) || null,
  };
}
export async function ocrReceipt(actor: Actor, input: unknown) {
  const { fileId } = z.object({ fileId: z.uuid() }).parse(input);
  await rateLimit("ocr:" + actor.companyId + ":" + actor.userId, 10, 3600);
  const file = (
    await db.query<{ bytes: Buffer; mime: string; uploaded_by: string }>(
      "SELECT bytes,mime,uploaded_by FROM files WHERE id=$1 AND company_id=$2",
      [fileId, actor.companyId],
    )
  ).rows[0];
  if (!file || !["image/png", "image/jpeg"].includes(file.mime))
    fail("Choose a PNG or JPG receipt");
  if (
    file.uploaded_by !== actor.userId &&
    !(await visibleRecords(actor)).some(
      (r) => r.kind === "claim" && r.data.receiptId === fileId,
    )
  )
    fail("Receipt unavailable", 404);
  let text = "";
  if (process.env.MEDIA_WORKER_URL && process.env.MEDIA_WORKER_API_KEY) {
    try {
      const response = await fetch(
        process.env.MEDIA_WORKER_URL.replace(/\/$/, "") + "/ocr",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + process.env.MEDIA_WORKER_API_KEY,
            "Content-Type": file.mime,
          },
          body: new Uint8Array(file.bytes),
          signal: AbortSignal.timeout(40000),
        },
      );
      if (!response.ok) throw new Error();
      text = String((await response.json()).text || "");
    } catch {
      fail(
        "Receipt OCR is unavailable. Enter the receipt details manually.",
        503,
      );
    }
  } else if (process.env.OCR_ENABLED === "true") {
    const directory = await mkdtemp(join(tmpdir(), "hrms-ocr-"));
    try {
      const path = join(
        directory,
        file.mime === "image/png" ? "receipt.png" : "receipt.jpg",
      );
      await writeFile(path, file.bytes);
      text = (
        await promisify(execFile)(
          process.env.TESSERACT_PATH || "tesseract",
          [path, "stdout", "-l", "eng", "--psm", "6"],
          { timeout: 30000, maxBuffer: 200000 },
        )
      ).stdout;
    } catch {
      fail(
        "Receipt OCR is unavailable. Configure a worker or installed Tesseract.",
        503,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  } else
    fail(
      "Configure the media worker or OCR_ENABLED with installed Tesseract to read receipts",
      503,
    );
  text = text.slice(0, 24000);
  return { text, suggestions: receiptSuggestions(text), reviewRequired: true };
}
