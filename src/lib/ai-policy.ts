import { fail } from "./errors";
import {
  aiRecordAllowed,
  modeSpecialist,
  specialistAllows,
} from "./workflow-config";
import type { Actor, Company, HRRecord } from "./types";
export function checkAIMode(settings: Company["settings"], mode: string) {
  if (
    !settings.aiEnabled ||
    settings.aiAgents?.[mode as keyof typeof settings.aiAgents] === false
  )
    fail("This assistant is disabled by the workspace owner", 403);
  const specialist = modeSpecialist(mode);
  if (specialist && !specialistAllows(settings, specialist, "read"))
    fail("This specialist is disabled by the workspace owner", 403);
}
export function filterAIRecords(
  settings: Company["settings"],
  records: HRRecord[],
) {
  return records
    .filter((r) => aiRecordAllowed(settings, r.kind))
    .map((r) => {
      if (
        r.kind !== "employee" ||
        specialistAllows(settings, "payroll", "read")
      )
        return r;
      const data = { ...r.data };
      for (const key of [
        "salary",
        "bankName",
        "bankAccount",
        "nric",
        "taxNumber",
        "taxProfileVerified",
        "reliefs",
        "previousEmployment",
        "taxScheme",
        "epfCategory",
      ])
        delete data[key];
      return { ...r, data };
    });
}

export function aiPolicyKey(settings: Company["settings"], actor: Actor) {
  return JSON.stringify({
    specialists: settings.aiSpecialists,
    assistants: settings.aiAgents,
    role: actor.role,
    payrollAccess: actor.payrollAccess ?? null,
  });
}
