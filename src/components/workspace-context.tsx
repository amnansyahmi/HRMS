"use client";
import { createContext, useContext } from "react";
import type { Workspace, Kind, HRRecord } from "@/lib/types";
export type Page =
  | "approvals"
  | "calendar"
  | "my-profile"
  | "overview"
  | "people"
  | "attendance"
  | "leave"
  | "claims"
  | "payroll"
  | "performance"
  | "recruitment"
  | "assessments"
  | "meetings"
  | "policies"
  | "assistant"
  | "settings"
  | "employee-files"
  | "work-requests"
  | "hr-policies"
  | "reviews"
  | "announcements"
  | "payments";
export interface WorkspaceContextValue {
  workspace: Workspace;
  refresh: () => Promise<void>;
  go: (page: Page) => void;
  edit: (kind: Kind, record?: HRRecord) => void;
  ask: (mode?: string, recordId?: string, message?: string) => void;
  act: (action: string, body: unknown, message?: string) => Promise<unknown>;
}
export const WorkspaceContext = createContext<WorkspaceContextValue | null>(
  null,
);
export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("Workspace context required");
  return value;
}
