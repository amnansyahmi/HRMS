"use client";
import { useState } from "react";
import { Pencil, UserRound } from "lucide-react";
import { useWorkspace } from "./workspace-context";
import { PageHeader, Empty, Person, Status } from "./common";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import { RequestReviewDialog } from "./request-review";
import { profileFields } from "@/lib/profile-fields";
import { shortDate } from "@/lib/client";
import type { HRRecord } from "@/lib/types";

export function MyProfilePage() {
  const { workspace, go } = useWorkspace();
  const employee = workspace.records.find(
    (r) => r.kind === "employee" && r.id === workspace.actor.employeeId,
  );
  const [editing, setEditing] = useState(false),
    [selected, setSelected] = useState<HRRecord | null>(null);
  const changes = workspace.records.filter(
    (r) => r.kind === "profile_change" && r.employee_id === employee?.id,
  );
  const pending = changes.some((r) => r.data.status === "Pending");
  return (
    <>
      <div className="daily-header">
        <PageHeader
          title="My profile"
          description="Your employee details and contact updates, kept in one place."
          action={
            employee ? (
              <Button disabled={pending} onClick={() => setEditing(true)}>
                <Pencil size={15} />
                Request an update
              </Button>
            ) : null
          }
        />
      </div>
      {employee ? (
        <>
          <section className="panel profile-panel">
            <Person
              name={String(employee.data.name)}
              detail={String(employee.data.title)}
            />
            <dl className="detail-grid">
              <dt>Employment</dt>
              <dd>
                {String(employee.data.employmentType)} ·{" "}
                {String(employee.data.employmentStatus || employee.data.status)}
              </dd>
              <dt>Work email</dt>
              <dd>{String(employee.data.email)}</dd>
              <dt>Started</dt>
              <dd>{shortDate(employee.data.startDate)}</dd>
              <dt>Reports to</dt>
              <dd>
                {String(
                  workspace.records.find(
                    (r) => r.id === employee.data.managerId,
                  )?.data.name || "Not assigned",
                )}
              </dd>
              {profileFields.map((f) => (
                <div className="detail-pair" key={f.key}>
                  <dt>{f.label}</dt>
                  <dd className="preserve-lines">
                    {String(employee.data[f.key] || "Not set")}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          <p className="info-note">
            Contact updates take effect after HR approves them. Ask HR to update
            identity, banking, salary or employment details.
          </p>
          <div className="profile-links">
            <Button variant="outline" onClick={() => go("leave")}>
              Leave balances
            </Button>
            <Button variant="outline" onClick={() => go("payroll")}>
              My payslips
            </Button>
            <Button variant="outline" onClick={() => go("employee-files")}>
              Documents & equipment
            </Button>
          </div>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Update history</h2>
                <p>
                  {pending
                    ? "HR is reviewing your latest request."
                    : "Your contact change requests."}
                </p>
              </div>
            </div>
            {changes.length ? (
              <div className="request-list">
                {changes.map((r) => (
                  <div className="request-row" key={r.id}>
                    <UserRound size={18} />
                    <div>
                      <strong>
                        {Object.keys(r.data.changes as object)
                          .map(
                            (k) =>
                              profileFields.find((f) => f.key === k)?.label,
                          )
                          .join(", ")}
                      </strong>
                      <small>
                        {shortDate(r.created_at)} · {String(r.data.reason)}
                      </small>
                    </div>
                    <Status value={r.data.status} />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSelected(r)}
                    >
                      View request
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <Empty
                title="No contact updates yet"
                description="Request an update when your details change."
              />
            )}
          </section>
          {editing ? (
            <ProfileChangeForm
              employee={employee}
              onClose={() => setEditing(false)}
            />
          ) : null}
          {selected ? (
            <RequestReviewDialog
              key={selected.id}
              record={selected}
              onClose={() => setSelected(null)}
            />
          ) : null}
        </>
      ) : (
        <Empty
          title="Link your employee profile"
          description="Your workspace owner can link this account to your employee record in Settings."
        />
      )}
    </>
  );
}
function ProfileChangeForm({
  employee,
  onClose,
}: {
  employee: HRRecord;
  onClose: () => void;
}) {
  const { act } = useWorkspace();
  const [values, setValues] = useState(
      Object.fromEntries(
        profileFields.map((f) => [f.key, String(employee.data[f.key] || "")]),
      ),
    ),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false);
  const changes = Object.fromEntries(
    Object.entries(values).filter(
      ([k, v]) => v.trim() !== String(employee.data[k] || ""),
    ),
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="record-dialog">
        <DialogHeader>
          <DialogTitle>Request a profile update</DialogTitle>
          <DialogDescription>
            Only the fields you change are sent for HR approval. Your current
            profile stays in effect until approval.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const result = await act(
                "profile-request",
                { employeeUpdatedAt: employee.updated_at, changes, reason },
                "Profile update sent to HR",
              );
              if (result) onClose();
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="record-form-grid">
            {profileFields.map((f) => (
              <label
                key={f.key}
                className={`form-field ${f.key === "address" ? "field-full" : ""}`}
              >
                {f.label}
                {f.key === "address" ? (
                  <Textarea
                    maxLength={f.max}
                    value={values[f.key]}
                    onChange={(e) =>
                      setValues({ ...values, [f.key]: e.target.value })
                    }
                    disabled={busy}
                  />
                ) : (
                  <Input
                    type={
                      f.key.includes("Phone") || f.key === "phone"
                        ? "tel"
                        : "text"
                    }
                    maxLength={f.max}
                    value={values[f.key]}
                    onChange={(e) =>
                      setValues({ ...values, [f.key]: e.target.value })
                    }
                    disabled={busy}
                  />
                )}
              </label>
            ))}
            <label className="form-field field-full">
              Reason for update
              <Textarea
                required
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={busy}
              />
            </label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              disabled={busy}
              onClick={onClose}
            >
              Back
            </Button>
            <Button
              type="submit"
              disabled={busy || !Object.keys(changes).length || !reason.trim()}
            >
              {busy ? "Sending…" : "Send to HR"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
