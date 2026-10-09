import { getActor, assertOrigin } from "@/lib/auth";
import { workspace, recordPage } from "@/lib/hr";
import { saveCompanyConfig } from "@/lib/company-config";
import { handle } from "@/lib/errors";
import { jsonBody } from "@/lib/request";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handle(async () =>
    Response.json(
      new URL(request.url).searchParams.has("cursor")
        ? await recordPage(
            await getActor(),
            new URL(request.url).searchParams.get("cursor"),
          )
        : await workspace(await getActor()),
      {
        headers: { "Cache-Control": "private, no-store" },
      },
    ),
  );
}
export async function PATCH(request: Request) {
  return handle(async () => {
    assertOrigin(request);
    return Response.json(
      await saveCompanyConfig(await getActor(), await jsonBody(request)),
    );
  });
}
