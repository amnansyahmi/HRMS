"use client";
import {
  LayoutDashboard,
  Clock3,
  ClipboardCheck,
  MessageSquare,
  Grid2X2,
} from "lucide-react";
import { pendingDashboardRequests } from "@/lib/dashboard";
import type { Workspace } from "@/lib/types";
import type { Page } from "./workspace-context";

const destinations = [
  { page: "overview", label: "Home", icon: LayoutDashboard },
  { page: "attendance", label: "Time", icon: Clock3 },
  { page: "assistant", label: "Ask AI", icon: MessageSquare },
  { page: "approvals", label: "Inbox", icon: ClipboardCheck },
] as const;
const timePages: Page[] = ["attendance", "leave", "work-requests", "calendar"];
export function MobileNavigation({
  workspace,
  page,
  go,
  open,
  onOpen,
}: {
  workspace: Workspace;
  page: Page;
  go: (page: Page) => void;
  open: boolean;
  onOpen: () => void;
}) {
  const pending = pendingDashboardRequests(workspace).length;
  const inTime = timePages.includes(page);
  const inMenu = !inTime && !destinations.some((item) => item.page === page);
  return (
    <nav className="mobile-bottom-nav" aria-label="Phone navigation">
      {destinations.map((item) => {
        const active =
          item.page === page || (item.page === "attendance" && inTime);
        return (
          <button
            key={item.page}
            className={`${active ? "active" : ""} ${item.page === "assistant" ? "phone-ai" : ""}`}
            aria-current={active ? "page" : undefined}
            onClick={() => go(item.page)}
          >
            <span className="phone-nav-icon">
              <item.icon size={20} aria-hidden="true" />
              {item.page === "approvals" && pending ? (
                <span
                  className="phone-nav-badge"
                  aria-label={`${pending} pending requests`}
                >
                  {pending > 99 ? "99+" : pending}
                </span>
              ) : null}
            </span>
            <span>{item.label}</span>
          </button>
        );
      })}
      <button
        className={inMenu || open ? "active" : ""}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={onOpen}
      >
        <span className="phone-nav-icon">
          <Grid2X2 size={20} aria-hidden="true" />
        </span>
        <span>Menu</span>
      </button>
    </nav>
  );
}
