import { randomUUID } from "node:crypto";
import { db, transaction } from "./db";
import { audit } from "./auth";
import { fail } from "./errors";
import { visibleRecords } from "./hr";
import { type Actor } from "./types";
export async function extractFile(file: File) {
  const max = Math.min(
    Number(process.env.UPLOAD_MAX_BYTES || 2097152),
    2097152,
  );
  if (!file.size || file.size > max)
    fail(`Files must be smaller than ${Math.round(max / 1024 / 1024)} MB`);
  const bytes = Buffer.from(await file.arrayBuffer()),
    extension = file.name.split(".").pop()?.toLowerCase();
  let text = "",
    mime = "";
  if (extension === "txt") {
    if (bytes.includes(0)) fail("This is not a text file");
    text = bytes.toString("utf8");
    mime = "text/plain";
  } else if (extension === "pdf") {
    if (bytes.subarray(0, 5).toString() !== "%PDF-") fail("Invalid PDF file");
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: bytes });
    try {
      text = (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
    mime = "application/pdf";
  } else if (extension === "docx") {
    if (bytes.subarray(0, 2).toString() !== "PK") fail("Invalid Word file");
    const mammoth = await import("mammoth");
    text = (await mammoth.extractRawText({ buffer: bytes })).value;
    mime =
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  } else if (
    extension === "png" ||
    extension === "jpg" ||
    extension === "jpeg"
  ) {
    if (
      extension === "png" &&
      bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
    )
      fail("Invalid PNG");
    if (
      extension !== "png" &&
      bytes.subarray(0, 3).toString("hex") !== "ffd8ff"
    )
      fail("Invalid JPEG");
    mime = extension === "png" ? "image/png" : "image/jpeg";
  } else fail("Upload PDF, DOCX, TXT, PNG or JPG files");
  return {
    bytes,
    text: text.slice(0, 24000),
    mime,
    filename: file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160),
    size: file.size,
  };
}
export async function uploadFile(actor: Actor, file: File) {
  const extracted = await extractFile(file),
    id = randomUUID();
  await transaction(async (tx) => {
    await tx.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
      actor.companyId,
    ]);
    const size = Number(
      (
        await tx.query<{ size: string }>(
          "SELECT coalesce(sum(size),0) AS size FROM files WHERE company_id=$1",
          [actor.companyId],
        )
      ).rows[0].size,
    );
    if (
      size + file.size >
      Number(process.env.COMPANY_STORAGE_MAX_BYTES || 104857600)
    )
      fail("Workspace storage is full", 413);
    await tx.query(
      "INSERT INTO files(id,company_id,uploaded_by,filename,mime,bytes,size,extracted_text) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        id,
        actor.companyId,
        actor.userId,
        extracted.filename,
        extracted.mime,
        extracted.bytes,
        extracted.size,
        extracted.text,
      ],
    );
    await audit(tx, actor, "Uploaded attachment", id, { size: file.size });
  });
  return {
    id,
    filename: extracted.filename,
    size: file.size,
    text: extracted.text,
  };
}
export async function downloadFile(actor: Actor, id: string) {
  const file = (
    await db.query<{
      bytes: Buffer;
      mime: string;
      filename: string;
      uploaded_by: string;
    }>(
      "SELECT bytes,mime,filename,uploaded_by FROM files WHERE id=$1 AND company_id=$2",
      [id, actor.companyId],
    )
  ).rows[0];
  if (!file) fail("Attachment not found", 404);
  if (file.uploaded_by !== actor.userId) {
    const records = await visibleRecords(actor);
    if (
      !records.some((r) =>
        [
          r.data.receiptId,
          r.data.resumeFileId,
          r.data.fileId,
          r.data.evidenceId,
          (r.data.clockInEvidence as { photoId?: string } | undefined)?.photoId,
          (r.data.clockOutEvidence as { photoId?: string } | undefined)
            ?.photoId,
          ...((r.data.audioIds as string[]) || []),
          ...(r.kind === "claim"
            ? (
                (r.data.history as { snapshot?: { receiptId?: string } }[]) ||
                []
              ).map((event) => event.snapshot?.receiptId)
            : []),
        ].includes(id),
      )
    )
      fail("Attachment not found", 404);
  }
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.mime,
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
