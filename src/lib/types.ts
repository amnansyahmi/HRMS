export const kinds = [
  "employee",
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
}
export interface Company {
  id: string;
  name: string;
  slug: string;
  settings: {
    timezone: string;
    workDays: number[];
    holidays: string[];
    aiEnabled: boolean;
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
}
export const staffRoles: Role[] = ["owner", "hr"];
export function isStaff(actor: Pick<Actor, "role">) {
  return staffRoles.includes(actor.role);
}
