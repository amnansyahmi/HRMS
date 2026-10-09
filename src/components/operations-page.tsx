"use client";
import { useEffect, useState } from "react";
import {
  Plus,
  Pencil,
  Download,
  Check,
  X,
  Copy,
  Bell,
  FileText,
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { useWorkspace } from "./workspace-context";
import { PageHeader, Empty, Status, NativeSelect } from "./common";
import { api, money, shortDate } from "@/lib/client";
import { isStaff, type Kind, type HRRecord, type Data } from "@/lib/types";
import { toast } from "sonner";
export type OperationsView =
  | "employee-files"
  | "work-requests"
  | "hr-policies"
  | "reviews"
  | "announcements"
  | "payments";
const sections: Record<
  OperationsView,
  { title: string; description: string; kinds: Kind[]; labels: string[] }
> = {
  "employee-files": {
    title: "Employee files",
    description: "Documents, equipment and every step of joining or leaving.",
    kinds: ["document", "asset", "lifecycle", "letter", "job_history"],
    labels: ["Documents", "Equipment", "Checklists", "Letters", "Job history"],
  },
  "work-requests": {
    title: "Time requests",
    description: "Overtime, time off and attendance reviews in one place.",
    kinds: [
      "overtime",
      "time_off",
      "attendance_correction",
      "lateness",
      "goal_update",
    ],
    labels: [
      "Overtime",
      "Time off",
      "Clock corrections",
      "Lateness",
      "Goal progress",
    ],
  },
  "hr-policies": {
    title: "HR policies",
    description: "Entitlements, claim limits, workplaces and state holidays.",
    kinds: ["leave_type", "claim_type", "location", "holiday"],
    labels: ["Leave types", "Claim types", "Locations", "Holidays"],
  },
  reviews: {
    title: "Review cycles",
    description:
      "Repeatable evaluations with weighted criteria and a clear review history.",
    kinds: ["evaluation", "review_cycle", "evaluation_template"],
    labels: ["Evaluations", "Cycles", "Templates"],
  },
  announcements: {
    title: "Announcements",
    description: "Company updates, delivered to the people who need them.",
    kinds: ["announcement"],
    labels: ["Announcements"],
  },
  payments: {
    title: "Payments",
    description:
      "Prepared vouchers and the transfer references recorded by HR.",
    kinds: ["payment_voucher"],
    labels: ["Vouchers"],
  },
};
const requestKinds: Kind[] = [
  "overtime",
  "time_off",
  "attendance_correction",
  "lateness",
  "goal_update",
];
export function OperationsPage({ view }: { view: OperationsView }) {
  const { workspace, edit, act, refresh } = useWorkspace();
  const config = sections[view];
  const [expiryThreshold] = useState(() =>
    new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10),
  );
  const [kind, setKind] = useState<Kind>(config.kinds[0]),
    [employee, setEmployee] = useState(""),
    [detail, setDetail] = useState<HRRecord | null>(null),
    [link, setLink] = useState(""),
    [status, setStatus] = useState<{
      onboarding: {
        id: string;
        employee_id: string;
        status: string;
        required_documents: string[];
        proposed_data: Data;
      }[];
    } | null>(null),
    [employmentChange, setEmploymentChange] = useState(false),
    [importing, setImporting] = useState(false),
    [importRows, setImportRows] = useState<Data[]>([]),
    [busy, setBusy] = useState(false);
  const staff = isStaff(workspace.actor),
    employees = workspace.records.filter((r) => r.kind === "employee"),
    name = (id: unknown) =>
      String(employees.find((e) => e.id === id)?.data.name || "Company"),
    rows = workspace.records.filter(
      (r) => r.kind === kind && (!employee || r.employee_id === employee),
    ),
    selected = detail
      ? workspace.records.find((r) => r.id === detail.id) || detail
      : null;
  useEffect(() => {
    if (view === "employee-files" && staff)
      api<{ onboarding: NonNullable<typeof status>["onboarding"] }>(
        "/api/actions/operations-status",
        {},
      )
        .then(setStatus)
        .catch(() => {});
  }, [view, staff, workspace.records]);
  async function createLink() {
    if (!employee) return toast.error("Choose an employee");
    const result = (await act("onboarding-link", {
      employeeId: employee,
      data: { requiredDocuments: ["Identity", "Contract"] },
    })) as { url: string } | undefined;
    if (result) setLink(result.url);
  }
  async function importFile(file?: File) {
    if (!file) return;
    try {
      const { parseCSV } = await import("@/lib/csv-import");
      setImportRows(parseCSV(await file.text()));
      setImporting(true);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  return (
    <>
      {employmentChange ? (
        <EmploymentChange
          employeeId={employee}
          onClose={() => setEmploymentChange(false)}
        />
      ) : null}
      <PageHeader
        title={config.title}
        description={config.description}
        action={
          (staff || requestKinds.includes(kind) || kind === "document") &&
          !["job_history", "payment_voucher"].includes(kind) ? (
            <Button onClick={() => edit(kind)}>
              <Plus size={16} />
              Add {config.labels[config.kinds.indexOf(kind)].toLowerCase()}
            </Button>
          ) : null
        }
      />
      {config.kinds.length > 1 && (
        <div className="segmented-tabs">
          {config.kinds.map((k, i) => (
            <button
              key={k}
              className={kind === k ? "active" : ""}
              onClick={() => setKind(k)}
            >
              {config.labels[i]}
            </button>
          ))}
        </div>
      )}
      <div className="table-toolbar">
        <NativeSelect
          label="Filter employee"
          value={employee}
          onChange={setEmployee}
          options={[
            { value: "", label: "Everyone" },
            ...employees.map((e) => ({
              value: e.id,
              label: String(e.data.name),
            })),
          ]}
        />
        {view === "employee-files" && staff ? (
          <div className="toolbar-actions">
            <Button
              variant="outline"
              onClick={() =>
                employee
                  ? setEmploymentChange(true)
                  : toast.error("Choose an employee")
              }
            >
              Employment change
            </Button>
            <Button variant="outline" onClick={createLink}>
              Onboarding link
            </Button>
            <Button variant="outline" asChild>
              <label>
                Import employees
                <input
                  className="sr-only"
                  type="file"
                  accept=".csv"
                  onChange={(e) => void importFile(e.target.files?.[0])}
                />
              </label>
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                if (!employee) return toast.error("Choose an employee");
                const result = await act("letter-draft", {
                  id: employee,
                  data: { type: "Confirmation" },
                });
                if (result) toast.success("Letter draft added");
              }}
            >
              <FileText size={14} />
              Draft letter
            </Button>
          </div>
        ) : null}
      </div>
      {view === "employee-files" && staff && status?.onboarding.length ? (
        <div className="onboarding-strip">
          <strong>Onboarding progress</strong>
          {status.onboarding.map((row) => (
            <div className="row-between" key={row.id}>
              <span>
                {name(row.employee_id)} ·{" "}
                {((row.proposed_data.documents as unknown[]) || []).length}/
                {row.required_documents.length} documents · {row.status}
              </span>
              <details>
                <summary>Review submitted details</summary>
                <dl>
                  {Object.entries(row.proposed_data)
                    .filter(([key]) => key !== "documents")
                    .map(([key, value]) => (
                      <div key={key}>
                        <dt>{key.replace(/([A-Z])/g, " $1")}</dt>
                        <dd>
                          {typeof value === "object"
                            ? JSON.stringify(value)
                            : String(value ?? "—")}
                        </dd>
                      </div>
                    ))}
                </dl>
                {(
                  (row.proposed_data.documents as {
                    fileId: string;
                    filename: string;
                    type: string;
                  }[]) || []
                ).map((doc) => (
                  <p key={doc.fileId}>
                    <a
                      className="inline-link"
                      href={`/api/files/${doc.fileId}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {doc.type} · {doc.filename}
                    </a>
                  </p>
                ))}
              </details>
              {row.status === "Submitted" ? (
                <div className="toolbar-actions">
                  <Button
                    size="sm"
                    onClick={() =>
                      void act(
                        "onboarding-review",
                        { id: row.id, data: { decision: "Approved" } },
                        "Onboarding approved",
                      )
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void act(
                        "onboarding-review",
                        { id: row.id, data: { decision: "Rejected" } },
                        "Returned to employee",
                      )
                    }
                  >
                    Return
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {view === "reviews" &&
      kind === "evaluation" &&
      rows.some((r) => r.data.status === "Final") ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Cycle</th>
                <th>Score</th>
                <th>Reviewed</th>
              </tr>
            </thead>
            <tbody>
              {rows
                .filter((r) => r.data.status === "Final")
                .sort((a, b) =>
                  String(a.data.reviewedAt).localeCompare(
                    String(b.data.reviewedAt),
                  ),
                )
                .map((r) => (
                  <tr key={r.id}>
                    <td>{name(r.employee_id)}</td>
                    <td>
                      {String(
                        workspace.records.find((c) => c.id === r.data.cycleId)
                          ?.data.title || "Review",
                      )}
                    </td>
                    <td>{Number(r.data.score).toFixed(2)} / 5</td>
                    <td>{shortDate(r.data.reviewedAt)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {kind === "document" &&
      rows.some(
        (r) =>
          r.data.expiryDate && String(r.data.expiryDate) <= expiryThreshold,
      ) ? (
        <div className="info-note">
          Documents expiring within 60 days are marked for renewal below.
        </div>
      ) : null}
      {rows.length ? (
        <div className="record-cards">
          {rows.map((r) => (
            <article className="record-card" key={r.id}>
              <div className="row-between">
                <small>
                  {r.employee_id ? name(r.employee_id) : config.title}
                </small>
                <Status
                  value={
                    r.data.status || r.data.type || r.kind.replaceAll("_", " ")
                  }
                />
              </div>
              <h3>
                {String(
                  r.data.title ||
                    r.data.name ||
                    r.data.reason ||
                    r.data.date ||
                    r.kind.replaceAll("_", " "),
                )}
              </h3>
              <p>
                {String(
                  r.data.body ||
                    r.data.notes ||
                    r.data.feedback ||
                    r.data.reason ||
                    r.data.reference ||
                    "",
                ).slice(0, 220)}
              </p>
              {r.data.amount !== undefined ? (
                <strong>{money(r.data.amount)}</strong>
              ) : null}
              {r.data.expiryDate ? (
                <p
                  className={
                    String(r.data.expiryDate) <= expiryThreshold
                      ? "expiry-warning"
                      : ""
                  }
                >
                  Expires {shortDate(r.data.expiryDate)}
                </p>
              ) : null}
              {r.kind === "evaluation" && r.data.status === "Final" ? (
                <strong>{Number(r.data.score).toFixed(2)} / 5</strong>
              ) : null}
              <div className="card-actions">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDetail(r)}
                >
                  Open
                </Button>
                {staff &&
                !requestKinds.includes(r.kind) &&
                ![
                  "evaluation",
                  "job_history",
                  "payment_voucher",
                  "lifecycle",
                ].includes(r.kind) &&
                r.data.status !== "Issued" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => edit(r.kind, r)}
                  >
                    <Pencil size={14} />
                    Edit
                  </Button>
                ) : null}
                {r.data.fileId ? (
                  <Button size="sm" variant="ghost" asChild>
                    <a href={`/api/files/${r.data.fileId}`}>
                      <Download size={14} />
                      Document
                    </a>
                  </Button>
                ) : null}
                {requestKinds.includes(r.kind) &&
                r.data.status === "Pending" &&
                (staff || workspace.actor.role === "manager") ? (
                  <>
                    <Button
                      size="sm"
                      onClick={() =>
                        void act(
                          "review",
                          { id: r.id, decision: "Approved" },
                          "Request approved",
                        )
                      }
                    >
                      <Check size={14} />
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void act(
                          "review",
                          { id: r.id, decision: "Rejected" },
                          "Request rejected",
                        )
                      }
                    >
                      <X size={14} />
                      Reject
                    </Button>
                  </>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title={`No ${config.labels[config.kinds.indexOf(kind)].toLowerCase()} yet`}
          description="New records will appear here."
        />
      )}
      <Dialog
        open={!!selected}
        onOpenChange={(open) => !open && setDetail(null)}
      >
        <DialogContent className="record-dialog sm:max-w-[650px]">
          <DialogHeader>
            <DialogTitle>
              {String(
                selected?.data.title ||
                  selected?.data.name ||
                  "Request details",
              )}
            </DialogTitle>
            <DialogDescription>
              {selected?.employee_id
                ? name(selected.employee_id)
                : config.description}
            </DialogDescription>
          </DialogHeader>
          {selected ? (
            <RecordDetail key={selected.id} record={selected} />
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog open={!!link} onOpenChange={(open) => !open && setLink("")}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Private onboarding link</DialogTitle>
            <DialogDescription>
              The employee can complete their profile and upload Identity and
              Contract documents. HR approves the submitted details.
            </DialogDescription>
          </DialogHeader>
          <Input readOnly value={link} />
          <Button
            onClick={() => {
              void navigator.clipboard.writeText(link);
              toast.success("Link copied");
            }}
          >
            <Copy size={15} />
            Copy link
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog open={importing} onOpenChange={setImporting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review employee import</DialogTitle>
            <DialogDescription>
              CSV columns: name, email, title, startDate (YYYY-MM-DD), salary.
              Optional columns use the employee field names. Up to 100 rows per
              batch.
            </DialogDescription>
          </DialogHeader>
          <p>
            {importRows.length} employees. All rows are validated before any are
            added.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                {importRows.slice(0, 10).map((r, i) => (
                  <tr key={i}>
                    <td>{String(r.name || "")}</td>
                    <td>{String(r.email || "")}</td>
                    <td>{String(r.title || "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api("/api/actions/employees-import", {
                  data: { rows: importRows },
                });
                await refresh();
                setImporting(false);
                toast.success("Employees imported");
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Import {importRows.length} employees
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
function RecordDetail({ record: r }: { record: HRRecord }) {
  const { workspace, act } = useWorkspace(),
    staff = isStaff(workspace.actor),
    [comments, setComments] = useState(String(r.data.selfComments || "")),
    [feedback, setFeedback] = useState(""),
    [bankReference, setBankReference] = useState(""),
    [receipts, setReceipts] = useState<
      { name: string; read_at: string }[] | null
    >(null);
  const criteria = ((r.data.templateSnapshot as Data)?.criteria || []) as {
    title: string;
    weight: number;
  }[];
  const [ratings, setRatings] = useState(criteria.map(() => 3));
  if (r.kind === "lifecycle")
    return (
      <div className="checklist">
        {(r.data.items as { task: string; done: boolean; owner: string }[]).map(
          (item, i) => (
            <label key={i}>
              <input
                type="checkbox"
                disabled={!staff}
                checked={item.done}
                onChange={() =>
                  void act("lifecycle-toggle", { id: r.id, data: { index: i } })
                }
              />
              <span>
                {item.task}
                <small>{item.owner}</small>
              </span>
            </label>
          ),
        )}
      </div>
    );
  if (r.kind === "letter")
    return (
      <>
        <article className="letter-preview">
          <p>{String(r.data.body)}</p>
        </article>
        <div className="toolbar-actions">
          <Button variant="outline" asChild>
            <a href={`/letter/${r.id}`} target="_blank" rel="noreferrer">
              Print / save PDF
            </a>
          </Button>
          {staff && r.data.status === "Draft" ? (
            <Button
              onClick={() =>
                void act("letter-issue", { id: r.id }, "Letter issued")
              }
            >
              Issue letter
            </Button>
          ) : null}
        </div>
      </>
    );
  if (r.kind === "evaluation")
    return (
      <>
        <p>Self reflection</p>
        <Textarea
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          disabled={r.data.status !== "Draft"}
        />
        {r.data.status === "Draft" ? (
          <Button
            onClick={() =>
              void act(
                "evaluation-submit",
                { id: r.id, data: { selfComments: comments } },
                "Submitted for review",
              )
            }
          >
            Submit for review
          </Button>
        ) : null}
        {r.data.status === "Submitted" &&
        (staff || workspace.actor.role === "manager") ? (
          <>
            <p>Review criteria</p>
            {criteria.map((c, i) => (
              <label className="review-criterion" key={i}>
                {c.title} <small>{c.weight}% weight</small>
                <select
                  className="native-select"
                  aria-label={`Rating for ${c.title}`}
                  value={ratings[i]}
                  onChange={(e) =>
                    setRatings((values) =>
                      values.map((v, j) =>
                        j === i ? Number(e.target.value) : v,
                      ),
                    )
                  }
                >
                  {[1, 2, 3, 4, 5].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
            ))}
            <Textarea
              placeholder="Feedback"
              aria-label="Review feedback"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
            />
            <Button
              onClick={() =>
                void act(
                  "evaluation-review",
                  { id: r.id, data: { ratings, feedback } },
                  "Evaluation finalised",
                )
              }
            >
              Complete evaluation
            </Button>
          </>
        ) : null}
        {r.data.status === "Final" ? (
          <>
            <strong>{Number(r.data.score).toFixed(2)} / 5</strong>
            <p>{String(r.data.feedback)}</p>
          </>
        ) : null}
      </>
    );
  if (r.kind === "announcement")
    return (
      <>
        <p className="preserve-lines">{String(r.data.body)}</p>
        <Button
          variant="outline"
          onClick={() =>
            void act("announcement-read", { id: r.id }, "Marked as read")
          }
        >
          Mark as read
        </Button>
        {staff ? (
          <Button
            variant="ghost"
            onClick={async () => {
              const result = (await act("announcement-receipts", {
                id: r.id,
              })) as typeof receipts;
              if (result) setReceipts(result);
            }}
          >
            Read receipts
          </Button>
        ) : null}
        {receipts?.map((row, i) => (
          <p key={i}>
            {row.name} · {shortDate(row.read_at)}
          </p>
        ))}
      </>
    );
  if (r.kind === "payment_voucher")
    return (
      <>
        <dl className="detail-grid">
          <dt>Reference</dt>
          <dd>{String(r.data.reference)}</dd>
          <dt>Amount</dt>
          <dd>{money(r.data.amount)}</dd>
          <dt>Status</dt>
          <dd>{String(r.data.status)}</dd>
          <dt>Bank reference</dt>
          <dd>{String(r.data.bankReference || "—")}</dd>
        </dl>
        {staff && r.data.status === "Prepared" ? (
          <>
            <Input
              aria-label="Bank transfer reference"
              placeholder="Bank transfer reference"
              value={bankReference}
              onChange={(e) => setBankReference(e.target.value)}
            />
            <Button
              disabled={!bankReference.trim()}
              onClick={() =>
                void act(
                  "voucher-pay",
                  { id: r.id, data: { bankReference } },
                  "Payment recorded",
                )
              }
            >
              Record payment
            </Button>
          </>
        ) : null}
        <Button variant="outline" asChild>
          <a href={`/api/export?type=voucher&id=${r.id}`}>
            Download transfer CSV
          </a>
        </Button>
      </>
    );
  return (
    <dl className="detail-grid">
      {Object.entries(r.data)
        .filter(
          ([k, v]) =>
            v !== null &&
            v !== "" &&
            !Array.isArray(v) &&
            typeof v !== "object" &&
            !k.endsWith("Id") &&
            !k.endsWith("By"),
        )
        .map(([k, v]) => (
          <div className="detail-pair" key={k}>
            <dt>{k.replace(/([A-Z])/g, " $1")}</dt>
            <dd>{String(v)}</dd>
          </div>
        ))}
    </dl>
  );
}
export function NotificationPanel() {
  const { workspace, act, go } = useWorkspace();
  const [open, setOpen] = useState(false);
  const unread = workspace.notifications.filter((n) => !n.read_at).length;
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Notifications, ${unread} unread`}
        onClick={() => setOpen(true)}
      >
        <Bell size={18} />
        {unread ? <span className="notification-dot" /> : null}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="record-dialog">
          <DialogHeader>
            <DialogTitle>Notifications</DialogTitle>
            <DialogDescription>
              Updates on your requests and employee file.
            </DialogDescription>
          </DialogHeader>
          {workspace.notifications.length ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void act("notifications-read", {}, "Marked all as read")
                }
              >
                Mark all as read
              </Button>
              {workspace.notifications.map((n) => (
                <button
                  className={`notification-item ${!n.read_at ? "unread" : ""}`}
                  key={n.id}
                  onClick={() => {
                    setOpen(false);
                    const page = n.href.split("view=")[1] as Parameters<
                      typeof go
                    >[0];
                    if (page) go(page);
                  }}
                >
                  <strong>{n.title}</strong>
                  <span>{n.body}</span>
                  <small>{shortDate(n.created_at)}</small>
                </button>
              ))}
            </>
          ) : (
            <Empty
              title="You’re up to date"
              description="Request updates will appear here."
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function EmploymentChange({
  employeeId,
  onClose,
}: {
  employeeId: string;
  onClose: () => void;
}) {
  const { workspace, act } = useWorkspace(),
    employee = workspace.records.find((r) => r.id === employeeId)!;
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10)),
    [title, setTitle] = useState(String(employee.data.title)),
    [salary, setSalary] = useState(String(employee.data.salary)),
    [department, setDepartment] = useState(
      String(employee.data.departmentId || ""),
    ),
    [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Employment change</DialogTitle>
          <DialogDescription>
            Record a promotion, salary or department change on its effective
            date. Future changes feed payroll from that date.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const result = await act(
                "employment-change",
                {
                  id: employeeId,
                  expectedUpdatedAt: employee.updated_at,
                  data: {
                    effectiveDate: date,
                    title,
                    newSalary: Number(salary),
                    departmentId: department || null,
                  },
                },
                "Employment change recorded",
              );
              if (result) onClose();
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="record-form-grid">
            <label className="form-field">
              Effective date
              <Input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label className="form-field">
              Job title
              <Input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="form-field">
              Monthly salary (RM)
              <Input
                required
                type="number"
                min="0"
                step="0.01"
                value={salary}
                onChange={(e) => setSalary(e.target.value)}
              />
            </label>
            <label className="form-field">
              Department
              <select
                className="native-select"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              >
                <option value="">No department</option>
                {workspace.records
                  .filter((r) => r.kind === "department")
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {String(d.data.name)}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <Button disabled={busy} type="submit">
            Save change
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
