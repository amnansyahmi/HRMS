import { getActor, assertOrigin } from "@/lib/auth";
import { uploadAudioPart } from "@/lib/media";
import { handle, fail } from "@/lib/errors";
import { readBody } from "@/lib/request";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handle(async () => {
    assertOrigin(request);
    const actor = await getActor(),
      bytes = await readBody(request, 2200000),
      form = await new Request(request.url, {
        method: "POST",
        headers: { "Content-Type": request.headers.get("content-type") || "" },
        body: new Uint8Array(bytes),
      }).formData();
    const chunk = form.get("chunk");
    if (!(chunk instanceof File)) fail("Audio part is required");
    return Response.json(
      await uploadAudioPart(
        actor,
        Object.fromEntries(
          Array.from(form.entries()).filter(([k]) => k !== "chunk"),
        ),
        Buffer.from(await chunk.arrayBuffer()),
      ),
    );
  });
}
