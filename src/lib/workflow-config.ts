import type { Actor, Company, Data } from "./types";
export const payrollCapabilities = [
  "read",
  "prepare",
  "approve",
  "pay",
] as const;
export type PayrollCapability = (typeof payrollCapabilities)[number];
export function hasPayroll(
  actor: Pick<Actor, "role" | "payrollAccess">,
  capability: PayrollCapability = "read",
) {
  if (actor.role === "owner") return true;
  const permissions =
    actor.payrollAccess ??
    (actor.role === "hr" ? [...payrollCapabilities] : []);
  return capability === "read"
    ? permissions.length > 0
    : permissions.includes(capability);
}
export const defaultEmployeeStatuses = [
  { name: "Active", access: "Active" as const },
  { name: "Onboarding", access: "Onboarding" as const },
  { name: "Probation", access: "Active" as const },
  { name: "Confirmed", access: "Active" as const },
  { name: "Resigned", access: "Archived" as const },
  { name: "Archived", access: "Archived" as const },
];
export const specialistNames = [
  "leave",
  "claims",
  "attendance",
  "recruitment",
  "performance",
  "payroll",
  "letters",
] as const;
export type Specialist = (typeof specialistNames)[number];
export const specialistLabels: Record<Specialist, string> = {
  leave: "Leave",
  claims: "Claims & overtime",
  attendance: "Attendance",
  recruitment: "Recruitment",
  performance: "Performance",
  payroll: "Payroll",
  letters: "Letters",
};
export const aiTools = [
  "read",
  "review",
  "create-leave",
  "create-claim",
  "clock",
  "candidate-stage",
  "letter-draft",
  "configure",
] as const;
export type AITool = (typeof aiTools)[number];
export const defaultSpecialists = Object.fromEntries(
  specialistNames.map((name) => [
    name,
    {
      enabled: true,
      tools:
        name === "leave"
          ? ["read", "review", "create-leave"]
          : name === "claims"
            ? ["read", "review", "create-claim"]
            : name === "attendance"
              ? ["read", "review", "clock"]
              : name === "recruitment"
                ? ["read", "candidate-stage"]
                : name === "performance"
                  ? ["read", "review"]
                  : name === "letters"
                    ? ["read", "letter-draft"]
                    : ["read"],
    },
  ]),
) as Record<Specialist, { enabled: boolean; tools: AITool[] }>;
export function specialistFor(action: string, kind?: string): Specialist {
  if (action === "clock") return "attendance";
  if (action === "configure") return "attendance";
  if (action === "candidate-stage") return "recruitment";
  if (action === "letter-draft") return "letters";
  if (action === "create-leave" || kind === "leave") return "leave";
  if (
    action === "create-claim" ||
    ["claim", "overtime", "time_off"].includes(kind || "")
  )
    return "claims";
  if (kind === "goal_update") return "performance";
  return "attendance";
}
export function specialistAllows(
  settings: Company["settings"],
  specialist: Specialist,
  tool: string,
) {
  const policy =
    settings.aiSpecialists?.[specialist] || defaultSpecialists[specialist];
  return policy.enabled && policy.tools.includes(tool);
}
export function employmentLabel(data: Data) {
  return String(data.employmentStatus || data.status || "Active");
}

export const specialistKinds: Record<Specialist, string[]> = {
  leave: ["leave", "leave_type"],
  claims: ["claim", "claim_type", "overtime", "time_off"],
  attendance: [
    "attendance",
    "attendance_correction",
    "lateness",
    "shift",
    "location",
  ],
  recruitment: [
    "job",
    "candidate",
    "interview",
    "assessment",
    "assessment_result",
  ],
  performance: ["goal", "goal_update", "review_cycle", "evaluation"],
  payroll: ["payroll", "payroll_run", "payment_voucher", "job_history"],
  letters: ["letter", "letter_template"],
};
export function modeSpecialist(mode: string): Specialist | undefined {
  if (["recruit", "resume", "preferences"].includes(mode)) return "recruitment";
  return specialistNames.includes(mode as Specialist)
    ? (mode as Specialist)
    : undefined;
}
export function aiRecordAllowed(settings: Company["settings"], kind: string) {
  const specialist = specialistNames.find((name) =>
    specialistKinds[name].includes(kind),
  );
  return !specialist || specialistAllows(settings, specialist, "read");
}
