import { finishTranscription } from "@/lib/media";
import { handle } from "@/lib/errors";
import { readBody } from "@/lib/request";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () =>
    Response.json(
      await finishTranscription(
        (await params).id,
        request.headers.get("authorization")?.replace(/^Bearer /, "") || "",
        JSON.parse((await readBody(request, 1000000)).toString()),
      ),
    ),
  );
}
