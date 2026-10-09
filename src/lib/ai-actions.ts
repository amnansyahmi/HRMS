import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, transaction } from "./db";
import { getCompany, audit } from "./auth";
import {
  visibleRecords,
  reviewRequest,
  updateRecord,
  createRecord,
} from "./hr";
import { operation } from "./operations";
import { fail } from "./errors";
import type { Actor, Data, HRRecord } from "./types";
export const proposalSchema = z.object({
  action: z.enum([
    "review",
    "candidate-stage",
    "letter-draft",
    "create-leave",
    "create-claim",
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
};
/** Model output is only a proposal. No write tool is supplied to the model. */
export async function saveAIProposal(
  actor: Actor,
  text: string,
  context: HRRecord[],
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
  if (!company.settings.aiActionsEnabled)
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
      !["Approved", "Rejected"].includes(String(proposal.data.decision)))
  )
    return { text: cleaned, cards: [] as ActionCard[] };
  if (
    (proposal.action === "candidate-stage" && record!.kind !== "candidate") ||
    (proposal.action === "letter-draft" && record!.kind !== "employee")
  )
    return { text: cleaned, cards: [] as ActionCard[] };
  const id = randomUUID(),
    expiresAt = new Date(Date.now() + 10 * 60000).toISOString(),
    payload = { ...proposal, expectedUpdatedAt: record?.updated_at || null };
  await db.query(
    "INSERT INTO ai_proposals(id,company_id,user_id,payload,expires_at) VALUES($1,$2,$3,$4,$5)",
    [id, actor.companyId, actor.userId, JSON.stringify(payload), expiresAt],
  );
  return {
    text: cleaned,
    cards: [{ id, label: proposal.label, action: proposal.action, expiresAt }],
  };
}
export async function confirmAIProposal(actor: Actor, input: unknown) {
  const { id } = z.object({ id: z.uuid() }).parse(input);
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
    await tx.query("UPDATE ai_proposals SET status='Applying' WHERE id=$1", [
      id,
    ]);
    return row.payload;
  });
  try {
    const visible = await visibleRecords(actor),
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
