import { assertOrigin } from "@/lib/auth";
import { onboarding, saveOnboarding } from "@/lib/operations";
import { handle } from "@/lib/errors";
import { jsonBody, readBody } from "@/lib/request";
export const runtime = "nodejs";
type Context = { params: Promise<{ token: string }> };
export async function GET(_: Request, { params }: Context) {
  return handle(async () =>
    Response.json(await onboarding((await params).token)),
  );
}
export async function POST(request: Request, { params }: Context) {
  return handle(async () => {
    assertOrigin(request);
    const plain = (await params).token;
    if (
      request.headers.get("content-type")?.startsWith("multipart/form-data")
    ) {
      const bytes = await readBody(request, 2200000);
      const form = await new Request(request.url, {
        method: "POST",
        headers: { "Content-Type": request.headers.get("content-type")! },
        body: new Uint8Array(bytes),
      }).formData();
      const file = form.get("file");
      return Response.json(
        await saveOnboarding(
          plain,
          {},
          file instanceof File ? file : undefined,
          String(form.get("type") || ""),
        ),
      );
    }
    return Response.json(await saveOnboarding(plain, await jsonBody(request)));
  });
}
