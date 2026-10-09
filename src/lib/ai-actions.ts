import { checkAIMode, filterAIRecords } from "./ai-policy";
import {
  specialistFor,
  specialistAllows,
  modeSpecialist,
} from "./workflow-config";
import { saveCompanyConfig } from "./company-config";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, transaction } from "./db";
import { getCompany, audit } from "./auth";
import {
  visibleRecords,
  reviewRequest,
  updateRecord,
  createRecord,
  clock,
} from "./hr";
import { operation } from "./operations";
import { fail } from "./errors";
import { isStaff, type Actor, type Data, type HRRecord } from "./types";
import { schemas } from "./schema";
export const proposalSchema = z.object({
  action: z.enum([
    "review",
    "candidate-stage",
    "letter-draft",
    "create-leave",
    "create-claim",
    "clock",
    "configure",
  ]),
  recordId: z.uuid().optional(),
  data: z.record(z.string(), z.unknown()).default({}),
  label: z.string().trim().min(1).max(200),
});
export type ActionCard = {
  id: string;
  label: string;
  action: string;
  expiresAt: string;
  preview: Data;
  requiresLocation: boolean;
};
/** Model output is only a proposal. No write tool is supplied to the model. */
export async function saveAIProposal(
  actor: Actor,
  text: string,
  context: HRRecord[],
  mode = "hr",
) {
  const blocks = [...text.matchAll(/```hr-action\s*([\s\S]*?)```/g)];
  const cleaned = text.replace(/```hr-action\s*[\s\S]*?```/g, "").trim();
  if (mode === "chro") return { text: cleaned, cards: [] as ActionCard[] };
  const cards: ActionCard[] = [],
    targets = new Set<string>();
  for (const block of blocks.slice(0, 5)) {
    const parsed = (() => {
      try {
        return proposalSchema.safeParse(JSON.parse(block[1]));
      } catch {
        return null;
      }
    })();
    if (!parsed?.success) continue;
    const key = parsed.data.recordId || parsed.data.action;
    if (targets.has(key)) continue;
    targets.add(key);
    const result = await saveOneProposal(actor, block[0], context, mode);
    cards.push(...result.cards);
  }
  return {
    text:
      cleaned +
      (blocks.length && !cards.length
        ? "\n\nNo action card was prepared. Check your permissions, enabled tools and required fields before retrying."
        : blocks.length > 5
          ? "\n\nAt most five independent action cards are prepared per reply. Ask again for any remaining changes."
          : ""),
    cards,
  };
}
async function saveOneProposal(
  actor: Actor,
  text: string,
  context: HRRecord[],
  mode = "hr",
) {
  const match = text.match(/```hr-action\s*([\s\S]*?)```/);
  if (!match) return { text, cards: [] as ActionCard[] };
  const cleaned = text.replace(match[0], "").trim();
  let raw: unknown;
  try {
    raw = JSON.parse(match[1]);
  } catch {
    return { text: cleaned, cards: [] as ActionCard[] };
  }
  const parsed = proposalSchema.safeParse(raw);
  if (!parsed.success) return { text: cleaned, cards: [] as ActionCard[] };
  const proposal = parsed.data;
  const company = await getCompany(actor);
  if (!company.settings.aiEnabled || !company.settings.aiActionsEnabled)
    return {
      text:
        cleaned + "\n\nConfirmed AI actions are disabled for this workspace.",
      cards: [] as ActionCard[],
    };
  const record = proposal.recordId
    ? context.find((r) => r.id === proposal.recordId)
    : null;
  if (proposal.recordId && !record)
    return { text: cleaned, cards: [] as ActionCard[] };
  if (
    ["review", "candidate-stage", "letter-draft"].includes(proposal.action) &&
    !record
  )
    return { text: cleaned, cards: [] as ActionCard[] };
  if (
    proposal.action === "review" &&
    (![
      "leave",
      "claim",
      "overtime",
      "time_off",
      "lateness",
      "attendance_correction",
      "goal_update",
    ].includes(record!.kind) ||
      !["Approved", "Rejected", "Returned"].includes(
        String(proposal.data.decision),
      ))
  )
    return { text: cleaned, cards: [] as ActionCard[] };
  if (
    (proposal.action === "candidate-stage" && record!.kind !== "candidate") ||
    (proposal.action === "letter-draft" && record!.kind !== "employee")
  )
    return { text: cleaned, cards: [] as ActionCard[] };
  const specialist = specialistFor(proposal.action, record?.kind);
  if (proposal.action === "letter-draft") {
    const letter = schemas.letter.safeParse({
      ...proposal.data,
      status: "Draft",
    });
    if (!isStaff(actor) || !letter.success)
      return { text: cleaned, cards: [] as ActionCard[] };
    proposal.data = {
      title: letter.data.title,
      type: letter.data.type,
      effectiveDate: letter.data.effectiveDate,
      body: letter.data.body,
    };
  }
  try {
    checkAIMode(company.settings, mode);
  } catch {
    return { text: cleaned, cards: [] as ActionCard[] };
  }
  if (
    !specialistAllows(company.settings, specialist, proposal.action) ||
    (modeSpecialist(mode) && modeSpecialist(mode) !== specialist)
  )
    return { text: cleaned, cards: [] as ActionCard[] };
  if (
    proposal.action === "review" &&
    proposal.data.decision === "Returned" &&
    (record?.kind !== "claim" || !String(proposal.data.note || "").trim())
  )
    return { text: cleaned, cards: [] as ActionCard[] };
  let requiresLocation = false;
  if (proposal.action === "clock") {
    if (company.settings.attendanceEvidence?.photoRequired)
      return {
        text:
          cleaned +
          "\n\nYour workplace requires a photo. Open Attendance & shifts to capture it and record your clock action.",
        cards: [] as ActionCard[],
      };
    if (!actor.employeeId) return { text: cleaned, cards: [] as ActionCard[] };
    const parsedClock = z
      .object({
        action: z.enum(["in", "out"]),
        location: z.enum(["Office", "Remote", "Client site"]).default("Office"),
        locationId: z.uuid().nullable().default(null),
      })
      .safeParse(proposal.data);
    if (!parsedClock.success)
      return { text: cleaned, cards: [] as ActionCard[] };
    proposal.data = parsedClock.data;
    const site = parsedClock.data.locationId
      ? context.find(
          (r) => r.id === parsedClock.data.locationId && r.kind === "location",
        )
      : null;
    if (parsedClock.data.locationId && !site)
      return { text: cleaned, cards: [] as ActionCard[] };
    requiresLocation =
      !!company.settings.attendanceEvidence?.locationRequired ||
      (parsedClock.data.action === "in" && !!site?.data.geofence);
  }
  if (proposal.action === "configure") {
    if (actor.role !== "owner")
      return { text: cleaned, cards: [] as ActionCard[] };
    const config = z
      .object({ clockReminderMinutes: z.number().int().min(0).max(120) })
      .strict()
      .safeParse(proposal.data);
    if (!config.success) return { text: cleaned, cards: [] as ActionCard[] };
    proposal.data = config.data;
  }
  const id = randomUUID(),
    expiresAt = new Date(Date.now() + 10 * 60000).toISOString(),
    payload = {
      ...proposal,
      specialist,
      mode,
      expectedSettings:
        proposal.action === "configure"
          ? JSON.stringify(company.settings)
          : null,
      expectedUpdatedAt: record?.updated_at || null,
    };
  await db.query(
    "INSERT INTO ai_proposals(id,company_id,user_id,payload,expires_at) VALUES($1,$2,$3,$4,$5)",
    [id, actor.companyId, actor.userId, JSON.stringify(payload), expiresAt],
  );
  return {
    text: cleaned,
    cards: [
      {
        id,
        label: proposal.label,
        action: proposal.action,
        expiresAt,
        preview: proposal.data,
        requiresLocation,
      },
    ],
  };
}
export async function cancelAIProposal(actor: Actor, input: unknown) {
  const { id } = z.object({ id: z.uuid() }).parse(input);
  const result = await db.query(
    "UPDATE ai_proposals SET status='Cancelled' WHERE id=$1 AND company_id=$2 AND user_id=$3 AND status='Pending' RETURNING id",
    [id, actor.companyId, actor.userId],
  );
  if (!result.rows.length) fail("This action card is no longer pending", 409);
  return { ok: true };
}
export async function confirmAIProposal(actor: Actor, input: unknown) {
  const { id, coordinates } = z
    .object({
      id: z.uuid(),
      coordinates: z
        .object({
          latitude: z.number().min(-90).max(90),
          longitude: z.number().min(-180).max(180),
          accuracy: z.number().min(0).max(20000),
        })
        .optional(),
    })
    .parse(input);
  const company = await getCompany(actor);
  if (!company.settings.aiEnabled || !company.settings.aiActionsEnabled)
    fail("AI actions are disabled", 403);
  const proposal = await transaction(async (tx) => {
    const row = (
      await tx.query<{ payload: Data }>(
        "SELECT payload FROM ai_proposals WHERE id=$1 AND company_id=$2 AND user_id=$3 AND status='Pending' AND expires_at>now() FOR UPDATE",
        [id, actor.companyId, actor.userId],
      )
    ).rows[0];
    if (!row) fail("This action card expired or was already used", 409);
    checkAIMode(company.settings, String(row.payload.mode || "hr"));
    if (
      !specialistAllows(
        company.settings,
        String(row.payload.specialist || "attendance") as ReturnType<
          typeof specialistFor
        >,
        String(row.payload.action),
      )
    )
      fail("This AI tool is disabled by the workspace owner", 403);
    await tx.query("UPDATE ai_proposals SET status='Applying' WHERE id=$1", [
      id,
    ]);
    return row.payload;
  });
  try {
    const visible = filterAIRecords(
        company.settings,
        await visibleRecords(actor),
      ),
      record = proposal.recordId
        ? visible.find((r) => r.id === proposal.recordId)
        : null;
    if (
      proposal.recordId &&
      (!record || record.updated_at !== proposal.expectedUpdatedAt)
    )
      fail("The record changed. Ask AI to prepare a new card.", 409);
    let result: unknown;
    const data = proposal.data as Data;
    if (proposal.action === "review")
      result = await reviewRequest(actor, {
        id: record!.id,
        decision: data.decision,
        note: data.note || "",
        expectedUpdatedAt: proposal.expectedUpdatedAt,
      });
    else if (proposal.action === "candidate-stage")
      result = await updateRecord(actor, "candidate", record!.id, {
        updatedAt: proposal.expectedUpdatedAt,
        data: { stage: data.stage },
      });
    else if (proposal.action === "letter-draft")
      result = await operation(actor, "letter-draft", {
        id: record!.id,
        expectedUpdatedAt: proposal.expectedUpdatedAt,
        data,
      });
    else if (
      proposal.action === "create-leave" ||
      proposal.action === "create-claim"
    )
      result = await createRecord(
        actor,
        proposal.action === "create-leave" ? "leave" : "claim",
        { employeeId: actor.employeeId, data },
      );
    else if (proposal.action === "clock")
      result = await clock(actor, {
        ...data,
        coordinates: coordinates || null,
      });
    else if (proposal.action === "configure")
      result = await saveCompanyConfig(
        actor,
        { name: company.name, settings: { ...company.settings, ...data } },
        String(proposal.expectedSettings),
      );
    else fail("Unsupported action");
    await transaction(async (tx) => {
      await tx.query(
        "UPDATE ai_proposals SET status='Confirmed' WHERE id=$1 AND company_id=$2",
        [id, actor.companyId],
      );
      await audit(tx, actor, "Confirmed AI action", id, {
        action: proposal.action,
      });
    });
    return { ok: true, result };
  } catch (error) {
    await db.query(
      "UPDATE ai_proposals SET status='Failed' WHERE id=$1 AND company_id=$2",
      [id, actor.companyId],
    );
    throw error;
  }
}
