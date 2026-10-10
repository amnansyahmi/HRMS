"use client";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import { useWorkspace } from "./workspace-context";
import { Status } from "./common";
import { money, shortDate } from "@/lib/client";
import {
  approvalStage,
  requestLabels,
  reviewOptions,
  type ReviewDecision,
} from "@/lib/request-workflow";
import { profileFields } from "@/lib/profile-fields";
import type { HRRecord } from "@/lib/types";

export function RequestSummary({ record: r }: { record: HRRecord }) {
  if (r.kind === "claim")
    return (
      <>
        {String(r.data.category)} · {money(r.data.amount)} ·{" "}
        {shortDate(r.data.date)}
      </>
    );
  if (r.kind === "leave")
    return (
      <>
        {String(r.data.type)} · {shortDate(r.data.startDate)}–
        {shortDate(r.data.endDate)} · {Number(r.data.days)} day(s) ·{" "}
        {String(r.data.unit || "Full day")}
      </>
    );
  if (r.kind === "overtime")
    return (
      <>
        {shortDate(r.data.date)} · {Number(r.data.hours)} hours ·{" "}
        {String(r.data.type)}
      </>
    );
  if (r.kind === "time_off")
    return (
      <>
        {shortDate(r.data.date)} · {String(r.data.start)}–{String(r.data.end)}
      </>
    );
  if (r.kind === "attendance_correction")
    return <>{shortDate(r.data.workDate)} · Clock correction</>;
  if (r.kind === "profile_change")
    return (
      <>
        {Object.keys(r.data.changes as object).length} contact field(s) ·{" "}
        {shortDate(r.created_at)}
      </>
    );
  return <>{String(r.data.reason || requestLabels[r.kind])}</>;
}
export function RequestReviewDialog({
  record,
  initialDecision,
  onClose,
}: {
  record: HRRecord;
  initialDecision?: ReviewDecision;
  onClose: () => void;
}) {
  const { workspace, act, ask } = useWorkspace();
  const options = reviewOptions(workspace.actor, record, workspace.records);
  const [decision, setDecision] = useState<ReviewDecision | "">(
    initialDecision || options[0] || "",
  );
  const [note, setNote] = useState(""),
    [busy, setBusy] = useState(false);
  const employee = workspace.records.find((e) => e.id === record.employee_id);
  const label = requestLabels[record.kind] || "Request";
  const requiresNote =
    decision === "Returned" ||
    (record.kind === "profile_change" && decision === "Rejected");
  const attachment = record.data.receiptId || record.data.evidenceId;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="record-dialog sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>{label} review</DialogTitle>
          <DialogDescription>
            {String(employee?.data.name || "Employee")} ·{" "}
            <RequestSummary record={record} />
          </DialogDescription>
        </DialogHeader>
        <div className="row-between">
          <Status value={record.data.status} />
          <span className="muted">
            {approvalStage(record, workspace.records)}
          </span>
        </div>
        <p className="preserve-lines">
          {String(
            record.data.reason ||
              record.data.description ||
              "No additional note.",
          )}
        </p>
        {record.kind === "profile_change" ? (
          <div className="profile-diff">
            {profileFields
              .filter((f) => f.key in (record.data.changes as object))
              .map((f) => (
                <div key={f.key}>
                  <strong>{f.label}</strong>
                  <span>
                    <small>Current at submission</small>
                    {String(
                      (record.data.previous as Record<string, string>)[f.key] ||
                        "Not set",
                    )}
                  </span>
                  <span>
                    <small>Requested</small>
                    {String(
                      (record.data.changes as Record<string, string>)[f.key] ||
                        "Clear this field",
                    )}
                  </span>
                </div>
              ))}
          </div>
        ) : null}
        {record.kind === "attendance_correction" ? (
          <dl className="detail-grid">
            <dt>Clock in</dt>
            <dd>
              {new Date(String(record.data.clockIn)).toLocaleString("en-MY", {
                timeZone: workspace.company.settings.timezone,
              })}
            </dd>
            <dt>Clock out</dt>
            <dd>
              {new Date(String(record.data.clockOut)).toLocaleString("en-MY", {
                timeZone: workspace.company.settings.timezone,
              })}
            </dd>
          </dl>
        ) : null}
        {attachment ? (
          <Button variant="outline" asChild>
            <a
              href={`/api/files/${attachment}`}
              target="_blank"
              rel="noreferrer"
            >
              View attachment
            </a>
          </Button>
        ) : null}
        {record.data.managerApprovedAt ? (
          <p className="info-note">
            Manager approved on {shortDate(record.data.managerApprovedAt)}.
            Final HR approval is required.
          </p>
        ) : null}
        {record.data.reviewNote ? (
          <p className="info-note">
            Previous review: {String(record.data.reviewNote)}
          </p>
        ) : null}
        {options.length ? (
          <>
            <label className="form-field">
              Decision
              <select
                className="native-select"
                aria-label="Decision"
                value={decision}
                onChange={(e) => setDecision(e.target.value as ReviewDecision)}
                disabled={busy}
              >
                {options.map((o) => (
                  <option key={o} value={o}>
                    {o === "Returned"
                      ? "Return for correction"
                      : o === "Paid"
                        ? "Record payment already made"
                        : o === "Cancelled"
                          ? "Cancel my request"
                          : o === "Approved"
                            ? "Approve"
                            : "Reject"}
                  </option>
                ))}
              </select>
            </label>
            {decision === "Approved" &&
            approvalStage(record, workspace.records) === "Awaiting manager" ? (
              <p className="info-note">
                This records the manager step. HR will make the final decision.
              </p>
            ) : null}
            <label className="form-field">
              {requiresNote
                ? "Review note (required)"
                : "Review note (optional)"}
              <Textarea
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  decision === "Returned"
                    ? "Explain what needs correcting"
                    : "Add context for the employee"
                }
                disabled={busy}
              />
            </label>
          </>
        ) : (
          <p className="info-note">
            You can view this request. Its next decision belongs to another
            reviewer, or it has already been processed.
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              ask(
                record.kind === "claim"
                  ? "claims"
                  : record.kind === "leave"
                    ? "leave"
                    : "hr",
                record.id,
                "Explain this request, its policy and any details I should verify before deciding.",
              );
              onClose();
            }}
          >
            <Sparkles size={16} />
            Ask AI about this request
          </Button>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Back
          </Button>
          {options.length ? (
            <Button
              disabled={
                busy ||
                !options.includes(decision as ReviewDecision) ||
                (requiresNote && !note.trim())
              }
              onClick={async () => {
                setBusy(true);
                try {
                  const result = await act(
                    record.kind === "profile_change"
                      ? "profile-review"
                      : "review",
                    {
                      id: record.id,
                      expectedUpdatedAt: record.updated_at,
                      decision,
                      note,
                    },
                    "Decision recorded",
                  );
                  if (result) onClose();
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Saving…" : "Confirm decision"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
