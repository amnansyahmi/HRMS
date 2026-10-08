import { demoEnabled } from "@/lib/auth";
import { WorkspaceApp } from "@/components/workspace-app";
export const dynamic = "force-dynamic";
export default function Home() {
  return <WorkspaceApp demo={demoEnabled()} />;
}
