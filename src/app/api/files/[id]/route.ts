import { z } from "zod";
import { getActor } from "@/lib/auth";
import { downloadFile } from "@/lib/files";
import { handle } from "@/lib/errors";
export const runtime = "nodejs";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () =>
    downloadFile(await getActor(), z.uuid().parse((await params).id)),
  );
}
