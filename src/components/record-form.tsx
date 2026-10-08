"use client";
import { useState } from "react";
import { Plus, Trash2, Upload, Loader2, ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/lib/client";
import { toast } from "sonner";
import { useWorkspace } from "./workspace-context";
import { isStaff, type Data, type Kind, type HRRecord } from "@/lib/types";
type Field = {
  key: string;
  label: string;
  type?:
    | "text"
    | "number"
    | "textarea"
    | "date"
    | "time"
    | "select"
    | "boolean"
    | "multi";
  options?: string[];
  source?: Kind;
  required?: boolean;
  min?: number;
  step?: string;
};
const employment = ["Full-time", "Part-time", "Contract", "Intern"];
const fields: Partial<Record<Kind, Field[]>> = {
  employee: [
    { key: "name", label: "Full name", required: true },
    { key: "email", label: "Work email", required: true },
    { key: "title", label: "Job title", required: true },
    {
      key: "departmentId",
      label: "Department",
      type: "select",
      source: "department",
    },
    {
      key: "managerId",
      label: "Reports to",
      type: "select",
      source: "employee",
    },
    { key: "startDate", label: "Start date", type: "date", required: true },
    { key: "endDate", label: "End date", type: "date" },
    {
      key: "employmentType",
      label: "Employment type",
      type: "select",
      options: employment,
    },
    {
      key: "status",
      label: "Status",
      type: "select",
      options: ["Active", "Onboarding", "Archived"],
    },
    { key: "salary", label: "Monthly base salary (RM)", type: "number" },
    {
      key: "annualLeave",
      label: "Annual leave allowance (days)",
      type: "number",
      step: "1",
    },
    {
      key: "sickLeave",
      label: "Sick leave allowance (days)",
      type: "number",
      step: "1",
    },
    { key: "phone", label: "Phone" },
  ],
  department: [
    { key: "name", label: "Department name", required: true },
    { key: "description", label: "Description", type: "textarea" },
  ],
  shift: [
    { key: "name", label: "Shift name", required: true },
    { key: "start", label: "Starts at", type: "time", required: true },
    { key: "end", label: "Ends at", type: "time", required: true },
    {
      key: "graceMinutes",
      label: "Grace period (minutes)",
      type: "number",
      step: "1",
    },
    {
      key: "employeeIds",
      label: "Assigned employees",
      type: "multi",
      source: "employee",
    },
  ],
  leave: [
    {
      key: "type",
      label: "Leave type",
      type: "select",
      options: ["Annual", "Sick", "Unpaid", "Other"],
    },
    { key: "startDate", label: "From", type: "date", required: true },
    { key: "endDate", label: "Until", type: "date", required: true },
    { key: "reason", label: "Reason", type: "textarea" },
  ],
  claim: [
    {
      key: "category",
      label: "Category",
      type: "select",
      options: ["Travel", "Meals", "Medical", "Equipment", "Other"],
    },
    { key: "date", label: "Expense date", type: "date", required: true },
    { key: "amount", label: "Amount (RM)", type: "number", required: true },
    { key: "description", label: "Business purpose", required: true },
  ],
  goal: [
    { key: "title", label: "Goal", required: true },
    {
      key: "target",
      label: "Target",
      type: "number",
      required: true,
      min: 0.01,
    },
    { key: "progress", label: "Current progress", type: "number" },
    { key: "unit", label: "Unit (e.g. milestones)", required: true },
    { key: "dueDate", label: "Due date", type: "date", required: true },
    {
      key: "status",
      label: "Status",
      type: "select",
      options: ["In progress", "Completed"],
    },
    {
      key: "rating",
      label: "Evaluation rating (1–5)",
      type: "select",
      options: ["1", "2", "3", "4", "5"],
    },
    { key: "feedback", label: "Review feedback", type: "textarea" },
  ],
  job: [
    { key: "title", label: "Job title", required: true },
    {
      key: "departmentId",
      label: "Department",
      type: "select",
      source: "department",
    },
    {
      key: "location",
      label: "Location / working arrangement",
      required: true,
    },
    {
      key: "employmentType",
      label: "Employment type",
      type: "select",
      options: employment,
    },
    {
      key: "description",
      label: "Role description",
      type: "textarea",
      required: true,
    },
    {
      key: "requirements",
      label: "Skills and experience required",
      type: "textarea",
      required: true,
    },
    {
      key: "status",
      label: "Publication status",
      type: "select",
      options: ["Draft", "Published", "Closed"],
    },
  ],
  candidate: [
    { key: "name", label: "Full name", required: true },
    { key: "email", label: "Email", required: true },
    { key: "phone", label: "Phone" },
    {
      key: "jobId",
      label: "Position",
      type: "select",
      source: "job",
      required: true,
    },
    {
      key: "stage",
      label: "Stage",
      type: "select",
      options: [
        "Applied",
        "Screening",
        "Interview",
        "Offer",
        "Hired",
        "Rejected",
      ],
    },
    {
      key: "resume",
      label: "Resume / experience",
      type: "textarea",
      required: true,
    },
    { key: "notes", label: "Recruiter notes", type: "textarea" },
    {
      key: "consent",
      label: "Candidate has consented to recruitment data processing",
      type: "boolean",
    },
  ],
  assessment: [
    { key: "title", label: "Assessment title", required: true },
    {
      key: "type",
      label: "Assessment type",
      type: "select",
      options: ["Skills", "Work preferences"],
    },
    { key: "instructions", label: "Instructions", type: "textarea" },
  ],
  meeting: [
    { key: "title", label: "Meeting title", required: true },
    { key: "date", label: "Date", type: "date", required: true },
    {
      key: "transcript",
      label: "Transcript or raw notes",
      type: "textarea",
      required: true,
    },
    { key: "summary", label: "Reviewed summary", type: "textarea" },
  ],
  policy: [
    { key: "title", label: "Policy title", required: true },
    {
      key: "category",
      label: "Category",
      type: "select",
      options: ["Leave", "Claims", "Conduct", "Benefits", "General"],
    },
    { key: "body", label: "Policy content", type: "textarea", required: true },
  ],
  payroll: [
    ...[
      "base",
      "allowance",
      "overtime",
      "bonus",
      "epfEmployee",
      "socsoEmployee",
      "eisEmployee",
      "pcb",
      "otherDeduction",
      "epfEmployer",
      "socsoEmployer",
      "eisEmployer",
    ].map((key) => ({
      key,
      label:
        (
          {
            base: "Base salary",
            allowance: "Allowances",
            overtime: "Overtime",
            bonus: "Bonus",
            epfEmployee: "EPF · employee",
            socsoEmployee: "SOCSO · employee",
            eisEmployee: "EIS · employee",
            pcb: "PCB / tax",
            otherDeduction: "Other deductions",
            epfEmployer: "EPF · employer",
            socsoEmployer: "SOCSO · employer",
            eisEmployer: "EIS · employer",
          } as Record<string, string>
        )[key] + " (RM)",
      type: "number" as const,
    })),
    { key: "note", label: "Payroll notes", type: "textarea" },
    {
      key: "reviewed",
      label:
        "I have checked the earnings and all statutory deductions for this employee",
      type: "boolean",
    },
  ],
};
const titles: Partial<Record<Kind, string>> = {
  employee: "employee",
  department: "department",
  shift: "shift",
  leave: "leave request",
  claim: "expense claim",
  goal: "performance goal",
  job: "job listing",
  candidate: "candidate",
  assessment: "assessment",
  meeting: "meeting notes",
  policy: "policy",
  payroll: "payroll draft",
};
function defaults(kind: Kind): Data {
  const today = new Date().toISOString().slice(0, 10);
  const data: Data = {};
  for (const field of fields[kind] || [])
    data[field.key] =
      field.type === "number"
        ? 0
        : field.type === "boolean"
          ? false
          : field.type === "select"
            ? field.source
              ? null
              : field.options?.[0] || null
            : field.type === "date"
              ? field.key === "endDate"
                ? null
                : today
              : field.type === "multi"
                ? []
                : "";
  if (kind === "employee")
    Object.assign(data, { annualLeave: 14, sickLeave: 14 });
  if (kind === "goal")
    Object.assign(data, { target: 1, unit: "milestones", rating: null });
  if (kind === "shift")
    Object.assign(data, {
      start: "09:00",
      end: "18:00",
      days: [1, 2, 3, 4, 5],
      graceMinutes: 5,
    });
  if (kind === "assessment")
    data.questions = [{ prompt: "", options: ["", ""], correctIndex: 0 }];
  if (kind === "meeting") data.actions = [];
  return data;
}
export function RecordForm({
  kind,
  record,
  onClose,
}: {
  kind: Kind;
  record?: HRRecord;
  onClose: () => void;
}) {
  const { workspace, refresh } = useWorkspace();
  const [data, setData] = useState<Data>(() =>
    record ? { ...record.data } : defaults(kind),
  );
  const [employeeId, setEmployeeId] = useState(
    record?.employee_id || workspace.actor.employeeId || "",
  );
  const [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false);
  const staff = isStaff(workspace.actor),
    employees = workspace.records.filter(
      (r) => r.kind === "employee" && r.data.status !== "Archived",
    ),
    selfGoal =
      kind === "goal" &&
      !!record &&
      !staff &&
      (workspace.actor.role === "employee" ||
        record.employee_id === workspace.actor.employeeId);
  function change(key: string, value: unknown) {
    setData((d) => ({ ...d, [key]: value }));
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api(
        record ? `/api/records/${kind}/${record.id}` : `/api/records/${kind}`,
        record
          ? { data, updatedAt: record.updated_at }
          : { data, employeeId: employeeId || null },
        record ? "PATCH" : "POST",
      );
      await refresh();
      toast.success(record ? "Changes saved" : "Record added");
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(file?: File) {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const result = await api<{ id: string; text: string; filename: string }>(
        "/api/files",
        form,
      );
      const key =
        kind === "claim"
          ? "receiptId"
          : kind === "candidate"
            ? "resumeFileId"
            : "fileId";
      setData((d) => ({
        ...d,
        [key]: result.id,
        ...(result.text && kind !== "claim"
          ? { [kind === "candidate" ? "resume" : "transcript"]: result.text }
          : {}),
      }));
      toast.success("Attachment saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }
  const questions = (data.questions || []) as {
    prompt: string;
    options: string[];
    correctIndex: number;
  }[];
  const actions = (data.actions || []) as {
    task: string;
    owner: string;
    dueDate: string | null;
    done: boolean;
  }[];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="record-dialog sm:max-w-[650px]">
        <DialogHeader>
          <DialogTitle>
            {record ? "Edit" : "Add"} {titles[kind] || kind}
          </DialogTitle>
          <DialogDescription>
            {kind === "payroll"
              ? "Enter verified deductions. This draft becomes a payslip after publication."
              : kind === "leave"
                ? "Working days and available balance are checked when submitted."
                : "Keep your workspace records up to date."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save}>
          <div className="record-form-grid">
            {["leave", "claim", "goal"].includes(kind) &&
            !record &&
            (staff ||
              (workspace.actor.role === "manager" && kind === "goal")) ? (
              <div className="form-field full">
                <Label htmlFor="target-employee">Employee</Label>
                <select
                  className="native-select"
                  id="target-employee"
                  required
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                >
                  <option value="">Choose employee</option>
                  {employees
                    .filter(
                      (e) =>
                        staff ||
                        e.id === workspace.actor.employeeId ||
                        e.data.managerId === workspace.actor.employeeId,
                    )
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {String(e.data.name)}
                      </option>
                    ))}
                </select>
              </div>
            ) : null}
            {(fields[kind] || [])
              .filter(
                (f) => !selfGoal || ["progress", "status"].includes(f.key),
              )
              .map((f) => {
                const id = `field-${f.key}`;
                const options = f.source
                  ? workspace.records
                      .filter((r) => r.kind === f.source && r.id !== record?.id)
                      .map((r) => ({
                        value: r.id,
                        label: String(r.data.name || r.data.title),
                      }))
                  : (f.options || []).map((v) => ({ value: v, label: v }));
                return (
                  <div
                    key={f.key}
                    className={`form-field ${["textarea", "multi", "boolean"].includes(f.type || "") ? "full" : ""}`}
                  >
                    {f.type !== "boolean" ? (
                      <Label htmlFor={id}>
                        {f.label}
                        {f.required ? (
                          <span className="required"> *</span>
                        ) : null}
                      </Label>
                    ) : null}
                    {f.type === "textarea" ? (
                      <Textarea
                        id={id}
                        required={f.required}
                        value={String(data[f.key] || "")}
                        rows={
                          f.key === "resume" || f.key === "transcript" ? 6 : 4
                        }
                        onChange={(e) => change(f.key, e.target.value)}
                      />
                    ) : f.type === "select" ? (
                      <select
                        id={id}
                        className="native-select"
                        required={f.required}
                        value={String(data[f.key] || "")}
                        onChange={(e) =>
                          change(
                            f.key,
                            f.key === "rating"
                              ? e.target.value
                                ? Number(e.target.value)
                                : null
                              : e.target.value || null,
                          )
                        }
                      >
                        {f.source || f.key === "rating" ? (
                          <option value="">
                            {f.source ? "Choose…" : "Not evaluated"}
                          </option>
                        ) : null}
                        {options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : f.type === "boolean" ? (
                      <label className="check-label">
                        <Checkbox
                          id={id}
                          checked={!!data[f.key]}
                          onCheckedChange={(v) => change(f.key, v === true)}
                        />
                        {f.label}
                      </label>
                    ) : f.type === "multi" ? (
                      <div className="multi-select">
                        {options.map((o) => (
                          <label className="check-label" key={o.value}>
                            <Checkbox
                              checked={(
                                (data[f.key] as string[]) || []
                              ).includes(o.value)}
                              onCheckedChange={(v) =>
                                change(
                                  f.key,
                                  v
                                    ? [
                                        ...((data[f.key] as string[]) || []),
                                        o.value,
                                      ]
                                    : (data[f.key] as string[]).filter(
                                        (id) => id !== o.value,
                                      ),
                                )
                              }
                            />
                            {o.label}
                          </label>
                        ))}
                      </div>
                    ) : (
                      <Input
                        id={id}
                        required={f.required}
                        type={f.key === "email" ? "email" : f.type || "text"}
                        min={f.type === "number" ? (f.min ?? 0) : undefined}
                        step={
                          f.type === "number" ? f.step || "0.01" : undefined
                        }
                        value={String(data[f.key] ?? "")}
                        onChange={(e) =>
                          change(
                            f.key,
                            f.type === "number"
                              ? Number(e.target.value)
                              : f.type === "date" && !e.target.value
                                ? null
                                : e.target.value,
                          )
                        }
                      />
                    )}
                  </div>
                );
              })}
            {kind === "shift" ? (
              <div className="form-field full">
                <Label>Working days</Label>
                <div className="day-picker">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                    (day, i) => (
                      <Button
                        type="button"
                        key={day}
                        variant={
                          (data.days as number[]).includes(i)
                            ? "default"
                            : "outline"
                        }
                        size="sm"
                        onClick={() =>
                          change(
                            "days",
                            (data.days as number[]).includes(i)
                              ? (data.days as number[]).filter((d) => d !== i)
                              : [...(data.days as number[]), i],
                          )
                        }
                      >
                        {day}
                      </Button>
                    ),
                  )}
                </div>
              </div>
            ) : null}
            {["claim", "candidate", "meeting"].includes(kind) ? (
              <div className="form-field full">
                <Label>Attachment</Label>
                <label className="upload-field">
                  {uploading ? (
                    <Loader2 size={17} className="animate-spin" />
                  ) : (
                    <Upload size={17} />
                  )}
                  <span>
                    {uploading ? "Uploading…" : "Choose a file"}
                    <small>
                      {kind === "claim"
                        ? "Receipt: PDF, PNG or JPG"
                        : "PDF, DOCX or TXT · extracted text fills the notes"}{" "}
                      · max 2 MB
                    </small>
                  </span>
                  <input
                    type="file"
                    disabled={uploading}
                    accept={
                      kind === "claim"
                        ? ".pdf,.png,.jpg,.jpeg"
                        : ".pdf,.docx,.txt"
                    }
                    onChange={(e) => upload(e.target.files?.[0])}
                  />
                </label>
                {data[
                  kind === "claim"
                    ? "receiptId"
                    : kind === "candidate"
                      ? "resumeFileId"
                      : "fileId"
                ] ? (
                  <a
                    className="inline-link"
                    href={`/api/files/${data[kind === "claim" ? "receiptId" : kind === "candidate" ? "resumeFileId" : "fileId"]}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View saved attachment
                    <ExternalLink size={13} />
                  </a>
                ) : null}
              </div>
            ) : null}
            {kind === "assessment" ? (
              <div className="form-field full">
                <Label>Questions</Label>
                {data.type === "Work preferences" ? (
                  <small>
                    Self-reported preferences. There are no correct answers or
                    personality scores.
                  </small>
                ) : null}
                {questions.map((q, index) => (
                  <div className="question-editor" key={index}>
                    <div className="row-between">
                      <strong>Question {index + 1}</strong>
                      <Button
                        variant="ghost"
                        size="icon"
                        type="button"
                        aria-label={`Remove question ${index + 1}`}
                        onClick={() =>
                          change(
                            "questions",
                            questions.filter((_, i) => i !== index),
                          )
                        }
                      >
                        <Trash2 size={15} />
                      </Button>
                    </div>
                    <Input
                      aria-label={`Question ${index + 1}`}
                      placeholder="Question"
                      required
                      value={q.prompt}
                      onChange={(e) =>
                        change(
                          "questions",
                          questions.map((old, i) =>
                            i === index
                              ? { ...old, prompt: e.target.value }
                              : old,
                          ),
                        )
                      }
                    />
                    <Textarea
                      aria-label={`Question ${index + 1} options`}
                      placeholder="One option per line"
                      required
                      rows={3}
                      value={q.options.join("\n")}
                      onChange={(e) =>
                        change(
                          "questions",
                          questions.map((old, i) =>
                            i === index
                              ? {
                                  ...old,
                                  options: e.target.value.split("\n"),
                                  correctIndex: 0,
                                }
                              : old,
                          ),
                        )
                      }
                    />
                    {data.type === "Skills" ? (
                      <select
                        aria-label={`Question ${index + 1} correct answer`}
                        className="native-select"
                        value={q.correctIndex}
                        onChange={(e) =>
                          change(
                            "questions",
                            questions.map((old, i) =>
                              i === index
                                ? {
                                    ...old,
                                    correctIndex: Number(e.target.value),
                                  }
                                : old,
                            ),
                          )
                        }
                      >
                        {q.options.map((o, i) => (
                          <option key={i} value={i}>
                            Correct: {o || `Option ${i + 1}`}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </div>
                ))}
                <Button
                  variant="outline"
                  type="button"
                  onClick={() =>
                    change("questions", [
                      ...questions,
                      { prompt: "", options: ["", ""], correctIndex: 0 },
                    ])
                  }
                >
                  <Plus size={15} />
                  Add question
                </Button>
              </div>
            ) : null}
            {kind === "meeting" ? (
              <div className="form-field full">
                <Label>Action items</Label>
                {actions.map((a, index) => (
                  <div className="action-editor" key={index}>
                    <Input
                      aria-label={`Action ${index + 1}`}
                      placeholder="Action"
                      required
                      value={a.task}
                      onChange={(e) =>
                        change(
                          "actions",
                          actions.map((old, i) =>
                            i === index
                              ? { ...old, task: e.target.value }
                              : old,
                          ),
                        )
                      }
                    />
                    <Input
                      aria-label={`Action ${index + 1} owner`}
                      placeholder="Owner"
                      value={a.owner}
                      onChange={(e) =>
                        change(
                          "actions",
                          actions.map((old, i) =>
                            i === index
                              ? { ...old, owner: e.target.value }
                              : old,
                          ),
                        )
                      }
                    />
                    <Input
                      aria-label={`Action ${index + 1} due date`}
                      type="date"
                      value={a.dueDate || ""}
                      onChange={(e) =>
                        change(
                          "actions",
                          actions.map((old, i) =>
                            i === index
                              ? { ...old, dueDate: e.target.value || null }
                              : old,
                          ),
                        )
                      }
                    />
                    <Checkbox
                      aria-label={`Action ${index + 1} completed`}
                      checked={a.done}
                      onCheckedChange={(v) =>
                        change(
                          "actions",
                          actions.map((old, i) =>
                            i === index ? { ...old, done: v === true } : old,
                          ),
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove action ${index + 1}`}
                      onClick={() =>
                        change(
                          "actions",
                          actions.filter((_, i) => i !== index),
                        )
                      }
                    >
                      <Trash2 size={15} />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  type="button"
                  onClick={() =>
                    change("actions", [
                      ...actions,
                      { task: "", owner: "", dueDate: null, done: false },
                    ])
                  }
                >
                  <Plus size={15} />
                  Add action item
                </Button>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || uploading}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              {record
                ? "Save changes"
                : kind === "leave" || kind === "claim"
                  ? "Submit request"
                  : "Add record"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
