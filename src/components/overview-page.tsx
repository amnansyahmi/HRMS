"use client";
import { HRDigest } from "./hr-digest";
import {
  Users,
  Clock3,
  CalendarDays,
  BriefcaseBusiness,
  ArrowRight,
  Receipt,
  ClipboardCheck,
  UserRound,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "./workspace-context";
import { PageHeader, Person, Status, Empty, InlineLink } from "./common";
import {
  dashboardSnapshot,
  dashboardWidgets,
  goalPercent,
} from "@/lib/dashboard";
import {
  DashboardPreferences,
  useDashboardWidgets,
} from "./dashboard-preferences";
import {
  AttendanceActivityWidget,
  RequestBreakdownWidget,
} from "./dashboard-charts";
import { WorkdayWidget, AgendaWidget } from "./dashboard-widgets";
import { isStaff, type HRRecord } from "@/lib/types";
import { useState } from "react";
import { reviewOptions } from "@/lib/request-workflow";
import { RequestSummary, RequestReviewDialog } from "./request-review";
export function OverviewPage() {
  const { workspace, go, edit } = useWorkspace(),
    { actor, company } = workspace;
  const [review, setReview] = useState<HRRecord | null>(null);
  const snapshot = dashboardSnapshot(workspace);
  const { employees, today, attendance, pending, jobs, goals } = snapshot;
  const { hidden, update } = useDashboardWidgets(company.id, actor.userId);
  const show = (id: import("@/lib/dashboard").DashboardWidget) =>
    !hidden.includes(id);
  const employeeName = (id: string | null) =>
      String(employees.find((e) => e.id === id)?.data.name || "Employee"),
    staff = isStaff(actor),
    canReview = staff || actor.role === "manager";
  const metrics = [
    {
      label: "People",
      tone: "teal",
      value: employees.length,
      detail: "People in your directory",
      icon: Users,
      page: "people" as const,
    },
    {
      label: "Clocked in",
      tone: "blue",
      value: snapshot.clockedIn,
      detail: "Active sessions available to you",
      icon: Clock3,
      page: "attendance" as const,
    },
    {
      label: "Pending requests",
      tone: "amber",
      value: pending.length,
      detail: canReview
        ? "Your available pending requests"
        : "Track your pending requests",
      icon: CalendarDays,
      page: "approvals" as const,
    },
    ...(staff
      ? [
          {
            label: "Open roles",
            tone: "violet",
            value: jobs.length,
            detail: "Published on your career page",
            icon: BriefcaseBusiness,
            page: "recruitment" as const,
          },
        ]
      : [
          {
            label: "Away today",
            tone: "violet",
            value: snapshot.away,
            detail: "Approved time away",
            icon: CalendarDays,
            page: "calendar" as const,
          },
        ]),
  ];
  return (
    <>
      <PageHeader
        eyebrow={new Intl.DateTimeFormat("en-MY", {
          timeZone: company.settings.timezone,
          weekday: "long",
          day: "numeric",
          month: "long",
        }).format(new Date())}
        title={`Your workday, ${actor.name.split(" ")[0]}.`}
        description="Team activity and the work that needs your attention."
        action={
          <div className="dashboard-heading-actions">
            <DashboardPreferences
              hidden={hidden}
              update={update}
              hasEmployee={!!snapshot.own}
            />
            {staff ? (
              <Button onClick={() => edit("employee")}>
                <Plus size={15} />
                Add employee
              </Button>
            ) : null}
          </div>
        }
      />
      <section
        className="metrics-grid dashboard-metrics"
        aria-label="Dashboard summary"
      >
        {metrics.map((m) => (
          <button
            className={`metric metric-${m.tone}`}
            key={m.label}
            onClick={() => go(m.page)}
          >
            <div>
              <span>{m.label}</span>
              <m.icon size={17} />
            </div>
            <strong>{m.value}</strong>
            <small>{m.detail}</small>
          </button>
        ))}
      </section>
      <div className="overview-shortcuts" aria-label="Quick access">
        {[
          {
            page: "approvals" as const,
            label: "Approval inbox",
            detail: canReview ? "Review team requests" : "Track your requests",
            icon: ClipboardCheck,
          },
          {
            page: "calendar" as const,
            label: "Team calendar",
            detail: "See what’s coming up",
            icon: CalendarDays,
          },
          {
            page: "my-profile" as const,
            label: "My profile",
            detail: "Manage your details",
            icon: UserRound,
          },
        ].map((item) => (
          <button key={item.page} onClick={() => go(item.page)}>
            <item.icon size={20} aria-hidden="true" />
            <span>
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </span>
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        ))}
      </div>
      <div className="dashboard-grid">
        {show("workday") ? <WorkdayWidget snapshot={snapshot} /> : null}
        {show("agenda") ? <AgendaWidget snapshot={snapshot} /> : null}
        {show("activity") ? (
          <AttendanceActivityWidget snapshot={snapshot} />
        ) : null}
        {show("request-mix") ? (
          <RequestBreakdownWidget snapshot={snapshot} />
        ) : null}
        {show("requests") ? (
          <section
            className="panel dashboard-widget"
            data-dashboard-widget="requests"
          >
            <div className="panel-heading">
              <div>
                <h2>{canReview ? "Needs your attention" : "Your requests"}</h2>
                <p>
                  {pending.length} pending{" "}
                  {pending.length === 1 ? "request" : "requests"}
                </p>
              </div>
              <InlineLink onClick={() => go("approvals")}>View all</InlineLink>
            </div>
            {pending.length ? (
              <div className="request-list">
                {pending.slice(0, 5).map((r) => (
                  <div className="request-row" key={r.id}>
                    <span className="request-icon">
                      {r.kind === "leave" ? (
                        <CalendarDays size={17} />
                      ) : (
                        <Receipt size={17} />
                      )}
                    </span>
                    <div>
                      <strong>{employeeName(r.employee_id)}</strong>
                      <small>
                        <RequestSummary record={r} />
                      </small>
                    </div>
                    {reviewOptions(actor, r, snapshot.records).some((o) =>
                      ["Approved", "Rejected", "Returned"].includes(o),
                    ) ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setReview(r)}
                      >
                        Review
                      </Button>
                    ) : (
                      <Status value={r.data.status} />
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <Empty
                title="You’re all caught up"
                description="Pending requests will appear here."
              />
            )}
          </section>
        ) : null}
        {show("attendance") ? (
          <section
            className="panel dashboard-widget"
            data-dashboard-widget="attendance"
          >
            <div className="panel-heading">
              <div>
                <h2>Working today</h2>
                <p>
                  {new Intl.DateTimeFormat("en-MY", {
                    timeZone: "UTC",
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  }).format(new Date(today + "T12:00:00Z"))}{" "}
                  · {company.settings.timezone.replace("Asia/", "")}
                </p>
              </div>
              <InlineLink onClick={() => go("attendance")}>
                Attendance
              </InlineLink>
            </div>
            {attendance.length ? (
              <div className="today-list">
                {attendance.slice(0, 5).map((r) => (
                  <div className="row-between" key={r.id}>
                    <Person
                      name={employeeName(r.employee_id)}
                      detail={String(r.data.location || "Workplace")}
                    />
                    <Status
                      value={
                        r.data.clockOut
                          ? "Clocked out"
                          : Number(r.data.lateMinutes) > 0
                            ? "Late"
                            : "On time"
                      }
                    />
                  </div>
                ))}
              </div>
            ) : (
              <Empty
                title="No clock-ins yet"
                description="Today’s attendance will appear here."
              />
            )}
          </section>
        ) : null}
        {show("digest") ? (
          <div className="dashboard-digest" data-dashboard-widget="digest">
            <HRDigest />
          </div>
        ) : null}
        {show("goals") ? (
          <section
            className="panel goals-overview dashboard-widget"
            data-dashboard-widget="goals"
          >
            <div className="panel-heading">
              <div>
                <h2>Goals in progress</h2>
                <p>
                  {goals.length} active {goals.length === 1 ? "goal" : "goals"}
                </p>
              </div>
              <InlineLink onClick={() => go("performance")}>
                All goals
              </InlineLink>
            </div>
            {goals.length ? (
              <div className="goal-preview-grid">
                {goals.slice(0, 3).map((g) => (
                  <button
                    className="goal-preview"
                    key={g.id}
                    onClick={() => go("performance")}
                  >
                    <small>
                      {g.data.scope === "Company"
                        ? "Company goal"
                        : g.data.scope === "Team"
                          ? "Team goal"
                          : employeeName(g.employee_id)}
                    </small>
                    <h3>{String(g.data.title)}</h3>
                    <div
                      className="mini-progress"
                      role="progressbar"
                      aria-label={String(g.data.title)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={goalPercent(
                        g.data.progress,
                        g.data.target,
                      )}
                    >
                      <span
                        style={{
                          width: `${goalPercent(g.data.progress, g.data.target)}%`,
                        }}
                      />
                    </div>
                    <div className="row-between">
                      <span>
                        {g.data.progress as number} / {g.data.target as number}{" "}
                        {String(g.data.unit)}
                      </span>
                      <ArrowRight size={15} />
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <Empty
                title="Make room for growth"
                description="Add team goals and keep progress in view."
              />
            )}
          </section>
        ) : null}
      </div>
      {dashboardWidgets
        .filter((widget) => widget.id !== "workday" || snapshot.own)
        .every((widget) => hidden.includes(widget.id)) ? (
        <p className="dashboard-empty">
          Your widgets are hidden. Use Widgets to add them back.
        </p>
      ) : null}
      {review ? (
        <RequestReviewDialog
          key={review.id}
          record={review}
          onClose={() => setReview(null)}
        />
      ) : null}
    </>
  );
}
