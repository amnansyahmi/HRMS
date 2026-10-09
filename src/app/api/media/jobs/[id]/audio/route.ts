import { workerJob, audioResponse } from "@/lib/media";
import { handle, fail } from "@/lib/errors";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const job = await workerJob(
        (await params).id,
        request.headers.get("authorization")?.replace(/^Bearer /, "") || "",
      ),
      track = Number(new URL(request.url).searchParams.get("track") || 0);
    if (!Number.isInteger(track) || !job.audio_ids[track])
      fail("Audio track unavailable", 404);
    return audioResponse(
      job.audio_ids[track],
      { companyId: job.company_id },
      request.headers.get("range"),
    );
  });
}
