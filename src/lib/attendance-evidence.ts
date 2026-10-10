import { z } from "zod";
import { fail } from "./errors";
import type { DB } from "./db";
import type { Actor, Company } from "./types";

export const clockEvidenceInput = {
  photoId: z.uuid().nullable().default(null),
  capturedAt: z.iso.datetime().nullable().default(null),
};
export async function attendanceEvidence(
  tx: DB,
  actor: Actor,
  company: Company,
  body: {
    photoId: string | null;
    capturedAt: string | null;
    coordinates: {
      latitude: number;
      longitude: number;
      accuracy: number;
    } | null;
  },
  now: Date,
) {
  if (company.settings.attendanceEvidence?.photoRequired && !body.photoId)
    fail("Take a photo to record attendance");
  if (
    company.settings.attendanceEvidence?.locationRequired &&
    !body.coordinates
  )
    fail("Your workplace requires a fresh phone location");
  if (!body.photoId)
    return {
      photoId: null,
      receivedAt: now.toISOString(),
      coordinates: body.coordinates,
    };
  const file = (
    await tx.query<{ mime: string; size: number; created_at: string }>(
      "SELECT mime,size,created_at FROM files WHERE id=$1 AND company_id=$2 AND uploaded_by=$3",
      [body.photoId, actor.companyId, actor.userId],
    )
  ).rows[0];
  if (
    !file ||
    !["image/png", "image/jpeg"].includes(file.mime) ||
    Number(file.size) > 512000
  )
    fail("Use a fresh attendance photo under 500 KB");
  if (Math.abs(now.getTime() - new Date(file.created_at).getTime()) > 300000)
    fail("This attendance photo has expired. Take another photo.");
  const reused = (
    await tx.query(
      "SELECT id FROM hr_records WHERE company_id=$1 AND kind='attendance' AND (data->'clockInEvidence'->>'photoId'=$2 OR data->'clockOutEvidence'->>'photoId'=$2)",
      [actor.companyId, body.photoId],
    )
  ).rows.length;
  if (reused) fail("Take a new photo for each clock action", 409);
  if (
    !body.capturedAt ||
    Math.abs(now.getTime() - Date.parse(body.capturedAt)) > 300000
  )
    fail("Check your device time and take another photo");
  return {
    photoId: body.photoId,
    capturedAt: body.capturedAt,
    receivedAt: now.toISOString(),
    deviceDriftSeconds: Math.round(
      (now.getTime() - Date.parse(body.capturedAt)) / 1000,
    ),
    coordinates: body.coordinates,
  };
}
