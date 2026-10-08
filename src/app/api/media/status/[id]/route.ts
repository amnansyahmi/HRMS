import { getActor } from "@/lib/auth";
import { mediaStatus } from "@/lib/media";
import { handle } from "@/lib/errors";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () =>
    Response.json(await mediaStatus(await getActor(), (await params).id)),
  );
}
