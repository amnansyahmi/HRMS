import { getActor } from "@/lib/auth";
import { accountStatus } from "@/lib/account";
import { handle } from "@/lib/errors";
export async function GET() {
  return handle(async () =>
    Response.json(await accountStatus(await getActor())),
  );
}
