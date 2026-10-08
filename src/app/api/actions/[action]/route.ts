import { getActor, assertOrigin } from "@/lib/auth";
import {
  clock,
  reviewRequest,
  generatePayroll,
  publishPayroll,
} from "@/lib/hr";
import { inviteAssessment } from "@/lib/recruitment";
import { handle, fail } from "@/lib/errors";
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
    if (action === "clock") return Response.json(await clock(actor, body));
    if (action === "review")
      return Response.json(await reviewRequest(actor, body));
    if (action === "payroll-generate")
      return Response.json(await generatePayroll(actor, body));
    if (action === "payroll-publish")
      return Response.json(await publishPayroll(actor, body));
    if (action === "assessment-invite")
      return Response.json(await inviteAssessment(actor, body));
    fail("Action not found", 404);
  });
}
