import {
  Users,
  Clock3,
  Wallet,
  Target,
  BriefcaseBusiness,
  BookOpen,
} from "lucide-react";
import type { Page } from "./workspace-context";
import type { Actor } from "@/lib/types";
import { isStaff } from "@/lib/types";
import { hasPayroll } from "@/lib/workflow-config";
export const hubs = [
  {
    label: "People",
    icon: Users,
    items: [
      { page: "people", label: "Employees" },
      { page: "employee-files", label: "Files & lifecycle" },
    ],
  },
  {
    label: "Time & leave",
    icon: Clock3,
    items: [
      { page: "attendance", label: "Attendance & shifts" },
      { page: "leave", label: "Leave" },
      { page: "work-requests", label: "Time requests" },
      { page: "calendar", label: "Team calendar" },
    ],
  },
  {
    label: "Pay & claims",
    icon: Wallet,
    items: [
      { page: "claims", label: "Claims" },
      { page: "payroll", label: "Payroll & payslips" },
      { page: "payments", label: "Payments" },
    ],
  },
  {
    label: "Performance",
    icon: Target,
    items: [
      { page: "performance", label: "Goals & evaluations" },
      { page: "reviews", label: "Review cycles" },
    ],
  },
  {
    label: "Hiring",
    icon: BriefcaseBusiness,
    items: [
      { page: "recruitment", label: "Recruitment" },
      { page: "assessments", label: "Assessments" },
    ],
  },
  {
    label: "Knowledge",
    icon: BookOpen,
    items: [
      { page: "policies", label: "Company handbook" },
      { page: "meetings", label: "Meeting notes" },
      { page: "announcements", label: "Announcements" },
    ],
  },
] as const;
export function canOpenPage(actor: Actor, page: Page) {
  return page === "payments"
    ? hasPayroll(actor)
    : page === "recruitment"
      ? isStaff(actor)
      : true;
}
export function hubFor(page: Page) {
  return hubs.find((h) => h.items.some((item) => item.page === page));
}
