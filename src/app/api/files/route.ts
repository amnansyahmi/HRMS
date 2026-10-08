import { getActor, assertOrigin, rateLimit } from "@/lib/auth";
import { uploadFile } from "@/lib/files";
import { handle, fail } from "@/lib/errors";
import { readBody } from "@/lib/request";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handle(async () => {
    assertOrigin(request);
    const actor = await getActor();
    await rateLimit(`upload:${actor.companyId}:${actor.userId}`, 20, 3600);
    const bytes = await readBody(request, 2200000);
    const form = await new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": request.headers.get("content-type") || "" },
      body: new Uint8Array(bytes),
    }).formData();
    const file = form.get("file");
    if (!(file instanceof File)) fail("Choose a file");
    return Response.json(await uploadFile(actor, file), { status: 201 });
  });
}
