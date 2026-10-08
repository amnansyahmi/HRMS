"use client";
import { useState } from "react";
import {
  Save,
  UserPlus,
  Copy,
  Link2,
  ExternalLink,
  Trash2,
  Loader2,
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
    [busy, setBusy] = useState(false),
    [inviting, setInviting] = useState(false),
    [email, setEmail] = useState(""),
    [role, setRole] = useState("employee"),
    [employeeId, setEmployeeId] = useState(""),
    [inviteLink, setInviteLink] = useState(""),
    [remove, setRemove] = useState<string | null>(null),
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
        description="Your company, access and AI connection."
      />
      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          {owner ? <TabsTrigger value="access">Team access</TabsTrigger> : null}
          <TabsTrigger value="ai">AI connection</TabsTrigger>
          {owner ? <TabsTrigger value="activity">Activity</TabsTrigger> : null}
        </TabsList>
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
                Leave requests exclude non-working days and the holidays entered
                here.
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
                    setSettings((s) => ({ ...s, careersIntro: e.target.value }))
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
          <div className="role-guide">
            <h3>Access at a glance</h3>
            <p>
              <strong>Owner</strong> manages company settings and access.{" "}
              <strong>HR</strong> manages employees, payroll and hiring.{" "}
              <strong>Manager</strong> reviews their direct team’s requests and
              goals, with access to their own payslips.{" "}
              <strong>Employee</strong> uses self-service and the public team
              directory.
            </p>
          </div>
        </TabsContent>
        <TabsContent value="ai">
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
            <div className="env-guide">
              <p>Set these server environment variables:</p>
              <code>AI_NONYMAUZ_BASE_URL=https://your-backend/v1</code>
              <code>AI_NONYMAUZ_API_KEY=your-backend-bearer-key</code>
              <code>AI_NONYMAUZ_MODEL=your-model-alias</code>
              <small>
                Use an alias returned by your backend’s /v1/models endpoint.
              </small>
            </div>
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
                  sent to ai-nonymauz-cloud and its configured model providers.
                  The assistant has no write tools.
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
