import { z } from "zod";
import { transaction } from "./db";
import { audit } from "./auth";
import { recordById, validateReferences, normalize } from "./hr";
import { schemas } from "./schema";
import { claimBalance } from "./policies";
import { notify } from "./notifications";
import { fail } from "./errors";
import type { Actor, Data, HRRecord } from "./types";
export async function resubmitClaim(actor: Actor, input: unknown) {
  const body = z
    .object({
      id: z.uuid(),
      updatedAt: z.string().min(1),
      data: z.record(z.string(), z.unknown()),
    })
    .parse(input);
  return transaction(async (tx) => {
    await tx.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
      actor.companyId,
    ]);
    const claim = await recordById(actor, body.id, "claim", tx, true);
    const employee = await recordById(
      actor,
      claim.employee_id!,
      "employee",
      tx,
      true,
    );
    if (
      claim.employee_id !== actor.employeeId &&
      employee.data.email !== actor.email
    )
      fail("Only the claimant can resubmit", 403);
    if (claim.data.status !== "Returned" || claim.updated_at !== body.updatedAt)
      fail("This claim changed or is not awaiting correction", 409);
    if (((claim.data.history as unknown[]) || []).length >= 198)
      fail("This claim has reached its revision limit");
    // Pick editable fields so clients cannot forge history, review decisions or payment links.
    const editable = Object.fromEntries(
      [
        "category",
        "claimTypeId",
        "mileageKm",
        "date",
        "amount",
        "description",
        "receiptId",
      ]
        .filter((k) => k in body.data)
        .map((k) => [k, body.data[k]]),
    );
    const data = schemas.claim.parse({
      ...claim.data,
      ...editable,
      status: "Pending",
      reviewedBy: null,
      reviewNote: "",
      approvalStep: 0,
      history: [
        ...((claim.data.history as unknown[]) || []),
        {
          at: new Date().toISOString(),
          by: actor.name,
          actorId: actor.userId,
          action: "Resubmitted",
          note: "",
          snapshot: editable,
        },
      ],
    }) as Data;
    await validateReferences(
      tx,
      actor,
      "claim",
      data,
      claim.employee_id,
      claim.id,
    );
    await claimBalance(tx, actor, employee, data, claim.id);
    const result = (
      await tx.query<HRRecord>(
        "UPDATE hr_records SET data=$1,updated_at=now() WHERE company_id=$2 AND id=$3 RETURNING *",
        [JSON.stringify(data), actor.companyId, claim.id],
      )
    ).rows[0];
    await audit(tx, actor, "Resubmitted claim", claim.id);
    await notify(
      tx,
      actor,
      "Claim resubmitted",
      `${actor.name} corrected a returned claim.`,
      "/?view=claims",
      claim.employee_id!,
      true,
    );
    return normalize(result);
  });
}
