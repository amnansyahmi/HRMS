import { randomUUID } from "node:crypto";
import { db, transaction } from "./db";
import { getCompany } from "./auth";
import { fail } from "./errors";
import type { Actor, Company } from "./types";
export function selectAIRoute(
  settings: Company["settings"],
  mode: string,
  hasDocuments = false,
  hasImages = false,
) {
  const routing = settings.aiRouting;
  const analysis =
    hasDocuments ||
    ["resume", "meeting", "recruit", "recruitment", "letters", "chro", "preferences"].includes(mode);
  const model =
    (hasImages
      ? routing?.visionModel
      : analysis
        ? routing?.analysisModel
        : routing?.generalModel) ||
    process.env.AI_NONYMAUZ_MODEL?.trim() ||
    "";
  if (hasImages && !routing?.visionModel)
    fail(
      "The owner must choose a vision model in AI settings before images can be sent",
      503,
    );
  return { model, mode: hasImages ? "vision" : analysis ? "deep" : "normal" };
}
export async function reserveAIUsage(
  actor: Actor,
  mode: string,
  model: string,
) {
  return transaction(async (tx) => {
    await tx.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
      actor.companyId,
    ]);
    const company = await getCompany(actor, tx);
    const limit = company.settings.aiRouting?.monthlyRequestLimit || 0;
    const used = Number(
      (
        await tx.query<{ count: string }>(
          "SELECT count(*) AS count FROM ai_usage WHERE company_id=$1 AND created_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'",
          [actor.companyId],
        )
      ).rows[0].count,
    );
    if (limit > 0 && used >= limit)
      fail(
        "This workspace has reached its monthly AI request budget. Ask the owner to review AI usage.",
        429,
      );
    const id = randomUUID();
    await tx.query(
      "INSERT INTO ai_usage(id,company_id,user_id,mode,model,status) VALUES($1,$2,$3,$4,$5,'Pending')",
      [id, actor.companyId, actor.userId, mode, model],
    );
    return id;
  });
}
export async function finishAIUsage(
  id: string,
  status: "Succeeded" | "Failed",
  elapsed: number,
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number },
  errorStatus?: number,
) {
  await db.query(
    "UPDATE ai_usage SET status=$2,response_ms=$3,input_tokens=$4,output_tokens=$5,total_tokens=$6,error_status=$7 WHERE id=$1",
    [
      id,
      status,
      Math.max(0, Math.round(elapsed)),
      usage?.inputTokens ?? null,
      usage?.outputTokens ?? null,
      usage?.totalTokens ?? null,
      errorStatus ?? null,
    ],
  );
}
export async function aiUsage(actor: Actor) {
  if (actor.role !== "owner") fail("Only the owner can view AI usage", 403);
  const rows = (
    await db.query<{
      model: string;
      status: string;
      requests: string;
      input_tokens: string | null;
      output_tokens: string | null;
      total_tokens: string | null;
      reported: string;
      response_ms: string | null;
    }>(
      `SELECT model,status,count(*) AS requests,sum(input_tokens) AS input_tokens,sum(output_tokens) AS output_tokens,sum(total_tokens) AS total_tokens,count(total_tokens) AS reported,round(avg(response_ms)) AS response_ms FROM ai_usage WHERE company_id=$1 AND created_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' GROUP BY model,status ORDER BY model,status`,
      [actor.companyId],
    )
  ).rows;
  return {
    month: new Date().toISOString().slice(0, 7),
    rows,
    requests: rows.reduce((sum, r) => sum + Number(r.requests), 0),
  };
}
