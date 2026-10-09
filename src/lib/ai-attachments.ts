import { db } from "./db";
import { fail } from "./errors";
import type { Actor } from "./types";
/** Unlinked chat attachments remain private to their uploader, including HR and owners. */
export async function aiAttachments(actor: Actor, ids: string[]) {
  const files = ids.length
    ? (
        await db.query<{
          id: string;
          filename: string;
          mime: string;
          bytes: Buffer;
          extracted_text: string;
        }>(
          "SELECT id,filename,mime,bytes,extracted_text FROM files WHERE company_id=$1 AND uploaded_by=$2 AND id=ANY($3::uuid[])",
          [actor.companyId, actor.userId, ids],
        )
      ).rows
    : [];
  if (files.length !== new Set(ids).size)
    fail("A chat attachment is unavailable to your account", 404);
  for (const file of files)
    if (
      !file.extracted_text.trim() &&
      !["image/png", "image/jpeg"].includes(file.mime)
    )
      fail(
        `${file.filename} has no readable text. Upload a text PDF or use an image with a configured vision model.`,
        400,
      );
  return files;
}
export async function readableAIFileIds(actor: Actor) {
  return new Set(
    (
      await db.query<{ id: string }>(
        "SELECT id FROM files WHERE company_id=$1 AND uploaded_by=$2",
        [actor.companyId, actor.userId],
      )
    ).rows.map((r) => r.id),
  );
}
