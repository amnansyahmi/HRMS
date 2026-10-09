"use client";
import { PayrollAccessControl, SpecialistControls } from "./workflow-settings";
import { PendingInvitations } from "./pending-invitations";
import { SecuritySettings } from "./security-page";
import { SetupStatus } from "./setup-status";
import { useState } from "react";
import {
  Save,
  UserPlus,
  Copy,
  Link2,
  ExternalLink,
  Trash2,
  Loader2,
  Building2,
  Users,
  ShieldCheck,
  MessageSquare,
  SlidersHorizontal,
  History,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useWorkspace } from "./workspace-context";
import { PageHeader, Person, Status, NativeSelect } from "./common";
import { api, shortDate } from "@/lib/client";
import { toast } from "sonner";
export function SettingsPage() {
  const { workspace, refresh } = useWorkspace(),
    owner = workspace.actor.role === "owner",
    [name, setName] = useState(workspace.company.name),
    [settings, setSettings] = useState(workspace.company.settings),
    [holidays, setHolidays] = useState(
      workspace.company.settings.holidays.join("\n"),
    ),
    [statusLines, setStatusLines] = useState(
      workspace.company.settings.employeeStatuses
        .map((s) => `${s.name} | ${s.access}`)
        .join("\n"),
    ),
    [typeLines, setTypeLines] = useState(
      workspace.company.settings.employeeTypes.join("\n"),
    ),
    [busy, setBusy] = useState(false),
    [checking, setChecking] = useState(false),
    [connection, setConnection] = useState<{
      models: string[];
      model: string;
      available: boolean;
    } | null>(null),
    [connectionError, setConnectionError] = useState(""),
    [inviting, setInviting] = useState(false),
    [email, setEmail] = useState(""),
    [role, setRole] = useState("employee"),
    [employeeId, setEmployeeId] = useState(""),
    [inviteLink, setInviteLink] = useState(""),
    [remove, setRemove] = useState<string | null>(null),
    [section, setSection] = useState("general"),
    employees = workspace.records.filter(
      (r) => r.kind === "employee" && r.data.status !== "Archived",
    );
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api(
        "/api/workspace",
        {
          name,
          settings: {
            ...settings,
            employeeStatuses: statusLines
              .split("\n")
              .filter((v) => v.trim())
              .map((v) => {
                const [name, access] = v.split("|").map((s) => s.trim());
                return { name, access };
              }),
            employeeTypes: typeLines
              .split("\n")
              .map((v) => v.trim())
              .filter(Boolean),
            holidays: holidays.split(/\s+/).filter(Boolean),
          },
        },
        "PATCH",
      );
      await refresh();
      toast.success("Settings saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function invite() {
    setBusy(true);
    try {
      const result = await api<{ url: string }>("/api/auth/invite", {
        email,
        role,
        employeeId: employeeId || null,
      });
      setInviteLink(result.url);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function linkMember(userId: string, id: string) {
    setBusy(true);
    try {
      await api("/api/auth/link-member", { userId, employeeId: id || null });
      await refresh();
      toast.success("Employee link updated");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function removeMember() {
    setBusy(true);
    try {
      await api("/api/auth/remove-member", { userId: remove });
      await refresh();
      setRemove(null);
      toast.success("Workspace access removed");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        title="Workspace settings"
        description="Manage your workspace, people and preferences."
      />
      <Tabs
        value={section}
        onValueChange={setSection}
        orientation="vertical"
        className="settings-layout"
      >
        <div className="settings-mobile-menu">
          <Label htmlFor="settings-section">Settings section</Label>
          <select
            id="settings-section"
            className="native-select"
            value={section}
            onChange={(event) => setSection(event.target.value)}
          >
            <option value="general">General</option>
            {owner ? <option value="employees">People rules</option> : null}
            <option value="security">Account security</option>
            {owner ? <option value="access">Team access</option> : null}
            <option value="ai">AI connection</option>
            {owner ? <option value="setup">Deployment setup</option> : null}
            {owner ? <option value="activity">Activity</option> : null}
          </select>
        </div>
        <TabsList className="settings-menu" aria-label="Settings sections">
          <TabsTrigger value="general">
            <Building2 size={17} />
            General
          </TabsTrigger>
          {owner ? (
            <TabsTrigger value="employees">
              <Users size={17} />
              People rules
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="security">
            <ShieldCheck size={17} />
            Account security
          </TabsTrigger>
          {owner ? (
            <TabsTrigger value="access">
              <UserPlus size={17} />
              Team access
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="ai">
            <MessageSquare size={17} />
            AI connection
          </TabsTrigger>
          {owner ? (
            <TabsTrigger value="setup">
              <SlidersHorizontal size={17} />
              Deployment setup
            </TabsTrigger>
          ) : null}
          {owner ? (
            <TabsTrigger value="activity">
              <History size={17} />
              Activity
            </TabsTrigger>
          ) : null}
        </TabsList>
        <div className="settings-body">
          <TabsContent value="employees">
            {owner ? (
              <>
                <section className="settings-panel">
                  <h2>Employee configuration</h2>
                  <p>
                    Add labels such as Probation or Confirmed. Active keeps
                    access; Onboarding marks a joining employee; Archived ends
                    access when applied to an employee. Existing labels cannot
                    be removed while in use.
                  </p>
                  <Label htmlFor="employment-statuses">
                    Employment statuses — name | access behaviour
                  </Label>
                  <Textarea
                    id="employment-statuses"
                    value={statusLines}
                    onChange={(e) => setStatusLines(e.target.value)}
                    rows={7}
                  />
                  <Label htmlFor="employment-types">
                    Employee types — one per line
                  </Label>
                  <Textarea
                    id="employment-types"
                    value={typeLines}
                    onChange={(e) => setTypeLines(e.target.value)}
                    rows={4}
                  />
                  <Label htmlFor="clock-reminder-minutes">
                    Minutes before shift for reminders (0 disables)
                  </Label>
                  <Input
                    id="clock-reminder-minutes"
                    type="number"
                    min={0}
                    max={120}
                    value={settings.clockReminderMinutes}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        clockReminderMinutes: Number(e.target.value),
                      }))
                    }
                  />
                  <p>Save these changes using the button below.</p>
                </section>
              </>
            ) : null}

            {owner ? (
              <Button
                disabled={busy}
                onClick={() =>
                  save({ preventDefault: () => {} } as React.FormEvent)
                }
              >
                <Save size={16} />
                Save settings
              </Button>
            ) : null}
          </TabsContent>
          <TabsContent value="security">
            <SecuritySettings />
          </TabsContent>
          <TabsContent value="general">
            <form className="settings-form" onSubmit={save}>
              <section className="settings-section">
                <h2>Company details</h2>
                <div className="record-form-grid">
                  <div className="form-field full">
                    <Label htmlFor="company-name">Company name</Label>
                    <Input
                      id="company-name"
                      value={name}
                      disabled={!owner}
                      onChange={(e) => setName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-field">
                    <Label htmlFor="registration">Registration number</Label>
                    <Input
                      id="registration"
                      value={settings.registrationNo}
                      disabled={!owner}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          registrationNo: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="form-field">
                    <Label htmlFor="tax-no">Employer tax number</Label>
                    <Input
                      id="tax-no"
                      value={settings.taxNo}
                      disabled={!owner}
                      onChange={(e) =>
                        setSettings((s) => ({ ...s, taxNo: e.target.value }))
                      }
                    />
                  </div>
                  <div className="form-field full">
                    <Label htmlFor="timezone">Time zone</Label>
                    <Input
                      id="timezone"
                      value={settings.timezone}
                      disabled={!owner}
                      onChange={(e) =>
                        setSettings((s) => ({ ...s, timezone: e.target.value }))
                      }
                    />
                  </div>
                </div>
              </section>
              <section className="settings-section">
                <h2>Working calendar</h2>
                <p>
                  Leave requests exclude non-working days and the holidays
                  entered here.
                </p>
                <div className="day-picker">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                    (d, i) => (
                      <Button
                        key={d}
                        type="button"
                        disabled={!owner}
                        size="sm"
                        variant={
                          settings.workDays.includes(i) ? "default" : "outline"
                        }
                        onClick={() =>
                          setSettings((s) => ({
                            ...s,
                            workDays: s.workDays.includes(i)
                              ? s.workDays.filter((day) => day !== i)
                              : [...s.workDays, i],
                          }))
                        }
                      >
                        {d}
                      </Button>
                    ),
                  )}
                </div>
                <div className="record-form-grid">
                  {Object.entries(settings.overtimeRates).map(
                    ([type, rate]) => (
                      <label className="form-field" key={type}>
                        {type} overtime multiplier
                        <Input
                          type="number"
                          step="0.05"
                          min="1"
                          max="10"
                          disabled={!owner}
                          value={rate}
                          onChange={(e) =>
                            setSettings((s) => ({
                              ...s,
                              overtimeRates: {
                                ...s.overtimeRates,
                                [type]: Number(e.target.value),
                              },
                            }))
                          }
                        />
                      </label>
                    ),
                  )}
                </div>
                <div className="form-field">
                  <Label htmlFor="holidays">Company holidays</Label>
                  <Textarea
                    id="holidays"
                    placeholder="2026-12-25&#10;2027-01-01"
                    disabled={!owner}
                    value={holidays}
                    onChange={(e) => setHolidays(e.target.value)}
                  />
                  <small>
                    One date per line, in YYYY-MM-DD format. Add holidays
                    applicable to your company.
                  </small>
                </div>
              </section>
              <section className="settings-section">
                <h2>Career portal</h2>
                <div className="form-field">
                  <Label htmlFor="intro">Company introduction</Label>
                  <Textarea
                    id="intro"
                    value={settings.careersIntro}
                    disabled={!owner}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        careersIntro: e.target.value,
                      }))
                    }
                  />
                </div>
                <a
                  href={`/careers/${workspace.company.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-link"
                >
                  Open your public career page
                  <ExternalLink size={14} />
                </a>
              </section>
              {owner ? (
                <Button disabled={busy} type="submit">
                  {busy ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Save size={15} />
                  )}
                  Save settings
                </Button>
              ) : null}
            </form>
          </TabsContent>
          <TabsContent value="access">
            <div className="table-toolbar">
              <div>
                <h2 className="section-title">Who has access</h2>
                <p className="muted-text">
                  Link each account to an employee with a matching email.
                </p>
              </div>
              <Button
                onClick={() => {
                  setInviting(true);
                  setInviteLink("");
                  setEmail("");
                  setEmployeeId("");
                }}
              >
                <UserPlus size={15} />
                Invite member
              </Button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Role</th>
                    <th>Employee link</th>
                    <th>Payroll permissions</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {workspace.members.map((m) => (
                    <tr key={m.user_id}>
                      <td>
                        <Person name={m.name} detail={m.email} />
                      </td>
                      <td>
                        <Status value={m.role} />
                      </td>
                      <td>
                        <NativeSelect
                          label={`Employee link for ${m.name}`}
                          value={m.employee_id || ""}
                          onChange={(id) => linkMember(m.user_id, id)}
                          options={[
                            { value: "", label: "No employee link" },
                            ...employees
                              .filter((e) => e.data.email === m.email)
                              .map((e) => ({
                                value: e.id,
                                label: String(e.data.name),
                              })),
                          ]}
                        />
                      </td>
                      <td>
                        <PayrollAccessControl member={m} refresh={refresh} />
                      </td>
                      <td>
                        {m.user_id !== workspace.actor.userId &&
                        m.role !== "owner" ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Remove ${m.name} access`}
                            disabled={busy}
                            onClick={() => setRemove(m.user_id)}
                          >
                            <Trash2 size={15} />
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PendingInvitations revision={inviteLink} />
            <div className="role-guide">
              <h3>Access at a glance</h3>
              <p>
                <strong>Owner</strong> manages company settings and access.{" "}
                <strong>HR</strong> manages employees and hiring. Payroll access
                can be limited separately. <strong>Manager</strong> reviews
                their direct team’s requests and goals, with access to their own
                payslips. <strong>Employee</strong> uses self-service and the
                public team directory.
              </p>
            </div>
          </TabsContent>
          <TabsContent value="ai">
            {" "}
            {owner ? (
              <section className="settings-panel">
                <h2>AI assistants</h2>
                <div className="checklist">
                  {[
                    "hr",
                    "recruit",
                    "resume",
                    "meeting",
                    "preferences",
                    "chro",
                  ].map((mode) => (
                    <label key={mode}>
                      <Checkbox
                        checked={
                          settings.aiAgents?.[
                            mode as keyof typeof settings.aiAgents
                          ] !== false
                        }
                        onCheckedChange={(value) =>
                          setSettings((s) => ({
                            ...s,
                            aiAgents: {
                              ...(s.aiAgents || {
                                hr: true,
                                recruit: true,
                                resume: true,
                                meeting: true,
                                preferences: true,
                                chro: false,
                              }),
                              [mode]: value === true,
                            },
                          }))
                        }
                      />
                      <span>
                        {mode === "hr"
                          ? "HR questions"
                          : mode === "chro"
                            ? "Read-only CHRO brief (owner)"
                            : mode === "resume"
                              ? "Resume review"
                              : mode === "preferences"
                                ? "Work preferences"
                                : mode === "meeting"
                                  ? "Meeting summaries"
                                  : "Recruitment"}
                      </span>
                    </label>
                  ))}
                  <label>
                    <Checkbox
                      checked={!!settings.aiActionsEnabled}
                      onCheckedChange={(value) =>
                        setSettings((s) => ({
                          ...s,
                          aiActionsEnabled: value === true,
                        }))
                      }
                    />
                    <span>
                      Allow AI to prepare changes that require human
                      confirmation
                    </span>
                  </label>
                </div>
                <Button
                  disabled={busy}
                  onClick={() =>
                    save({ preventDefault: () => {} } as React.FormEvent)
                  }
                >
                  Save AI controls
                </Button>
              </section>
            ) : null}
            {owner ? (
              <SpecialistControls settings={settings} onChange={setSettings} />
            ) : null}
            <section className="settings-section ai-settings">
              <h2>ai-nonymauz-cloud</h2>
              <p>
                Requests are made by the server using your existing
                OpenAI-compatible endpoint.
              </p>
              <div className="connection-status">
                <div>
                  <small>Server configuration</small>
                  <Status
                    value={
                      workspace.ai.configured ? "Configured" : "Not configured"
                    }
                  />
                </div>
                <div>
                  <small>Model alias</small>
                  <code>{workspace.ai.model || "Not set"}</code>
                </div>
              </div>
              {owner ? (
                <div className="ai-connection-check">
                  <Button
                    variant="outline"
                    disabled={checking || !workspace.ai.configured}
                    onClick={async () => {
                      setChecking(true);
                      setConnection(null);
                      setConnectionError("");
                      try {
                        setConnection(await api("/api/ai/connection"));
                      } catch (error) {
                        setConnectionError((error as Error).message);
                      } finally {
                        setChecking(false);
                      }
                    }}
                  >
                    {checking ? (
                      <Loader2 size={16} className="spin" />
                    ) : (
                      <Link2 size={16} />
                    )}
                    {checking ? "Checking connection…" : "Check connection"}
                  </Button>
                  <p className="muted-text">
                    Checks credentials and model availability without sending
                    employee records.
                  </p>
                  <div aria-live="polite">
                    {connectionError ? (
                      <p role="alert">{connectionError}</p>
                    ) : null}
                    {connection ? (
                      <>
                        <p>
                          {connection.available
                            ? "Backend reachable. Your configured model is listed."
                            : "Backend reachable, but your configured model is missing. Update AI_NONYMAUZ_MODEL."}
                        </p>
                        <details>
                          <summary>
                            Available model aliases ({connection.models.length})
                          </summary>
                          <ul>
                            {connection.models.map((model) => (
                              <li key={model}>
                                <code>{model}</code>
                              </li>
                            ))}
                          </ul>
                        </details>
                        <p className="muted-text">
                          A listed model still needs a successful chat request
                          to verify generation.
                        </p>
                      </>
                    ) : null}
                  </div>
                  <details className="env-guide">
                    <summary>Server configuration</summary>
                    <p>Set these server environment variables:</p>
                    <code>AI_NONYMAUZ_BASE_URL=https://your-backend/v1</code>
                    <code>AI_NONYMAUZ_API_KEY=your-backend-bearer-key</code>
                    <code>AI_NONYMAUZ_MODEL=your-model-alias</code>
                  </details>
                </div>
              ) : null}
              <label className="check-label ai-optin">
                <Checkbox
                  checked={settings.aiEnabled}
                  disabled={!owner}
                  onCheckedChange={(v) =>
                    setSettings((s) => ({ ...s, aiEnabled: v === true }))
                  }
                />
                <span>
                  Enable AI for this workspace
                  <small>
                    Authorized employee, policy and recruitment records may be
                    sent to ai-nonymauz-cloud and its configured model
                    providers. The assistant has no write tools.
                  </small>
                </span>
              </label>
              {owner ? (
                <Button
                  disabled={busy}
                  onClick={() =>
                    save({ preventDefault: () => {} } as React.FormEvent)
                  }
                >
                  <Save size={15} />
                  Save AI setting
                </Button>
              ) : (
                <p className="muted-text">
                  Ask your workspace owner to enable AI.
                </p>
              )}
            </section>
          </TabsContent>
          {owner ? (
            <TabsContent value="setup">
              <SetupStatus />
            </TabsContent>
          ) : null}
          <TabsContent value="activity">
            <section className="settings-section">
              <h2>Recent activity</h2>
              <p>Changes and AI use are recorded for review.</p>
              <div className="audit-list">
                {workspace.audit.map((a) => (
                  <div key={a.id}>
                    <span className="audit-dot" />
                    <div>
                      <strong>{a.action}</strong>
                      <small>
                        {a.actor_name} · {shortDate(a.created_at)}
                      </small>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </TabsContent>
        </div>
      </Tabs>
      <Dialog open={inviting} onOpenChange={setInviting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite a teammate</DialogTitle>
            <DialogDescription>
              The private link expires in 3 days. Share it directly with the
              intended person.
            </DialogDescription>
          </DialogHeader>
          {inviteLink ? (
            <div className="share-link">
              <code>{inviteLink}</code>
              <Button
                variant="outline"
                onClick={() =>
                  navigator.clipboard
                    .writeText(inviteLink)
                    .then(() => toast.success("Link copied"))
                    .catch(() => toast.error("Copy the link above manually"))
                }
              >
                <Copy size={14} />
                Copy invitation link
              </Button>
            </div>
          ) : (
            <div className="record-form-grid">
              <div className="form-field full">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="form-field">
                <Label>Role</Label>
                <NativeSelect
                  label="Invitation role"
                  value={role}
                  onChange={setRole}
                  options={[
                    { value: "employee", label: "Employee" },
                    { value: "manager", label: "Manager" },
                    { value: "hr", label: "HR" },
                  ]}
                />
              </div>
              <div className="form-field">
                <Label>Employee record</Label>
                <NativeSelect
                  label="Invitation employee"
                  value={employeeId}
                  onChange={(id) => {
                    setEmployeeId(id);
                    const e = employees.find((e) => e.id === id);
                    if (e) setEmail(String(e.data.email));
                  }}
                  options={[
                    { value: "", label: "Choose employee" },
                    ...employees.map((e) => ({
                      value: e.id,
                      label: String(e.data.name),
                    })),
                  ]}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviting(false)}>
              Close
            </Button>
            {!inviteLink ? (
              <Button
                disabled={busy || !email || (role !== "hr" && !employeeId)}
                onClick={invite}
              >
                {busy ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Link2 size={14} />
                )}
                Create invitation
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!remove} onOpenChange={(open) => !open && setRemove(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove workspace access?</DialogTitle>
            <DialogDescription>
              This member’s active sessions for this company will be revoked.
              Their employee records remain available to HR.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setRemove(null)}
            >
              Back
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={removeMember}
            >
              Remove access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
