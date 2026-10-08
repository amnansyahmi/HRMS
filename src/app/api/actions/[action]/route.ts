import { resubmitClaim } from "@/lib/claims";
import { getActor, assertOrigin } from "@/lib/auth";
import {
  clock,
  recalculatePayroll,
  refreshPayroll,
  reviewRequest,
  generatePayroll,
  publishPayroll,
} from "@/lib/hr";
import { ocrReceipt } from "@/lib/ocr";
import { transcribeMeeting } from "@/lib/media";
import { confirmAIProposal } from "@/lib/ai-actions";
import { operation } from "@/lib/operations";
import { inviteAssessment, createProfileTemplate } from "@/lib/recruitment";
import { handle } from "@/lib/errors";
import { jsonBody } from "@/lib/request";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  return handle(async () => {
    assertOrigin(request);
    const actor = await getActor(),
      body = await jsonBody(request),
      { action } = await params;
    if (action === "claim-resubmit")
      return Response.json(await resubmitClaim(actor, body));
    if (action === "receipt-ocr")
      return Response.json(await ocrReceipt(actor, body));
    if (action === "meeting-transcribe")
      return Response.json(await transcribeMeeting(actor, body));
    if (action === "ai-confirm")
      return Response.json(await confirmAIProposal(actor, body));
    if (action === "clock") return Response.json(await clock(actor, body));
    if (action === "review")
      return Response.json(await reviewRequest(actor, body));
    if (action === "payroll-generate")
      return Response.json(await generatePayroll(actor, body));
    if (action === "payroll-refresh")
      return Response.json(await refreshPayroll(actor, body));
    if (action === "payroll-calculate")
      return Response.json(await recalculatePayroll(actor, body));
    if (action === "payroll-publish")
      return Response.json(await publishPayroll(actor, body));
    if (action === "profile-template")
      return Response.json(await createProfileTemplate(actor, body));
    if (action === "assessment-invite")
      return Response.json(await inviteAssessment(actor, body));
    return Response.json(await operation(actor, action, body));
  });
}
