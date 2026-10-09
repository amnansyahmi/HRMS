"use client";
import { useState } from "react";
import { ClipboardCheck, Clock3 } from "lucide-react";
import { useWorkspace } from "./workspace-context";
import { PageHeader, Empty, SearchField, NativeSelect, Status } from "./common";
import { Button } from "./ui/button";
import { RequestSummary, RequestReviewDialog } from "./request-review";
import {
  requestKinds,
  requestLabels,
  ownsRequest,
  approvalStage,
  reviewOptions,
} from "@/lib/request-workflow";
import { shortDate } from "@/lib/client";
import type { HRRecord } from "@/lib/types";

export function ApprovalsPage() {
  const { workspace } = useWorkspace();
  const [view, setView] = useState("action"),
    [kind, setKind] = useState("All"),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<HRRecord | null>(null);
  const employees = workspace.records.filter((r) => r.kind === "employee");
  const all = workspace.records.filter((r) =>
    [...requestKinds, "profile_change"].includes(r.kind),
  );
  const actionable = (r: HRRecord) =>
    r.data.status === "Pending" &&
    reviewOptions(workspace.actor, r, workspace.records).some((o) =>
      ["Approved", "Rejected", "Returned"].includes(o),
    );
  const mine = (r: HRRecord) => ownsRequest(workspace.actor, r, employees);
  const pending = all.filter(actionable),
    myPending = all.filter((r) => mine(r) && r.data.status === "Pending");
  const rows = all
    .filter(
      (r) =>
        (kind === "All" || r.kind === kind) &&
        (view === "action"
          ? actionable(r)
          : view === "mine"
            ? mine(r)
            : true) &&
        `${employees.find((e) => e.id === r.employee_id)?.data.name || ""} ${requestLabels[r.kind]} ${r.data.reason || r.data.description || ""}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      view === "action"
        ? a.created_at.localeCompare(b.created_at)
        : b.created_at.localeCompare(a.created_at),
    );
  return (
    <>
      <PageHeader
        title="Approval inbox"
        description="Leave, claims, time requests and profile changes, with a clear next step."
      />
      <div className="workflow-metrics">
        <button onClick={() => setView("action")}>
          <ClipboardCheck size={19} />
          <span>
            <strong>{pending.length}</strong>
            <small>Needs your review</small>
          </span>
        </button>
        <button onClick={() => setView("mine")}>
          <Clock3 size={19} />
          <span>
            <strong>{myPending.length}</strong>
            <small>Your pending requests</small>
          </span>
        </button>
      </div>
      <div className="segmented-tabs" aria-label="Inbox view">
        {[
          { id: "action", label: "Needs my review" },
          { id: "mine", label: "My requests" },
          { id: "all", label: "Visible history" },
        ].map((v) => (
          <button
            key={v.id}
            className={view === v.id ? "active" : ""}
            onClick={() => setView(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>
      <div className="table-toolbar">
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Search approval inbox…"
        />
        <NativeSelect
          label="Request type"
          value={kind}
          onChange={setKind}
          options={[
            { value: "All", label: "All request types" },
            ...[...requestKinds, "profile_change" as const].map((k) => ({
              value: k,
              label: requestLabels[k]!,
            })),
          ]}
        />
      </div>
      {rows.length ? (
        <div className="approval-list">
          {rows.map((r) => (
            <article className="approval-card" key={r.id}>
              <div className="row-between">
                <strong>
                  {String(
                    employees.find((e) => e.id === r.employee_id)?.data.name ||
                      "Employee",
                  )}
                </strong>
                <Status value={r.data.status} />
              </div>
              <small>
                {requestLabels[r.kind]} · Submitted {shortDate(r.created_at)}
              </small>
              <p>
                <RequestSummary record={r} />
              </p>
              <div className="row-between">
                <span className="approval-stage">
                  {approvalStage(r, workspace.records)}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSelected(r)}
                >
                  {actionable(r) ? "Review request" : "View request"}
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title={
            view === "action" ? "You’re all caught up" : "No requests to show"
          }
          description="Requests matching this view will appear here."
        />
      )}
      {selected ? (
        <RequestReviewDialog
          key={selected.id}
          record={selected}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </>
  );
}
