import { getActor } from "@/lib/auth";
import { audioResponse } from "@/lib/media";
import { handle } from "@/lib/errors";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () =>
    audioResponse(
      (await params).id,
      await getActor(),
      request.headers.get("range"),
    ),
  );
}
