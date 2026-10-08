import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, transaction } from "./db";
import { hashToken, token, audit } from "./auth";
import { recordById, visibleRecords, normalize } from "./hr";
import { fail } from "./errors";
import type { Actor, Data, HRRecord } from "./types";
const maxParts = 50,
  maxBytes = 100 * 1024 * 1024;
function audioMime(name: string, bytes: Buffer) {
  const ext = name.split(".").at(-1)?.toLowerCase();
  if (ext === "webm" && bytes.subarray(0, 4).toString("hex") === "1a45dfa3")
    return "audio/webm";
  if (ext === "ogg" && bytes.subarray(0, 4).toString() === "OggS")
    return "audio/ogg";
  if (
    ext === "wav" &&
    bytes.subarray(0, 4).toString() === "RIFF" &&
    bytes.subarray(8, 12).toString() === "WAVE"
  )
    return "audio/wav";
  if (
    ["mp4", "m4a"].includes(ext || "") &&
    bytes.subarray(4, 8).toString() === "ftyp"
  )
    return "audio/mp4";
  if (
    ext === "mp3" &&
    (bytes.subarray(0, 3).toString() === "ID3" ||
      (bytes[0] === 255 && (bytes[1] & 224) === 224))
  )
    return "audio/mpeg";
  fail("Upload WebM, OGG, WAV, M4A or MP3 audio");
}
export async function uploadAudioPart(
  actor: Actor,
  input: unknown,
  bytes: Buffer,
) {
  const body = z
    .object({
      meetingId: z.uuid(),
      uploadId: z.uuid().optional(),
      filename: z.string().min(1).max(160),
      part: z.coerce
        .number()
        .int()
        .min(0)
        .max(maxParts - 1),
      total: z.coerce.number().int().min(1).max(maxParts),
      duration: z.coerce.number().positive().max(10800),
    })
    .parse(input);
  if (bytes.length > 2097152 || !bytes.length)
    fail("Audio parts must be at most 2 MB", 413);
  if (
    !(await visibleRecords(actor)).some(
      (r) => r.id === body.meetingId && r.kind === "meeting",
    )
  )
    fail("Meeting unavailable", 404);
  return transaction(async (tx) => {
    await tx.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
      actor.companyId,
    ]);
    const record = await recordById(actor, body.meetingId, "meeting", tx, true);
    if (record.data.createdBy !== actor.userId && actor.role !== "owner")
      fail("Only the recorder or owner can attach audio", 403);
    const id = body.uploadId || randomUUID();
    let upload = (
      await tx.query<{
        parts: string[];
        total_parts: number;
        status: string;
        duration: number;
        mime: string;
        filename: string;
      }>(
        "SELECT * FROM audio_uploads WHERE id=$1 AND company_id=$2 AND meeting_id=$3 AND user_id=$4 FOR UPDATE",
        [id, actor.companyId, body.meetingId, actor.userId],
      )
    ).rows[0];
    if (!upload) {
      if (body.part !== 0 || body.uploadId)
        fail("Start a new audio upload from part zero");
      const mime = audioMime(body.filename, bytes);
      await tx.query(
        "INSERT INTO audio_uploads(id,company_id,meeting_id,user_id,total_parts,duration,mime,filename) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          id,
          actor.companyId,
          body.meetingId,
          actor.userId,
          body.total,
          body.duration,
          mime,
          body.filename,
        ],
      );
      upload = {
        parts: [],
        total_parts: body.total,
        status: "Pending",
        duration: body.duration,
        mime,
        filename: body.filename,
      };
    }
    if (
      upload.status !== "Pending" ||
      upload.total_parts !== body.total ||
      upload.parts.length !== body.part
    )
      fail("Audio part is out of order or already saved", 409);
    const storage = Number(
      (
        await tx.query<{ size: string }>(
          "SELECT coalesce(sum(size),0) AS size FROM files WHERE company_id=$1",
          [actor.companyId],
        )
      ).rows[0].size,
    );
    if (
      storage + bytes.length >
      Number(process.env.COMPANY_STORAGE_MAX_BYTES || maxBytes)
    )
      fail("Workspace storage is full", 413);
    const fileId = randomUUID();
    await tx.query(
      "INSERT INTO files(id,company_id,uploaded_by,filename,mime,bytes,size) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        fileId,
        actor.companyId,
        actor.userId,
        body.filename + ".part" + body.part,
        upload.mime,
        bytes,
        bytes.length,
      ],
    );
    const parts = [...upload.parts, fileId],
      complete = parts.length === body.total;
    await tx.query("UPDATE audio_uploads SET parts=$1,status=$2 WHERE id=$3", [
      JSON.stringify(parts),
      complete ? "Complete" : "Pending",
      id,
    ]);
    if (complete) {
      const tracks = (record.data.audioTracks as Data[]) || [];
      if (
        tracks.reduce((n, t) => n + Number(t.duration), 0) + upload.duration >
        10800
      )
        fail("Meeting audio cannot exceed three hours");
      const data = {
        ...record.data,
        audioIds: [...((record.data.audioIds as string[]) || []), ...parts],
        audioTracks: [
          ...tracks,
          {
            id,
            parts,
            duration: upload.duration,
            mime: upload.mime,
            filename: upload.filename,
          },
        ],
      };
      await tx.query(
        "UPDATE hr_records SET data=$1,updated_at=now() WHERE company_id=$2 AND id=$3",
        [JSON.stringify(data), actor.companyId, record.id],
      );
      await audit(tx, actor, "Attached meeting audio", record.id, {
        duration: upload.duration,
      });
    }
    return { uploadId: id, complete };
  });
}
export async function audioResponse(
  id: string,
  actor: Actor | { companyId: string },
  range: string | null = null,
) {
  const upload = (
    await db.query<{
      meeting_id: string;
      parts: string[];
      mime: string;
      filename: string;
      status: string;
    }>("SELECT * FROM audio_uploads WHERE id=$1 AND company_id=$2", [
      id,
      actor.companyId,
    ])
  ).rows[0];
  if (!upload || upload.status !== "Complete") fail("Audio unavailable", 404);
  if (
    "userId" in actor &&
    !(await visibleRecords(actor)).some((r) => r.id === upload.meeting_id)
  )
    fail("Audio unavailable", 404);
  const sizes = (
    await db.query<{ id: string; size: number }>(
      "SELECT id,size FROM files WHERE company_id=$1 AND id=ANY($2::uuid[])",
      [actor.companyId, upload.parts],
    )
  ).rows;
  const total = upload.parts.reduce(
    (n, id) => n + (sizes.find((s) => s.id === id)?.size || 0),
    0,
  );
  let start = 0,
    end = total - 1,
    status = 200;
  if (range) {
    const match = range.match(/^bytes=(\d+)-(\d*)$/);
    if (match) {
      start = Number(match[1]);
      end = Math.min(match[2] ? Number(match[2]) : end, end);
      status = 206;
      if (start > end || start >= total)
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${total}` },
        });
    }
  }
  let offset = 0;
  const selected = upload.parts
    .map((id) => {
      const size = sizes.find((s) => s.id === id)?.size || 0,
        part = { id, offset, size };
      offset += size;
      return part;
    })
    .filter((p) => p.offset + p.size > start && p.offset <= end);
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const part = selected[index++];
        if (!part) {
          controller.close();
          return;
        }
        const row = (
          await db.query<{ bytes: Buffer }>(
            "SELECT bytes FROM files WHERE company_id=$1 AND id=$2",
            [actor.companyId, part.id],
          )
        ).rows[0];
        controller.enqueue(
          new Uint8Array(row.bytes).subarray(
            Math.max(0, start - part.offset),
            Math.min(part.size, end - part.offset + 1),
          ),
        );
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return new Response(stream, {
    status,
    headers: {
      "Content-Type": upload.mime,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      ...(status === 206
        ? { "Content-Range": `bytes ${start}-${end}/${total}` }
        : {}),
    },
  });
}
export async function transcribeMeeting(actor: Actor, input: unknown) {
  const { id, language } = z
    .object({
      id: z.uuid(),
      language: z.enum(["auto", "ms", "en"]).default("auto"),
    })
    .parse(input);
  const record = (await visibleRecords(actor)).find(
    (r) => r.id === id && r.kind === "meeting",
  );
  if (!record) fail("Meeting unavailable", 404);
  if (record.data.createdBy !== actor.userId && actor.role !== "owner")
    fail("Only the recorder or owner can transcribe", 403);
  const tracks = (record.data.audioTracks as Data[]) || [];
  if (!tracks.length) fail("Attach audio first");
  const base = process.env.MEDIA_WORKER_URL,
    key = process.env.MEDIA_WORKER_API_KEY,
    app = process.env.APP_URL;
  if (!base || !key || !app)
    fail(
      "Audio is saved. Configure the transcription worker to process it.",
      503,
    );
  const url = new URL(base);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:")
    fail("Media worker must use HTTPS", 503);
  const jobId = randomUUID(),
    plain = token();
  await transaction(async (tx) => {
    await tx.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
      actor.companyId,
    ]);
    if (
      (
        await tx.query(
          "SELECT id FROM media_jobs WHERE company_id=$1 AND meeting_id=$2 AND status IN ('Pending','Running')",
          [actor.companyId, id],
        )
      ).rows.length
    )
      fail("Transcription is already in progress", 409);
    await tx.query(
      "INSERT INTO media_jobs(id,company_id,meeting_id,callback_hash,audio_ids,language) VALUES($1,$2,$3,$4,$5,$6)",
      [
        jobId,
        actor.companyId,
        id,
        hashToken(plain),
        JSON.stringify(tracks.map((t) => t.id)),
        language,
      ],
    );
  });
  try {
    const response = await fetch(base.replace(/\/$/, "") + "/transcribe", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jobId,
        callbackToken: plain,
        callbackUrl: app.replace(/\/$/, "") + "/api/media/jobs/" + jobId,
        tracks: tracks.map((t, i) => ({
          url:
            app.replace(/\/$/, "") +
            "/api/media/jobs/" +
            jobId +
            "/audio?track=" +
            i,
        })),
        language,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("Worker refused job");
    await db.query(
      "UPDATE media_jobs SET status='Running',updated_at=now() WHERE id=$1 AND status='Pending'",
      [jobId],
    );
    return { jobId, status: "Running" };
  } catch {
    await db.query(
      "UPDATE media_jobs SET status='Failed',error='Worker unavailable',updated_at=now() WHERE id=$1",
      [jobId],
    );
    fail(
      "Transcription worker is unavailable. Audio is saved; retry later.",
      502,
    );
  }
}
export async function workerJob(id: string, bearer: string) {
  z.uuid().parse(id);
  const job = (
    await db.query<{
      id: string;
      company_id: string;
      meeting_id: string;
      audio_ids: string[];
      status: string;
    }>(
      "SELECT * FROM media_jobs WHERE id=$1 AND callback_hash=$2 AND created_at>now()-interval '6 hours'",
      [id, hashToken(bearer)],
    )
  ).rows[0];
  if (!job || !["Pending", "Running"].includes(job.status))
    fail("Media job unavailable", 403);
  return job;
}
export async function finishTranscription(
  id: string,
  bearer: string,
  input: unknown,
) {
  const data = z
    .object({
      status: z.enum(["Complete", "Failed"]),
      error: z.string().max(500).optional(),
      segments: z
        .array(
          z
            .object({
              start: z.number().min(0).max(10800),
              end: z.number().min(0).max(10800),
              speaker: z.string().max(100).default("Unlabelled"),
              text: z.string().max(24000),
            })
            .refine((s) => s.end >= s.start),
        )
        .max(10000)
        .default([]),
    })
    .parse(input);
  const job = await workerJob(id, bearer);
  return transaction(async (tx) => {
    const locked = (
      await tx.query<{ status: string }>(
        "SELECT status FROM media_jobs WHERE id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0];
    if (!["Pending", "Running"].includes(locked.status))
      fail("Callback already processed", 409);
    const meeting = (
      await tx.query<HRRecord>(
        "SELECT * FROM hr_records WHERE id=$1 AND company_id=$2 FOR UPDATE",
        [job.meeting_id, job.company_id],
      )
    ).rows[0];
    if (data.status === "Complete") {
      const transcript = data.segments
        .map((s) => `${s.speaker}: ${s.text}`)
        .join("\n");
      if (transcript.length > 300000) fail("Transcript is too long");
      await tx.query(
        "UPDATE hr_records SET data=$1,updated_at=now() WHERE id=$2 AND company_id=$3",
        [
          JSON.stringify({
            ...meeting.data,
            segments: data.segments,
            transcript,
          }),
          meeting.id,
          job.company_id,
        ],
      );
    }
    await tx.query(
      "UPDATE media_jobs SET status=$1,result=$2,error=$3,updated_at=now() WHERE id=$4",
      [
        data.status,
        JSON.stringify({ segments: data.segments.length }),
        data.status === "Failed"
          ? "Transcription failed; check worker logs"
          : null,
        id,
      ],
    );
    await tx.query(
      "INSERT INTO audit_log(id,company_id,action,entity_id) VALUES($1,$2,'Processed meeting transcription',$3)",
      [randomUUID(), job.company_id, meeting.id],
    );
    return { ok: true };
  });
}
export async function mediaStatus(actor: Actor, id: string) {
  if (
    !(await visibleRecords(actor)).some(
      (r) => r.id === id && r.kind === "meeting",
    )
  )
    fail("Meeting unavailable", 404);
  return normalize(
    (
      await db.query(
        "SELECT id,status,error,created_at FROM media_jobs WHERE company_id=$1 AND meeting_id=$2 ORDER BY created_at DESC LIMIT 3",
        [actor.companyId, id],
      )
    ).rows,
  );
}
