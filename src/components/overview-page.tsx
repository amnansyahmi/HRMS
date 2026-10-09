"use client";
import {
  Users,
  Clock3,
  CalendarDays,
  BriefcaseBusiness,
  ArrowRight,
  MessageSquare,
  Receipt,
  ArrowUpRight,
  ClipboardCheck,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "./workspace-context";
import { PageHeader, Person, Status, Empty, InlineLink } from "./common";
import { shortDate } from "@/lib/client";
import { localDate } from "@/lib/calculations";
import { isStaff, type HRRecord } from "@/lib/types";
import { useState } from "react";
import { requestKinds, reviewOptions } from "@/lib/request-workflow";
import { RequestSummary, RequestReviewDialog } from "./request-review";
export function OverviewPage() {
  const { workspace, go, edit, ask } = useWorkspace(),
    { records, actor, company } = workspace;
  const [review, setReview] = useState<HRRecord | null>(null);
  const employees = records.filter(
      (r) => r.kind === "employee" && r.data.status !== "Archived",
    ),
    today = localDate(new Date(), company.settings.timezone),
    attendance = records.filter(
      (r) => r.kind === "attendance" && r.data.workDate === today,
    ),
    pending = records.filter(
      (r) =>
        [...requestKinds, "profile_change"].includes(r.kind) &&
        r.data.status === "Pending" &&
        (r.employee_id === actor.employeeId ||
          reviewOptions(actor, r, records).some((o) =>
            ["Approved", "Rejected", "Returned"].includes(o),
          )),
    ),
    jobs = records.filter(
      (r) => r.kind === "job" && r.data.status === "Published",
    ),
    goals = records.filter(
      (r) => r.kind === "goal" && r.data.status !== "Completed",
    );
  const employeeName = (id: string | null) =>
      String(employees.find((e) => e.id === id)?.data.name || "Employee"),
    staff = isStaff(actor),
    canReview = staff || actor.role === "manager";
  const metrics = [
    {
      label: "People",
      value: employees.length,
      detail: "Active team members",
      icon: Users,
      page: "people" as const,
    },
    {
      label: "Clocked in",
      value: attendance.filter((r) => !r.data.clockOut).length,
      detail: "Today, across your workspace",
      icon: Clock3,
      page: "attendance" as const,
    },
    {
      label: "Pending requests",
      value: pending.length,
      detail: "Requests awaiting a decision",
      icon: CalendarDays,
      page: "approvals" as const,
    },
    ...(staff
      ? [
          {
            label: "Open roles",
            value: jobs.length,
            detail: "Published on your career page",
            icon: BriefcaseBusiness,
            page: "recruitment" as const,
          },
        ]
      : []),
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
          staff ? (
            <Button variant="outline" onClick={() => edit("employee")}>
              <Users size={15} />
              Add employee
            </Button>
          ) : null
        }
      />
      <section className={`metrics-grid ${!staff ? "metrics-three" : ""}`}>
        {metrics.map((m) => (
          <button className="metric" key={m.label} onClick={() => go(m.page)}>
            <div>
              <span>{m.label}</span>
              <m.icon size={17} />
            </div>
            <strong>{m.value}</strong>
            <small>{m.detail}</small>
          </button>
        ))}
      </section>
      <section className="assistant-callout">
        <div className="assistant-callout-icon">
          <MessageSquare size={22} />
        </div>
        <div>
          <h2>People AI</h2>
          <p>Find an answer. Plan your next step.</p>
        </div>
        <Button
          variant="outline"
          onClick={() =>
            ask("hr", undefined, "What should I follow up on today?")
          }
        >
          Ask People AI
          <ArrowUpRight size={15} />
        </Button>
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
      <div className="overview-columns">
        <section className="panel">
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
                  {reviewOptions(actor, r, records).some((o) =>
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
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Working today</h2>
              <p>
                {shortDate(today)} ·{" "}
                {company.settings.timezone.replace("Asia/", "")}
              </p>
            </div>
            <InlineLink onClick={() => go("attendance")}>Attendance</InlineLink>
          </div>
          {attendance.length ? (
            <div className="today-list">
              {attendance.slice(0, 5).map((r) => (
                <div className="row-between" key={r.id}>
                  <Person
                    name={employeeName(r.employee_id)}
                    detail={String(r.data.location)}
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
      </div>
      <section className="panel goals-overview">
        <div className="panel-heading">
          <div>
            <h2>Goals in progress</h2>
            <p>
              {goals.length} active {goals.length === 1 ? "goal" : "goals"}
            </p>
          </div>
          <InlineLink onClick={() => go("performance")}>All goals</InlineLink>
        </div>
        {goals.length ? (
          <div className="goal-preview-grid">
            {goals.slice(0, 3).map((g) => (
              <button
                className="goal-preview"
                key={g.id}
                onClick={() => go("performance")}
              >
                <small>{employeeName(g.employee_id)}</small>
                <h3>{String(g.data.title)}</h3>
                <div className="mini-progress">
                  <span
                    style={{
                      width: `${Math.min(100, (Number(g.data.progress) / Number(g.data.target)) * 100)}%`,
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
