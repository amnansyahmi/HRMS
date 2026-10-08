import { timingSafeEqual } from "node:crypto";
import { maintenance } from "@/lib/maintenance";
import { handle, fail } from "@/lib/errors";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  return handle(async () => {
    const expected = process.env.CRON_SECRET
        ? Buffer.from("Bearer " + process.env.CRON_SECRET)
        : null,
      actual = Buffer.from(request.headers.get("authorization") || "");
    if (
      !expected ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    )
      fail("Access denied", 401);
    return Response.json(await maintenance());
  });
}
