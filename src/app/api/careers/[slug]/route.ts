import { assertOrigin } from "@/lib/auth";
import { careers, applyToJob } from "@/lib/recruitment";
import { handle, fail } from "@/lib/errors";
import { jsonBody, readBody } from "@/lib/request";
export const runtime = "nodejs";
type Context = { params: Promise<{ slug: string }> };
export async function GET(_: Request, { params }: Context) {
  return handle(async () => Response.json(await careers((await params).slug)));
}
export async function POST(request: Request, { params }: Context) {
  return handle(async () => {
    assertOrigin(request);
    const { slug } = await params;
    if (
      request.headers.get("content-type")?.startsWith("multipart/form-data")
    ) {
      const bytes = await readBody(request, 2200000),
        form = await new Request(request.url, {
          method: "POST",
          headers: { "Content-Type": request.headers.get("content-type")! },
          body: new Uint8Array(bytes),
        }).formData();
      let data: unknown;
      try {
        data = JSON.parse(String(form.get("data") || "{}"));
      } catch {
        fail("Invalid application");
      }
      const file = form.get("file");
      return Response.json(
        await applyToJob(
          slug,
          data,
          file instanceof File && file.size ? file : undefined,
        ),
        { status: 201 },
      );
    }
    return Response.json(await applyToJob(slug, await jsonBody(request)), {
      status: 201,
    });
  });
}
