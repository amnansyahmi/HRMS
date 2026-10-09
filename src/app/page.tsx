import { demoEnabled } from "@/lib/auth";
import { WorkspaceApp } from "@/components/workspace-app";
import { appUrlIssue } from "@/lib/deployment-config";
export const dynamic = "force-dynamic";
export default function Home() {
  return <WorkspaceApp demo={demoEnabled()} setupIssue={appUrlIssue()} />;
}
