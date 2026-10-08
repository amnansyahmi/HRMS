"use client";
import { hasPayroll } from "@/lib/workflow-config";
import { payCycles } from "@/lib/pay-runs-client";
import { useState } from "react";
import {
  Download,
  Pencil,
  FileText,
  CheckCheck,
  Calculator,
  ExternalLink,
} from "lucide-react";
import { Checkbox } from "./ui/checkbox";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useWorkspace } from "./workspace-context";
import { PageHeader, Person, Status, Empty } from "./common";
import { money } from "@/lib/client";
export function PayrollPage() {
  const { workspace, edit, act } = useWorkspace(),
    [tab, setTab] = useState("payroll"),
    [period, setPeriod] = useState(new Date().toISOString().slice(0, 7)),
    [year, setYear] = useState(new Date().getFullYear()),
    [scope, setScope] = useState(""),
    [runId, setRunId] = useState(""),
    [cycle, setCycle] = useState("Monthly"),
    [title, setTitle] = useState(""),
    [finalInMonth, setFinalInMonth] = useState(false),
    [startDate, setStartDate] = useState(""),
    [endDate, setEndDate] = useState(""),
    [payDate, setPayDate] = useState(""),
    [publishing, setPublishing] = useState(false),
    [busy, setBusy] = useState(false),
    staff = hasPayroll(workspace.actor),
    prepare = hasPayroll(workspace.actor, "prepare"),
    approve = hasPayroll(workspace.actor, "approve"),
    pay = hasPayroll(workspace.actor, "pay"),
    runs = workspace.records.filter(
      (r) => r.kind === "payroll_run" && r.data.period === period,
    ),
    rows = workspace.records.filter(
      (r) =>
        r.kind === "payroll" &&
        r.data.period === period &&
        (!staff || (runId ? r.data.runId === runId : !r.data.runId)),
    ),
    drafts = rows.filter((r) => r.data.status === "Draft");
  async function generate() {
    setBusy(true);
    try {
      const result = (await act("payroll-generate", {
        period,
        ...(runId
          ? { runId }
          : cycle !== "Monthly"
            ? {
                cycle,
                startDate,
                endDate,
                payDate,
                finalInMonth,
                ...(title.trim() ? { title: title.trim() } : {}),
              }
            : {}),
        ...(scope.startsWith("department:")
          ? { departmentId: scope.slice(11) }
          : scope
            ? { employeeId: scope }
            : {}),
      })) as { created: number; runId?: string; period: string } | undefined;
      if (result?.runId) {
        setRunId(result.runId);
        setPeriod(result.period);
      }
      if (result)
        toastResult(
          result.created
            ? `${result.created} payroll drafts prepared`
            : "Drafts already exist for this period",
        );
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    setBusy(true);
    try {
      const result = await act(
        "payroll-publish",
        runId ? { runId } : { period },
        "Payslips published",
      );
      if (result) setPublishing(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        title="Payroll & payslips"
        description="Prepare, review and publish with a clear record of every amount."
        action={
          prepare && tab === "payroll" ? (
            <Button disabled={busy} onClick={generate}>
              <Calculator size={16} />
              Prepare payroll
            </Button>
          ) : null
        }
      />
      {staff ? (
        <div className="info-note">
          2026 calculation uses verified employee categories and TP1 / TP3
          inputs. Review wage classifications, previous employment, reliefs and
          special scheme approval before publishing.
        </div>
      ) : null}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="payroll">
            {staff ? "Payroll" : "My payslips"}
          </TabsTrigger>
          {staff ? (
            <TabsTrigger value="forms">Statutory worksheets</TabsTrigger>
          ) : null}
        </TabsList>
        <TabsContent value="payroll">
          <div className="table-toolbar">
            <label className="period-picker">
              Pay period
              <input
                className="native-select"
                aria-label="Payroll period"
                type="month"
                value={period}
                onChange={(e) => {
                  setPeriod(e.target.value);
                  setRunId("");
                }}
              />
            </label>
            {staff ? (
              <label className="period-picker">
                Pay run
                <select
                  className="native-select"
                  aria-label="Pay run"
                  value={runId}
                  onChange={(e) => setRunId(e.target.value)}
                >
                  <option value="">Monthly / new run</option>
                  {runs.map((r) => (
                    <option key={r.id} value={r.id}>
                      {String(r.data.title)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {prepare && !runId ? (
              <label className="period-picker">
                Cycle
                <select
                  className="native-select"
                  aria-label="Pay cycle"
                  value={cycle}
                  onChange={(e) => setCycle(e.target.value)}
                >
                  {payCycles.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            ) : null}
            {prepare && !runId && cycle !== "Monthly" ? (
              <label className="period-picker">
                Run name (optional)
                <input
                  className="native-select"
                  aria-label="Run name"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Use the cycle and dates"
                />
              </label>
            ) : null}
            {prepare && !runId && cycle !== "Monthly" ? (
              <div className="pay-run-dates">
                {[
                  ["Starts", startDate, setStartDate],
                  ["Ends", endDate, setEndDate],
                  ["Pay date", payDate, setPayDate],
                ].map(([label, value, setter]) => (
                  <label className="period-picker" key={String(label)}>
                    {String(label)}
                    <input
                      className="native-select"
                      type="date"
                      aria-label={`Run ${label}`}
                      value={String(value)}
                      onChange={(e) =>
                        (setter as (v: string) => void)(e.target.value)
                      }
                    />
                  </label>
                ))}
              </div>
            ) : null}
            {prepare && !runId && cycle !== "Monthly" ? (
              <label className="check-label">
                <Checkbox
                  checked={finalInMonth}
                  onCheckedChange={(value) => setFinalInMonth(value === true)}
                />
                Last payday of this month
              </label>
            ) : null}
            {prepare && !runId ? (
              <select
                className="native-select"
                aria-label="Payroll scope"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
              >
                <option value="">Whole company</option>
                <optgroup label="Departments">
                  {workspace.records
                    .filter((r) => r.kind === "department")
                    .map((r) => (
                      <option key={r.id} value={"department:" + r.id}>
                        {String(r.data.name)}
                      </option>
                    ))}
                </optgroup>
                <optgroup label="Employees">
                  {workspace.records
                    .filter((r) => r.kind === "employee")
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {String(r.data.name)}
                      </option>
                    ))}
                </optgroup>
              </select>
            ) : null}
            <div className="table-actions">
              {staff && rows.length ? (
                <Button size="sm" variant="outline" asChild>
                  <a
                    href={`/api/export?type=payroll&period=${period}${runId ? `&runId=${runId}` : "&legacy=true"}`}
                  >
                    <Download size={14} />
                    CSV
                  </a>
                </Button>
              ) : null}
              {pay &&
              rows.some(
                (r) => r.data.status === "Published" && !r.data.voucherId,
              ) ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const selected = rows.filter(
                      (r) => r.data.status === "Published" && !r.data.voucherId,
                    );
                    void act(
                      "voucher-prepare",
                      {
                        id: selected[0].id,
                        data: {
                          recordIds: selected.map((r) => r.id),
                          title: "Payroll " + period,
                        },
                      },
                      "Payment voucher prepared",
                    );
                  }}
                >
                  Prepare voucher
                </Button>
              ) : null}
              {approve && drafts.length ? (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => setPublishing(true)}
                >
                  <CheckCheck size={15} />
                  Publish payslips
                </Button>
              ) : null}
            </div>
          </div>
          {rows.length ? (
            <>
              <div className="summary-strip">
                <div>
                  <small>Gross pay</small>
                  <strong>
                    {money(rows.reduce((n, r) => n + Number(r.data.gross), 0))}
                  </strong>
                </div>
                <div>
                  <small>Net pay</small>
                  <strong>
                    {money(rows.reduce((n, r) => n + Number(r.data.net), 0))}
                  </strong>
                </div>
                <div>
                  <small>Review progress</small>
                  <strong>
                    {rows.filter((r) => r.data.reviewed).length} / {rows.length}
                    <span> reviewed</span>
                  </strong>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Gross pay</th>
                      <th>Deductions</th>
                      <th>Net pay</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <Person
                            name={String(r.data.employeeName)}
                            detail={String(r.data.employeeTitle)}
                          />
                        </td>
                        <td>{money(r.data.gross)}</td>
                        <td>
                          {money(
                            Number(r.data.gross) +
                              Number(r.data.reimbursements || 0) -
                              Number(r.data.net),
                          )}
                        </td>
                        <td>
                          <strong>{money(r.data.net)}</strong>
                        </td>
                        <td>
                          <Status value={r.data.status} />
                          <small className="cell-detail">
                            {String(r.data.cycle || "Monthly")}
                            {r.data.startDate
                              ? ` · ${r.data.startDate} to ${r.data.endDate}`
                              : ""}
                          </small>
                          {r.data.status === "Draft" ? (
                            <small className="cell-detail">
                              {r.data.reviewed ? "Reviewed" : "Needs review"}
                            </small>
                          ) : null}
                        </td>
                        <td>
                          {r.data.status === "Draft" && prepare ? (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  void act(
                                    "payroll-refresh",
                                    { id: r.id },
                                    "Inputs refreshed; recalculate and review deductions",
                                  )
                                }
                              >
                                Refresh inputs
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  void act(
                                    "payroll-calculate",
                                    { id: r.id },
                                    "Deductions calculated; review before publishing",
                                  )
                                }
                              >
                                {r.data.cycle && r.data.cycle !== "Monthly"
                                  ? "Reconcile month-end deductions"
                                  : "Calculate statutory"}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => edit("payroll", r)}
                              >
                                <Pencil size={14} />
                                Review
                              </Button>
                            </>
                          ) : r.data.status === "Published" ? (
                            <Button asChild variant="outline" size="sm">
                              <a
                                href={`/payslip/${r.id}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <FileText size={14} />
                                Payslip
                              </a>
                            </Button>
                          ) : (
                            <span>Awaiting payroll review</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <Empty
              title={staff ? "Ready when you are" : "No published payslips"}
              description={
                staff
                  ? "Prepare payroll for this month, then review earnings and deductions for each employee."
                  : "Your payslips appear here after HR publishes them."
              }
            />
          )}{" "}
          {staff ? (
            <div className="info-note">
              Interim weekly, fortnightly and off-cycle runs require verified
              manual deductions. Reconcile statutory totals in the last pay run
              of the month, subtracting contributions already published.
              Off-cycle runs pay additional earnings without paying base salary
              twice. Use Calculate statutory after verifying the employee
              profile, or enter manually verified deductions. Every draft
              requires HR review before publication.
            </div>
          ) : null}
        </TabsContent>
        <TabsContent value="forms">
          <div className="table-toolbar">
            <label className="period-picker">
              Tax year
              <input
                aria-label="Tax year"
                type="number"
                className="native-select year-input"
                value={year}
                min={2020}
                max={2100}
                onChange={(e) => setYear(Number(e.target.value))}
              />
            </label>
            <a
              className="inline-link"
              href="https://mytax.hasil.gov.my/"
              target="_blank"
              rel="noreferrer"
            >
              Open MyTax
              <ExternalLink size={14} />
            </a>
          </div>
          <div className="info-note">
            These are preparation worksheets for employer review. They are not
            official forms or electronic submissions. Complete and verify the
            current HASiL form before filing.
          </div>
          <div className="record-cards">
            {[
              {
                type: "EA",
                title: "EA · annual remuneration",
                description:
                  "Summarise published payroll, earnings and employee deductions for the selected year.",
              },
              {
                type: "CP22",
                title: "CP22 · new employee",
                description:
                  "Review employee start dates and basic details before completing e-CP22 in MyTax.",
              },
              {
                type: "CP22A",
                title: "CP22A · cessation",
                description:
                  "Review archived employees with recorded end dates before completing the cessation process.",
              },
            ].map((f) => (
              <div className="record-card" key={f.type}>
                <FileText size={23} />
                <h3>{f.title}</h3>
                <p>{f.description}</p>
                <Button variant="outline" asChild>
                  <a href={`/api/export?type=${f.type}&year=${year}`}>
                    <Download size={14} />
                    Download worksheet
                  </a>
                </Button>
              </div>
            ))}
          </div>
          <a
            className="inline-link"
            href="https://www.hasil.gov.my/majikan/tanggungjawab-majikan/"
            target="_blank"
            rel="noreferrer"
          >
            Employer responsibilities and current forms
            <ExternalLink size={14} />
          </a>
        </TabsContent>
      </Tabs>
      <Dialog open={publishing} onOpenChange={setPublishing}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish this pay run’s payslips?</DialogTitle>
            <DialogDescription>
              {drafts.length} payslips for {period} will become visible to their
              employees. Published amounts are locked. This records payroll; it
              does not transfer funds.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setPublishing(false)}
            >
              Back
            </Button>
            <Button
              disabled={busy || drafts.some((r) => !r.data.reviewed)}
              onClick={publish}
            >
              Publish {drafts.length} payslips
            </Button>
          </DialogFooter>
          {drafts.some((r) => !r.data.reviewed) ? (
            <p className="form-hint">Review every draft before publishing.</p>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
import { toast } from "sonner";
function toastResult(message: string) {
  toast.success(message);
}
