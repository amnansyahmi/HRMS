export const kinds = [
  "profile_change",
  "employee",
  "designation",
  "payroll_run",
  "department",
  "shift",
  "attendance",
  "leave",
  "claim",
  "payroll",
  "goal",
  "job",
  "candidate",
  "assessment",
  "assessment_result",
  "meeting",
  "policy",
  "document",
  "asset",
  "job_history",
  "lifecycle",
  "letter",
  "announcement",
  "location",
  "holiday",
  "overtime",
  "time_off",
  "attendance_correction",
  "lateness",
  "leave_type",
  "claim_type",
  "review_cycle",
  "evaluation_template",
  "evaluation",
  "goal_update",
  "payment_voucher",
] as const;
export type Kind = (typeof kinds)[number];
export type Role = "owner" | "hr" | "manager" | "employee";
export type Data = Record<string, unknown>;
export interface HRRecord {
  id: string;
  company_id: string;
  kind: Kind;
  employee_id: string | null;
  data: Data;
  created_at: string;
  updated_at: string;
}
export interface Actor {
  userId: string;
  companyId: string;
  role: Role;
  employeeId: string | null;
  name: string;
  email: string;
  payrollAccess?: import("./workflow-config").PayrollCapability[] | null;
}
export interface Company {
  id: string;
  name: string;
  slug: string;
  settings: {
    timezone: string;
    workDays: number[];
    holidays: string[];
    overtimeRates: {
      Normal: number;
      "Rest day": number;
      "Public holiday": number;
    };
    employeeStatuses: {
      name: string;
      access: "Active" | "Onboarding" | "Archived";
    }[];
    employeeTypes: string[];
    clockReminderMinutes: number;
    aiSpecialists: Record<
      import("./workflow-config").Specialist,
      { enabled: boolean; tools: string[] }
    >;
    aiEnabled: boolean;
    aiActionsEnabled: boolean;
    aiAgents: {
      hr: boolean;
      recruit: boolean;
      resume: boolean;
      meeting: boolean;
      preferences: boolean;
    };
    careersIntro: string;
    registrationNo: string;
    taxNo: string;
  };
}
export interface Workspace {
  actor: Actor;
  company: Company;
  companies: { id: string; name: string; role: Role }[];
  records: HRRecord[];
  members: {
    user_id: string;
    name: string;
    email: string;
    role: Role;
    employee_id: string | null;
    payroll_access: import("./workflow-config").PayrollCapability[] | null;
  }[];
  audit: {
    id: string;
    action: string;
    actor_name: string;
    created_at: string;
  }[];
  ai: { configured: boolean; enabled: boolean; model: string };
  demo: boolean;
  truncated: boolean;
  nextCursor: string | null;
  notifications: {
    id: string;
    title: string;
    body: string;
    href: string;
    read_at: string | null;
    created_at: string;
  }[];
}
export const staffRoles: Role[] = ["owner", "hr"];
export function isStaff(actor: Pick<Actor, "role">) {
  return staffRoles.includes(actor.role);
}
