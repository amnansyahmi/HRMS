import { assertOrigin } from "@/lib/auth";
import { publicAssessment, submitAssessment } from "@/lib/recruitment";
import { handle } from "@/lib/errors";
import { jsonBody } from "@/lib/request";
export const runtime = "nodejs";
type Context = { params: Promise<{ token: string }> };
export async function GET(_: Request, { params }: Context) {
  return handle(async () =>
    Response.json(await publicAssessment((await params).token), {
      headers: { "Cache-Control": "no-store" },
    }),
  );
}
export async function POST(request: Request, { params }: Context) {
  return handle(async () => {
    assertOrigin(request);
    return Response.json(
      await submitAssessment((await params).token, await jsonBody(request)),
    );
  });
}
