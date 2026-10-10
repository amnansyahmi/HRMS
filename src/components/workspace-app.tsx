"use client";
import { MobileNavigation } from "./mobile-navigation";
import { hubs, hubFor, canOpenPage } from "./workspace-navigation";
import { useCallback, useEffect, useState, useRef } from "react";
import dynamic from "next/dynamic";
import {
  LayoutDashboard,
  ClipboardCheck,
  MessageSquare,
  Settings,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  Loader2,
  ArrowUpRight,
  Download,
  ChevronRight,
  ArrowLeft,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AuthScreen } from "./auth-screen";
import { Loading } from "./common";
import { WorkspaceContext, type Page } from "./workspace-context";
import { api, ApiError, initials } from "@/lib/client";
import { type Workspace, type Kind, type HRRecord } from "@/lib/types";
import type { AssistantIntent } from "./assistant-page";
import { toast } from "sonner";
import { NotificationPanel } from "./operations-page";
import { pendingDashboardRequests } from "@/lib/dashboard";
const ApprovalsPage = dynamic(() =>
  import("./approvals-page").then((m) => m.ApprovalsPage),
);
const MyProfilePage = dynamic(() =>
  import("./my-profile-page").then((m) => m.MyProfilePage),
);
const CalendarPage = dynamic(() =>
  import("./calendar-page").then((m) => m.CalendarPage),
);
const OperationsPage = dynamic(() =>
  import("./operations-page").then((m) => m.OperationsPage),
);
const OverviewPage = dynamic(() =>
  import("./overview-page").then((m) => m.OverviewPage),
);
const PeoplePage = dynamic(() =>
  import("./people-page").then((m) => m.PeoplePage),
);
const AttendancePage = dynamic(() =>
  import("./time-pages").then((m) => m.AttendancePage),
);
const RequestsPage = dynamic(() =>
  import("./time-pages").then((m) => m.RequestsPage),
);
const PayrollPage = dynamic(() =>
  import("./payroll-page").then((m) => m.PayrollPage),
);
const PerformancePage = dynamic(() =>
  import("./performance-page").then((m) => m.PerformancePage),
);
const RecruitmentPage = dynamic(() =>
  import("./recruitment-page").then((m) => m.RecruitmentPage),
);
const AssessmentsPage = dynamic(() =>
  import("./assessments-page").then((m) => m.AssessmentsPage),
);
const MeetingsPage = dynamic(() =>
  import("./notes-pages").then((m) => m.MeetingsPage),
);
const PoliciesPage = dynamic(() =>
  import("./notes-pages").then((m) => m.PoliciesPage),
);
const SettingsPage = dynamic(() =>
  import("./settings-page").then((m) => m.SettingsPage),
);
const AssistantPage = dynamic(() =>
  import("./assistant-page").then((m) => m.AssistantPage),
);
const RecordForm = dynamic(() =>
  import("./record-form").then((m) => m.RecordForm),
);
const labels: Record<Page, string> = {
  approvals: "Approval inbox",
  calendar: "Team calendar",
  "my-profile": "My profile",
  "employee-files": "Employee files",
  "work-requests": "Time requests",
  "hr-policies": "HR policies",
  reviews: "Review cycles",
  announcements: "Announcements",
  payments: "Payments",
  overview: "Dashboard",
  people: "People",
  attendance: "Attendance & shifts",
  leave: "Leave",
  claims: "Claims",
  payroll: "Payroll & payslips",
  performance: "Goals & evaluations",
  recruitment: "Recruitment",
  assessments: "Assessments",
  meetings: "Meeting notes",
  policies: "Company handbook",
  assistant: "People AI",
  settings: "Settings",
};
const kindPage: Partial<Record<Kind, Page>> = {
  profile_change: "my-profile",
  document: "employee-files",
  asset: "employee-files",
  lifecycle: "employee-files",
  letter: "employee-files",
  job_history: "employee-files",
  announcement: "announcements",
  overtime: "work-requests",
  time_off: "work-requests",
  lateness: "work-requests",
  attendance_correction: "work-requests",
  goal_update: "work-requests",
  leave_type: "hr-policies",
  claim_type: "hr-policies",
  location: "hr-policies",
  holiday: "hr-policies",
  review_cycle: "reviews",
  evaluation_template: "reviews",
  evaluation: "reviews",
  designation: "people",
  payroll_run: "payroll",
  payment_voucher: "payments",
  employee: "people",
  department: "people",
  shift: "attendance",
  attendance: "attendance",
  leave: "leave",
  claim: "claims",
  payroll: "payroll",
  goal: "performance",
  job: "recruitment",
  candidate: "recruitment",
  assessment: "assessments",
  assessment_result: "assessments",
  meeting: "meetings",
  policy: "policies",
};
function Sidebar({
  workspace,
  page,
  go,
  logout,
  refresh,
  onCollapse,
  mobile = false,
}: {
  workspace: Workspace;
  page: Page;
  go: (p: Page) => void;
  logout: () => void;
  refresh: () => Promise<void>;
  onCollapse?: () => void;
  mobile?: boolean;
}) {
  const pending = pendingDashboardRequests(workspace).length;
  return (
    <div className="sidebar-inner">
      <div className="sidebar-brand">
        <span className="brand-mark">N</span>
        <span>
          Nonymauz <strong>People</strong>
        </span>
        {onCollapse ? (
          <button
            aria-label={mobile ? "Close navigation" : "Close sidebar"}
            onClick={onCollapse}
          >
            {mobile ? <X size={20} /> : <PanelLeftClose size={17} />}
          </button>
        ) : null}
      </div>
      <div className="workspace-picker">
        <span>WORKSPACE</span>
        {workspace.companies.length > 1 ? (
          <select
            aria-label="Switch company"
            value={workspace.company.id}
            onChange={async (e) => {
              try {
                await api("/api/auth/switch", { companyId: e.target.value });
                await refresh();
                go("overview");
              } catch (error) {
                toast.error((error as Error).message);
              }
            }}
          >
            {workspace.companies.map((c) => (
              <option value={c.id} key={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        ) : (
          <strong>{workspace.company.name}</strong>
        )}
      </div>
      <Button
        variant="outline"
        className="sidebar-ai"
        onClick={() => go("assistant")}
      >
        <MessageSquare size={16} />
        Ask People AI
        <ArrowUpRight size={14} />
      </Button>
      <nav aria-label="Workspace navigation">
        <div className="nav-group">
          {(
            [
              { page: "overview", label: "Home", icon: LayoutDashboard },
              {
                page: "approvals",
                label: "Approval inbox",
                icon: ClipboardCheck,
              },
            ] as const
          ).map((item) => (
            <button
              key={item.page}
              className={page === item.page ? "active" : ""}
              aria-current={page === item.page ? "page" : undefined}
              onClick={() => go(item.page)}
            >
              <item.icon size={17} />
              {item.label}
              {item.page === "approvals" && pending ? (
                <small>{pending}</small>
              ) : null}
            </button>
          ))}
        </div>
        <div className="nav-group">
          <span>WORKSPACE</span>
          {hubs.map((hub) => {
            const items = hub.items.filter((item) =>
              canOpenPage(workspace.actor, item.page),
            );
            if (!items.length) return null;
            const active = items.some((item) => item.page === page);
            return (
              <button
                key={hub.label}
                className={active ? "active" : ""}
                aria-current={active ? "page" : undefined}
                onClick={() => go(items[0].page)}
              >
                <hub.icon size={17} />
                {hub.label}
              </button>
            );
          })}
        </div>
      </nav>
      <div className="sidebar-bottom">
        <button
          onClick={() => window.dispatchEvent(new Event("nonymauz-install"))}
        >
          <Download size={17} />
          Install app
        </button>
        <button
          className={page === "settings" ? "active" : ""}
          onClick={() => go("settings")}
        >
          <Settings size={17} />
          Settings
        </button>
        {workspace.demo ? (
          <div className="demo-role">
            <span>DEMO · SAMPLE DATA</span>
            <select
              aria-label="Demo role"
              value={workspace.actor.role}
              onChange={async (e) => {
                try {
                  await api("/api/auth/demo", { role: e.target.value });
                  await refresh();
                  go("overview");
                } catch (error) {
                  toast.error((error as Error).message);
                }
              }}
            >
              {["owner", "hr", "manager", "employee"].map((r) => (
                <option value={r} key={r}>
                  View as {r}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="sidebar-account">
          <button
            className="account-profile-button"
            aria-label="My profile"
            onClick={() => go("my-profile")}
          >
            <span className="account-avatar">
              {initials(workspace.actor.name)}
            </span>
            <div>
              <strong>{workspace.actor.name}</strong>
              <small>{workspace.actor.role}</small>
            </div>
          </button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Sign out"
            onClick={logout}
          >
            <LogOut size={16} />
          </Button>
        </div>
      </div>
    </div>
  );
}
export function WorkspaceApp({
  demo,
  setupIssue,
}: {
  demo: boolean;
  setupIssue?: string | null;
}) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null),
    [state, setState] = useState<"loading" | "auth" | "ready" | "error">(
      "loading",
    ),
    [error, setError] = useState(""),
    [page, setPage] = useState<Page>("overview"),
    [mobileOpen, setMobileOpen] = useState(false),
    [collapsed, setCollapsed] = useState(false),
    [form, setForm] = useState<{
      kind: Kind;
      record?: HRRecord;
      key: number;
    } | null>(null),
    [intent, setIntent] = useState<AssistantIntent>(),
    [searchOpen, setSearchOpen] = useState(false),
    [search, setSearch] = useState(""),
    [acting, setActing] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const requestGeneration = ++generation.current;
    try {
      const data = await api<Workspace>("/api/workspace");
      while (data.nextCursor) {
        if (generation.current !== requestGeneration) return;
        const page = await api<Pick<Workspace, "records" | "nextCursor">>(
          "/api/workspace?cursor=" + encodeURIComponent(data.nextCursor),
        );
        data.records.push(...page.records);
        data.nextCursor = page.nextCursor;
      }
      if (generation.current !== requestGeneration) return;
      setWorkspace(data);
      setState("ready");
    } catch (e) {
      if (generation.current !== requestGeneration) return;
      if (e instanceof ApiError && e.status === 401) {
        setWorkspace(null);
        setState("auth");
      } else {
        setError((e as Error).message);
        setState("error");
      }
    }
  }, []);
  useEffect(() => {
    const pendingRequests = generation;
    void Promise.resolve()
      .then(refresh)
      .then(() => {
        const view = new URLSearchParams(window.location.search).get("view");
        if (view && view in labels) setPage(view as Page);
      });
    return () => {
      pendingRequests.current++;
    };
  }, [refresh]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    const back = () => {
      const view = new URLSearchParams(window.location.search).get("view");
      setPage(view && view in labels ? (view as Page) : "overview");
      setMobileOpen(false);
      setForm(null);
      setSearchOpen(false);
    };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);
  function go(p: Page, replace = false) {
    if (!(p in labels)) return;
    setPage(p);
    setMobileOpen(false);
    if (p === page && !replace) return;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    window.history[replace ? "replaceState" : "pushState"](
      { ...window.history.state, nonymauzPrevious: replace ? undefined : page },
      "",
      p === "overview" ? "/" : `/?view=${p}`,
    );
  }
  function edit(kind: Kind, record?: HRRecord) {
    setForm({ kind, record, key: Date.now() });
  }
  function ask(mode = "hr", recordId?: string, message?: string) {
    setIntent({ mode, recordId, message, key: Date.now() });
    go("assistant");
  }
  async function act(action: string, body: unknown, message?: string) {
    if (acting) return;
    setActing(true);
    try {
      const result = await api(`/api/actions/${action}`, body);
      await refresh();
      if (message) toast.success(message);
      return result;
    } catch (e) {
      toast.error((e as Error).message);
      return undefined;
    } finally {
      setActing(false);
    }
  }
  async function logout() {
    try {
      generation.current++;
      await api("/api/auth/logout", {});
      setWorkspace(null);
      setState("auth");
      setForm(null);
      setIntent(undefined);
      go("overview");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  if (state === "loading") return <Loading />;
  if (state === "auth")
    return (
      <AuthScreen
        demo={demo}
        setupIssue={setupIssue}
        onSuccess={async () => {
          go("overview");
          await refresh();
        }}
      />
    );
  if (state === "error" || !workspace)
    return (
      <div className="error-screen">
        <span className="brand-mark">N</span>
        <h1>We couldn’t open the workspace.</h1>
        <p>{error}</p>
        <Button
          onClick={() => {
            setState("loading");
            void refresh();
          }}
        >
          Try again
        </Button>
      </div>
    );
  const restricted = !canOpenPage(workspace.actor, page),
    visiblePage = restricted ? "overview" : page,
    hub = hubFor(visiblePage);
  const results = search.trim()
    ? workspace.records
        .filter((r) =>
          JSON.stringify(r.data).toLowerCase().includes(search.toLowerCase()),
        )
        .slice(0, 12)
    : [];
  return (
    <WorkspaceContext.Provider
      value={{ workspace, refresh, go, edit, ask, act }}
    >
      <div
        className={`workspace-shell ${collapsed ? "sidebar-collapsed" : ""}`}
      >
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <aside className="sidebar">
          <Sidebar
            workspace={workspace}
            page={visiblePage}
            go={go}
            logout={logout}
            refresh={refresh}
            onCollapse={() => setCollapsed(true)}
          />
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <div>
              {visiblePage === "settings" ||
              visiblePage === "hr-policies" ||
              visiblePage === "my-profile" ? (
                <Button
                  className="mobile-settings-back"
                  variant="ghost"
                  size="icon"
                  aria-label="Back to workspace"
                  onClick={() => {
                    if (window.history.state?.nonymauzPrevious)
                      window.history.back();
                    else go("overview", true);
                  }}
                >
                  <ArrowLeft size={19} />
                </Button>
              ) : null}
              <Button
                className="mobile-menu-button"
                size="icon"
                variant="ghost"
                aria-label="Open navigation"
                onClick={() => setMobileOpen(true)}
              >
                <PanelLeftOpen size={19} />
              </Button>
              {collapsed ? (
                <Button
                  className="desktop-menu-button"
                  size="icon"
                  variant="ghost"
                  aria-label="Open sidebar"
                  onClick={() => setCollapsed(false)}
                >
                  <PanelLeftOpen size={19} />
                </Button>
              ) : null}
              <span className="topbar-workspace">{workspace.company.name}</span>
              <ChevronRight
                className="topbar-divider"
                size={14}
                aria-hidden="true"
              />
              <span className="topbar-title">{labels[visiblePage]}</span>
            </div>
            <div>
              <button
                className="global-search"
                aria-label="Search workspace"
                onClick={() => setSearchOpen(true)}
              >
                <Search size={16} />
                <span>Search</span>
                <kbd>⌘ K</kbd>
              </button>
              {acting ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <span
                  className={`ai-status ${workspace.ai.enabled && workspace.ai.configured ? "enabled" : ""}`}
                >
                  <i />
                  {workspace.ai.enabled && workspace.ai.configured
                    ? "AI enabled"
                    : "AI setup"}
                </span>
              )}
              <NotificationPanel />
              <button
                className="topbar-avatar"
                aria-label="Open settings"
                onClick={() => go("settings")}
              >
                {initials(workspace.actor.name)}
              </button>
            </div>
          </header>
          <MobileNavigation
            workspace={workspace}
            page={visiblePage}
            go={go}
            open={mobileOpen}
            onOpen={() => setMobileOpen(true)}
          />
          {workspace.truncated ? (
            <div className="info-note">
              This workspace view contains the latest 2,000 records. Export or
              add pagination before using it for larger datasets.
            </div>
          ) : null}
          <main
            id="main-content"
            className={
              visiblePage === "assistant"
                ? "main-content chat-content"
                : "main-content"
            }
          >
            {hub ? (
              <nav className="hub-tabs" aria-label={`${hub.label} sections`}>
                {hub.items
                  .filter((item) => canOpenPage(workspace.actor, item.page))
                  .map((item) => (
                    <button
                      key={item.page}
                      aria-current={
                        visiblePage === item.page ? "page" : undefined
                      }
                      className={visiblePage === item.page ? "active" : ""}
                      onClick={() => go(item.page)}
                    >
                      {item.label}
                    </button>
                  ))}
              </nav>
            ) : null}
            {hub ? (
              <div className="context-ai-action">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    ask(
                      visiblePage === "payroll" || visiblePage === "payments"
                        ? "payroll"
                        : visiblePage === "claims"
                          ? "claims"
                          : visiblePage === "recruitment"
                            ? "recruitment"
                            : "hr",
                      undefined,
                      `Help me review ${labels[visiblePage].toLowerCase()} using the records available to me.`,
                    )
                  }
                >
                  <MessageSquare size={16} />
                  Ask AI about this page
                </Button>
              </div>
            ) : null}
            {[
              "employee-files",
              "work-requests",
              "reviews",
              "announcements",
              "payments",
            ].includes(visiblePage) ? (
              <OperationsPage
                key={visiblePage}
                view={visiblePage as import("./operations-page").OperationsView}
              />
            ) : visiblePage === "hr-policies" ? (
              <SettingsPage
                key={workspace.company.id + "-policies"}
                initialSection="policies"
              />
            ) : visiblePage === "overview" ? (
              <OverviewPage
                key={`${workspace.company.id}-${workspace.actor.userId}`}
              />
            ) : visiblePage === "approvals" ? (
              <ApprovalsPage />
            ) : visiblePage === "calendar" ? (
              <CalendarPage />
            ) : visiblePage === "my-profile" ? (
              <MyProfilePage />
            ) : visiblePage === "people" ? (
              <PeoplePage />
            ) : visiblePage === "attendance" ? (
              <AttendancePage />
            ) : visiblePage === "leave" ? (
              <RequestsPage kind="leave" key="leave" />
            ) : visiblePage === "claims" ? (
              <RequestsPage kind="claim" key="claim" />
            ) : visiblePage === "payroll" ? (
              <PayrollPage />
            ) : visiblePage === "performance" ? (
              <PerformancePage />
            ) : visiblePage === "recruitment" ? (
              <RecruitmentPage />
            ) : visiblePage === "assessments" ? (
              <AssessmentsPage />
            ) : visiblePage === "meetings" ? (
              <MeetingsPage />
            ) : visiblePage === "policies" ? (
              <PoliciesPage />
            ) : visiblePage === "assistant" ? (
              <AssistantPage
                key={`${workspace.actor.companyId}-${workspace.actor.userId}-${intent?.key || 0}`}
                intent={intent}
              />
            ) : (
              <SettingsPage key={workspace.company.id} />
            )}
          </main>
        </div>
      </div>
      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogContent
          className="mobile-navigation translate-x-0 translate-y-0"
          showCloseButton={false}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Workspace navigation</DialogTitle>
            <DialogDescription>Choose a page</DialogDescription>
          </DialogHeader>
          <Sidebar
            workspace={workspace}
            page={visiblePage}
            go={go}
            logout={logout}
            refresh={refresh}
            onCollapse={() => setMobileOpen(false)}
            mobile
          />
        </DialogContent>
      </Dialog>
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="search-dialog">
          <DialogHeader>
            <DialogTitle>Search your workspace</DialogTitle>
            <DialogDescription>
              Only records available to your account are searched.
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label="Search workspace records"
            autoFocus
            placeholder="Search people, requests, policies…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="search-results">
            {results.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  go(kindPage[r.kind] || "people");
                  setSearchOpen(false);
                }}
              >
                <span>
                  {String(
                    r.data.name ||
                      r.data.title ||
                      r.data.employeeName ||
                      r.data.description ||
                      r.data.type ||
                      r.kind,
                  )}
                </span>
                <small>{labels[kindPage[r.kind] || "people"]}</small>
              </button>
            ))}
            {search && !results.length ? (
              <p>No matching records.</p>
            ) : !search ? (
              <p>Start typing to find a record.</p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      {form ? (
        <RecordForm
          key={form.key}
          kind={form.kind}
          record={form.record}
          onClose={() => setForm(null)}
        />
      ) : null}
    </WorkspaceContext.Provider>
  );
}
