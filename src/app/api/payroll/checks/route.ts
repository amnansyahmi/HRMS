import { getActor } from "@/lib/auth";
import { payrollDiagnostics } from "@/lib/payroll-diagnostics";
import { handle } from "@/lib/errors";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handle(async () => {
    const params = new URL(request.url).searchParams;
    return Response.json(
      await payrollDiagnostics(await getActor(), {
        period: params.get("period"),
        runId: params.get("runId") || undefined,
      }),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
