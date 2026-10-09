"use client";
import { sameClaimPeriod } from "@/lib/claim-period";
import { reviewOptions, approvalStage } from "@/lib/request-workflow";
import { leaveEntitlement } from "@/lib/leave-entitlement";
import { toast } from "sonner";
import { AttendanceCamera } from "./attendance-camera";
import { CalendarPage } from "./calendar-page";
import { ShiftRoster } from "./shift-roster";
import { useState } from "react";
import {
  Receipt,
  Clock3,
  Pencil,
  Check,
  X,
  Paperclip,
  LogIn,
  LogOut,
  CalendarDays,
  Camera,
} from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "./workspace-context";
import {
  PageHeader,
  Person,
  Status,
  SearchField,
  Empty,
  AddButton,
  NativeSelect,
} from "./common";
import { shortDate, money } from "@/lib/client";
import { localDate } from "@/lib/calculations";
import { hasPayroll } from "@/lib/workflow-config";
import { isStaff, type HRRecord } from "@/lib/types";
export function AttendancePage() {
  const { workspace, edit, act } = useWorkspace(),
    [tab, setTab] = useState("attendance"),
    [search, setSearch] = useState(""),
    [location, setLocation] = useState("Office"),
    [locationId, setLocationId] = useState(""),
    [camera, setCamera] = useState(false),
    [busy, setBusy] = useState(false),
    staff = isStaff(workspace.actor),
    employees = workspace.records.filter((r) => r.kind === "employee"),
    shifts = workspace.records.filter((r) => r.kind === "shift"),
    today = localDate(new Date(), workspace.company.settings.timezone),
    [day, setDay] = useState(today);
  const employeeName = (id: string | null) =>
      String(employees.find((e) => e.id === id)?.data.name || "Employee"),
    rows = workspace.records.filter(
      (r) =>
        r.kind === "attendance" &&
        r.data.workDate === day &&
        employeeName(r.employee_id)
          .toLowerCase()
          .includes(search.toLowerCase()),
    ),
    open = workspace.records.find(
      (r) =>
        r.kind === "attendance" &&
        r.employee_id === workspace.actor.employeeId &&
        !r.data.clockOut,
    );
  const time = (value: unknown) =>
    value
      ? new Intl.DateTimeFormat("en-MY", {
          timeZone: workspace.company.settings.timezone,
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(String(value)))
      : "—";
  async function clock(photo?: { photoId: string; capturedAt: string }) {
    setBusy(true);
    try {
      return await act(
        "clock",
        {
          ...photo,
          action: open ? "out" : "in",
          location,
          locationId: locationId || null,
          coordinates:
            workspace.company.settings.attendanceEvidence?.locationRequired ||
            (!open &&
              workspace.records.find((r) => r.id === locationId)?.data.geofence)
              ? await new Promise<{
                  latitude: number;
                  longitude: number;
                  accuracy: number;
                }>((resolve, reject) =>
                  navigator.geolocation.getCurrentPosition(
                    (p) =>
                      resolve({
                        latitude: p.coords.latitude,
                        longitude: p.coords.longitude,
                        accuracy: p.coords.accuracy,
                      }),
                    (e) => reject(new Error(e.message)),
                    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
                  ),
                )
              : null,
        },
        open ? "Clocked out" : "Clocked in",
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        title="Attendance & shifts"
        description={`Keep working time clear. Times shown in ${workspace.company.settings.timezone}.`}
        action={
          staff && tab === "shifts" ? (
            <AddButton onClick={() => edit("shift")}>Add shift</AddButton>
          ) : null
        }
      />
      {workspace.actor.employeeId ? (
        <section className="clock-panel">
          <div className="clock-panel-icon">
            <Clock3 size={24} />
          </div>
          <div>
            <strong>
              {open ? "You’re clocked in" : "Ready to start your day?"}
            </strong>
            <p>
              {open
                ? `Started at ${time(open.data.clockIn)} · ${open.data.location}`
                : "Your clock-in time is recorded when you press the button."}
            </p>
          </div>
          <div className="clock-actions">
            {!open && workspace.records.some((r) => r.kind === "location") ? (
              <NativeSelect
                label="Named workplace"
                value={locationId}
                onChange={setLocationId}
                options={[
                  { value: "", label: "Choose workplace" },
                  ...workspace.records
                    .filter((r) => r.kind === "location")
                    .map((r) => ({ value: r.id, label: String(r.data.name) })),
                ]}
              />
            ) : null}
            {!open ? (
              <NativeSelect
                label="Work location"
                value={location}
                onChange={setLocation}
                options={["Office", "Remote", "Client site"].map((v) => ({
                  value: v,
                  label: v,
                }))}
              />
            ) : null}
            <Button
              disabled={busy}
              onClick={() =>
                workspace.company.settings.attendanceEvidence?.photoRequired
                  ? setCamera(true)
                  : void clock()
              }
            >
              {open ? <LogOut size={16} /> : <LogIn size={16} />}Clock{" "}
              {open ? "out" : "in"}
            </Button>
            {!workspace.company.settings.attendanceEvidence?.photoRequired ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setCamera(true)}
              >
                <Camera size={16} />
                With photo
              </Button>
            ) : null}
          </div>
        </section>
      ) : (
        <div className="info-note">
          Link your account to an employee through Settings to use clock-in and
          self-service requests.
        </div>
      )}
      {camera ? (
        <AttendanceCamera
          action={open ? "out" : "in"}
          onClose={() => setCamera(false)}
          onConfirm={clock}
        />
      ) : null}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          <TabsTrigger value="shifts">Shifts</TabsTrigger>
          <TabsTrigger value="roster">Roster</TabsTrigger>
        </TabsList>
        <TabsContent value="roster">
          <ShiftRoster />
        </TabsContent>
        <TabsContent value="attendance">
          <div className="table-toolbar">
            <SearchField
              value={search}
              onChange={setSearch}
              placeholder="Search people…"
            />
            <input
              className="native-select date-input"
              aria-label="Attendance date"
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </div>
          {rows.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Clock in</th>
                    <th>Clock out</th>
                    <th>Hours</th>
                    <th>Location</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Person name={employeeName(r.employee_id)} />
                      </td>
                      <td>{time(r.data.clockIn)}</td>
                      <td>{time(r.data.clockOut)}</td>
                      <td>
                        {r.data.clockOut
                          ? (
                              (Date.parse(String(r.data.clockOut)) -
                                Date.parse(String(r.data.clockIn))) /
                              3600000
                            ).toFixed(1)
                          : "In progress"}
                      </td>
                      <td>
                        {String(r.data.location)}
                        <div className="attendance-evidence-links">
                          {(
                            ["clockInEvidence", "clockOutEvidence"] as const
                          ).map((key) => {
                            const evidence = r.data[key] as
                              { photoId?: string } | undefined;
                            return evidence?.photoId ? (
                              <a
                                key={key}
                                href={`/api/files/${evidence.photoId}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <Camera size={13} />
                                {key === "clockInEvidence"
                                  ? "In photo"
                                  : "Out photo"}
                              </a>
                            ) : null;
                          })}
                        </div>
                      </td>
                      <td>
                        <Status
                          value={
                            Number(r.data.lateMinutes) > 0
                              ? `Late · ${r.data.lateMinutes}m`
                              : "On time"
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="No attendance for this date"
              description="Clock-ins will appear here as your team starts work."
            />
          )}
        </TabsContent>
        <TabsContent value="shifts">
          <div className="record-cards">
            {shifts.map((s) => (
              <div className="record-card" key={s.id}>
                <div className="row-between">
                  <Clock3 size={22} />
                  {staff ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${s.data.name}`}
                      onClick={() => edit("shift", s)}
                    >
                      <Pencil size={15} />
                    </Button>
                  ) : null}
                </div>
                <h3>{String(s.data.name)}</h3>
                <p className="shift-hours">
                  {String(s.data.start)} — {String(s.data.end)}
                </p>
                <div className="day-labels">
                  {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                    <span
                      key={i}
                      className={
                        (s.data.days as number[]).includes(i) ? "active" : ""
                      }
                    >
                      {d}
                    </span>
                  ))}
                </div>
                <small>
                  {(s.data.employeeIds as string[]).length} assigned ·{" "}
                  {Number(s.data.graceMinutes)} min grace
                </small>
              </div>
            ))}
          </div>
          {!shifts.length ? (
            <Empty
              title="Plan a clearer week"
              description="Add a shift and assign employees."
            />
          ) : null}
        </TabsContent>
      </Tabs>
    </>
  );
}
export function RequestsPage({ kind }: { kind: "leave" | "claim" }) {
  const { workspace, edit, act } = useWorkspace(),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("All"),
    [review, setReview] = useState<{
      record: HRRecord;
      decision: string;
    } | null>(null),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    employees = workspace.records.filter((r) => r.kind === "employee"),
    staff = isStaff(workspace.actor),
    own = workspace.records.find((r) => r.id === workspace.actor.employeeId),
    year = Number(
      localDate(new Date(), workspace.company.settings.timezone).slice(0, 4),
    );
  const employeeName = (id: string | null) =>
      String(employees.find((e) => e.id === id)?.data.name || "Employee"),
    all = workspace.records.filter((r) => r.kind === kind),
    rows = all.filter(
      (r) =>
        (status === "All" || r.data.status === status) &&
        `${employeeName(r.employee_id)} ${JSON.stringify(r.data)}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    );
  const [balanceDate] = useState(() =>
    localDate(new Date(), workspace.company.settings.timezone),
  );
  const leavePolicies = workspace.records.filter(
    (r) =>
      r.kind === "leave_type" &&
      (!r.data.departmentId || r.data.departmentId === own?.data.departmentId),
  );
  const balance = (type: string) =>
    own
      ? leaveEntitlement(
          own,
          leavePolicies.find((p) => p.data.name === type) || null,
          type,
          balanceDate,
          balanceDate,
          all,
        ) || { allowance: 0, available: 0 }
      : { allowance: 0, available: 0 };
  async function decide() {
    if (!review) return;
    setBusy(true);
    try {
      const result = await act(
        "review",
        {
          id: review.record.id,
          expectedUpdatedAt: review.record.updated_at,
          decision: review.decision,
          note,
        },
        `Request ${review.decision.toLowerCase()}`,
      );
      if (result) setReview(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        title={kind === "leave" ? "Leave & time off" : "Expense claims"}
        description={
          kind === "leave"
            ? "A little time away, without the paperwork."
            : "Submit, review and follow through on team expenses."
        }
        action={
          staff || workspace.actor.employeeId ? (
            <AddButton onClick={() => edit(kind)}>
              {kind === "leave" ? "Request leave" : "Submit claim"}
            </AddButton>
          ) : null
        }
      />
      {kind === "claim" && staff ? (
        <div className="table-toolbar">
          <Button size="sm" variant="outline" asChild>
            <a href={`/api/export?type=claims&year=${year}`}>
              Year-to-date claims CSV
            </a>
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!hasPayroll(workspace.actor, "pay")}
            onClick={() => {
              const claims = workspace.records.filter(
                (r) =>
                  r.kind === "claim" &&
                  r.data.status === "Approved" &&
                  !r.data.payrollId &&
                  !r.data.voucherId,
              );
              if (!claims.length)
                return toast.error("No unpaid approved claims");
              void act(
                "voucher-prepare",
                {
                  id: claims[0].id,
                  data: {
                    recordIds: claims.map((r) => r.id),
                    title: "Claim reimbursements",
                  },
                },
                "Voucher prepared",
              );
            }}
          >
            Prepare reimbursement voucher
          </Button>
        </div>
      ) : null}
      {kind === "leave" && own ? (
        <div className="leave-balances">
          {[
            ...new Set([
              "Annual",
              "Sick",
              ...leavePolicies.map((p) => String(p.data.name)),
            ]),
          ].map((type) => {
            const b = balance(type);
            return (
              <div key={type}>
                <CalendarDays size={18} />
                <div>
                  <small>
                    {type} leave · {year}
                  </small>
                  <strong>
                    {b.available} <span>days available</span>
                  </strong>
                  <p>
                    of {b.allowance} days · pending requests reserve balance
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
      {kind === "leave" ? (
        <section className="panel leave-calendar">
          <CalendarPage compact />
        </section>
      ) : null}
      {kind === "claim" && own ? (
        <div className="leave-balances">
          {workspace.records
            .filter(
              (r) =>
                r.kind === "claim_type" &&
                (!r.data.departmentId ||
                  r.data.departmentId === own.data.departmentId),
            )
            .map((policy) => {
              const period = policy.data.period,
                used = ["Per request", "Per trip"].includes(String(period))
                  ? 0
                  : all
                      .filter(
                        (r) =>
                          r.employee_id === own.id &&
                          r.data.claimTypeId === policy.id &&
                          ["Pending", "Approved", "Paid"].includes(
                            String(r.data.status),
                          ) &&
                          sameClaimPeriod(period, r.data, {
                            date: balanceDate,
                          }),
                      )
                      .reduce((n, r) => n + Number(r.data.amount), 0);
              return (
                <div key={policy.id}>
                  <Receipt size={18} />
                  <div>
                    <small>
                      {String(policy.data.name)} · {String(period)}
                    </small>
                    <strong>
                      {money(Math.max(0, Number(policy.data.limit) - used))}{" "}
                      {period === "Per trip" ? "limit per trip" : "available"}
                    </strong>
                    <p>Pending claims reserve balance</p>
                  </div>
                </div>
              );
            })}
        </div>
      ) : null}
      {kind === "claim" ? (
        <div className="summary-strip">
          <div>
            <small>Pending review</small>
            <strong>
              {money(
                all
                  .filter((r) => r.data.status === "Pending")
                  .reduce((n, r) => n + Number(r.data.amount), 0),
              )}
            </strong>
          </div>
          <div>
            <small>Approved, awaiting payment</small>
            <strong>
              {money(
                all
                  .filter((r) => r.data.status === "Approved")
                  .reduce((n, r) => n + Number(r.data.amount), 0),
              )}
            </strong>
          </div>
          <div>
            <small>Paid</small>
            <strong>
              {money(
                all
                  .filter((r) => r.data.status === "Paid")
                  .reduce((n, r) => n + Number(r.data.amount), 0),
              )}
            </strong>
          </div>
        </div>
      ) : null}
      <div className="table-toolbar">
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Search requests…"
        />
        <NativeSelect
          label="Request status"
          value={status}
          onChange={setStatus}
          options={[
            "All",
            "Pending",
            "Approved",
            "Rejected",
            "Cancelled",
            ...(kind === "claim" ? ["Returned", "Paid"] : []),
          ].map((v) => ({ value: v, label: v === "All" ? "All statuses" : v }))}
        />
      </div>
      {rows.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>{kind === "leave" ? "Leave" : "Expense"}</th>
                <th>{kind === "leave" ? "Dates" : "Date"}</th>
                <th>{kind === "leave" ? "Days" : "Amount"}</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const self =
                  r.employee_id === workspace.actor.employeeId ||
                  employees.find((e) => e.id === r.employee_id)?.data.email ===
                    workspace.actor.email;
                const options = reviewOptions(
                  workspace.actor,
                  r,
                  workspace.records,
                );
                return (
                  <tr key={r.id}>
                    <td>
                      <Person name={employeeName(r.employee_id)} />
                    </td>
                    <td>
                      <strong>{String(r.data.type || r.data.category)}</strong>
                      <small
                        className="cell-detail"
                        title={String(r.data.reason || r.data.description)}
                      >
                        {String(r.data.reason || r.data.description)}
                      </small>
                      {kind === "claim" &&
                      (r.data.history as unknown[])?.length ? (
                        <details className="claim-history">
                          <summary>Submission history</summary>
                          {(
                            r.data.history as {
                              at: string;
                              by: string;
                              action: string;
                              note: string;
                              snapshot?: { amount?: number };
                            }[]
                          ).map((h, i) => (
                            <p key={i}>
                              {shortDate(h.at)} · {h.by} · {h.action}
                              {h.snapshot?.amount !== undefined
                                ? ` · ${money(h.snapshot.amount)}`
                                : ""}
                              {h.note ? ` — ${h.note}` : ""}
                            </p>
                          ))}
                        </details>
                      ) : null}
                      {r.data.reviewNote ? (
                        <small className="cell-detail">
                          Review: {String(r.data.reviewNote)}
                        </small>
                      ) : null}
                    </td>
                    <td>
                      {shortDate(r.data.startDate || r.data.date)}
                      {kind === "leave" &&
                      r.data.endDate !== r.data.startDate ? (
                        <small className="cell-detail">
                          to {shortDate(r.data.endDate)}
                        </small>
                      ) : null}
                    </td>
                    <td>
                      {kind === "leave"
                        ? Number(r.data.days)
                        : money(r.data.amount)}
                    </td>
                    <td>
                      <Status value={r.data.status} />
                      {r.data.status === "Pending" ? (
                        <small className="cell-detail">
                          {approvalStage(r, workspace.records)}
                        </small>
                      ) : null}
                    </td>
                    <td>
                      <div className="table-actions">
                        {r.data.receiptId ? (
                          <Button asChild variant="ghost" size="icon">
                            <a
                              aria-label="Download receipt"
                              href={`/api/files/${r.data.receiptId}`}
                            >
                              <Paperclip size={15} />
                            </a>
                          </Button>
                        ) : null}
                        {options.includes("Approved") ? (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              aria-label={`Approve request from ${employeeName(r.employee_id)}`}
                              onClick={() => {
                                setReview({ record: r, decision: "Approved" });
                                setNote("");
                              }}
                            >
                              <Check size={14} />
                              Approve
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Reject request"
                              onClick={() => {
                                setReview({ record: r, decision: "Rejected" });
                                setNote("");
                              }}
                            >
                              <X size={15} />
                            </Button>
                          </>
                        ) : null}
                        {options.includes("Rejected") &&
                        !options.includes("Approved") ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setReview({ record: r, decision: "Rejected" });
                              setNote("");
                            }}
                          >
                            Reject
                          </Button>
                        ) : null}
                        {kind === "claim" &&
                        r.data.status === "Pending" &&
                        options.includes("Returned") ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setReview({ record: r, decision: "Returned" });
                              setNote("");
                            }}
                          >
                            Return for correction
                          </Button>
                        ) : null}
                        {kind === "claim" &&
                        r.data.status === "Returned" &&
                        self ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => edit("claim", r)}
                          >
                            Correct & resubmit
                          </Button>
                        ) : null}
                        {r.data.status === "Pending" && self ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setReview({ record: r, decision: "Cancelled" });
                              setNote("");
                            }}
                          >
                            Cancel
                          </Button>
                        ) : null}
                        {kind === "claim" &&
                        r.data.status === "Approved" &&
                        options.includes("Paid") ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setReview({ record: r, decision: "Paid" });
                              setNote("");
                            }}
                          >
                            Mark paid
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          title="No requests to show"
          description="New submissions and their status will appear here."
        />
      )}
      <Dialog
        open={!!review}
        onOpenChange={(open) => !open && !busy && setReview(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {review?.decision === "Approved"
                ? "Approve request"
                : review?.decision === "Rejected"
                  ? "Reject request"
                  : review?.decision === "Returned"
                    ? "Return claim for correction"
                    : review?.decision === "Paid"
                      ? "Mark claim as paid"
                      : "Cancel request"}
            </DialogTitle>
            <DialogDescription>
              {review
                ? `${employeeName(review.record.employee_id)} · ${review.record.data.type || review.record.data.category}`
                : ""}
              {review?.decision === "Paid"
                ? ". Record a payment that has already been made."
                : ""}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label="Review note"
            placeholder={
              review?.decision === "Returned"
                ? "Explain what needs correcting (required)"
                : "Add a note (optional)"
            }
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReview(null)}
              disabled={busy}
            >
              Back
            </Button>
            <Button
              disabled={
                busy || (review?.decision === "Returned" && !note.trim())
              }
              onClick={decide}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
