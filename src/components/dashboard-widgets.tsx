"use client";
import { useState } from "react";
import { Clock3, CalendarDays, ArrowRight, LogIn, LogOut } from "lucide-react";
import type { dashboardSnapshot } from "@/lib/dashboard";
import { leaveEntitlement } from "@/lib/leave-entitlement";
import { addCalendarDays } from "@/lib/hr-calendar";
import { Button } from "./ui/button";
import { InlineLink } from "./common";
import { useWorkspace } from "./workspace-context";

type Snapshot = ReturnType<typeof dashboardSnapshot>;
export function WorkdayWidget({ snapshot }: { snapshot: Snapshot }) {
  const { workspace, go, edit } = useWorkspace();
  const { own, open, today, records, events } = snapshot;
  if (!own) return null;
  const policy = records.find(
    (r) =>
      r.kind === "leave_type" &&
      r.data.name === "Annual" &&
      (!r.data.departmentId || r.data.departmentId === own.data.departmentId),
  );
  const balance = leaveEntitlement(
    own,
    policy || null,
    "Annual",
    today,
    today,
    records.filter((r) => r.kind === "leave"),
  );
  const shift = events.find(
    (e) => e.kind === "shift" && e.employeeId === own.id,
  );
  const start =
    open?.data.clockIn && !Number.isNaN(Date.parse(String(open.data.clockIn)))
      ? new Intl.DateTimeFormat("en-MY", {
          timeZone: workspace.company.settings.timezone,
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date(String(open.data.clockIn)))
      : null;
  return (
    <section
      className="panel dashboard-widget workday-widget"
      data-dashboard-widget="workday"
    >
      <div className="panel-heading">
        <h2>
          <Clock3 size={18} />
          My workday
        </h2>
        <span className={`workday-state ${open ? "working" : ""}`}>
          {open ? "Clocked in" : "Clocked out"}
        </span>
      </div>
      <div className="widget-body">
        <h3>{open ? "Your day is underway." : "Ready when you are."}</h3>
        <p>
          {open
            ? `${start ? `Started at ${start}` : "Session in progress"} · ${String(open.data.location || "Workplace")}`
            : "Open attendance to choose your workplace and clock in."}
        </p>
        <Button onClick={() => go("attendance")}>
          {open ? <LogOut size={16} /> : <LogIn size={16} />}
          {open ? "Manage clock-out" : "Clock in"}
          <ArrowRight size={16} />
        </Button>
        <div className="workday-details">
          <div>
            <small>Annual leave available</small>
            <strong>
              {balance && Number.isFinite(balance.available)
                ? `${balance.available} days`
                : "Not set"}
            </strong>
            <span>Pending requests reserve balance</span>
          </div>
          <div>
            <small>Next scheduled shift</small>
            <strong>
              {shift
                ? `${shift.start} – ${shift.end}${shift.overnight ? " (+1 day)" : ""}`
                : "No shift scheduled"}
            </strong>
            <span>
              {shift
                ? shift.date === today
                  ? "Today"
                  : new Intl.DateTimeFormat("en-MY", {
                      timeZone: "UTC",
                      day: "numeric",
                      month: "short",
                    }).format(new Date(shift.date + "T12:00:00Z"))
                : "Check your team calendar"}
            </span>
          </div>
        </div>
        <button className="widget-text-action" onClick={() => edit("leave")}>
          <CalendarDays size={16} />
          Request leave
          <ArrowRight size={14} />
        </button>
      </div>
    </section>
  );
}
export function AgendaWidget({ snapshot }: { snapshot: Snapshot }) {
  const { go, workspace } = useWorkspace();
  const { today, events } = snapshot;
  const [selected, setSelected] = useState(today);
  const activeDate =
    selected < today || selected > addCalendarDays(today, 6) ? today : selected;
  const days = Array.from({ length: 7 }, (_, i) => addCalendarDays(today, i));
  const dayEvents = events.filter((e) => e.date === activeDate);
  const format = (date: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-MY", { ...options, timeZone: "UTC" }).format(
      new Date(date + "T12:00:00Z"),
    );
  return (
    <section
      className="panel dashboard-widget agenda-widget"
      data-dashboard-widget="agenda"
    >
      <div className="panel-heading">
        <div>
          <h2>
            <CalendarDays size={18} />
            This week
          </h2>
          <p>
            {workspace.actor.role === "employee"
              ? "Your schedule"
              : "Your available team schedule"}
          </p>
        </div>
        <InlineLink onClick={() => go("calendar")}>Calendar</InlineLink>
      </div>
      <div className="widget-body">
        <div className="agenda-days" aria-label="Upcoming seven days">
          {days.map((date) => (
            <button
              key={date}
              aria-label={format(date, {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
              aria-pressed={date === activeDate}
              onClick={() => setSelected(date)}
            >
              <small>{format(date, { weekday: "short" })}</small>
              <strong>{Number(date.slice(8))}</strong>
              <i
                className={
                  events.some((e) => e.date === date) ? "has-events" : ""
                }
                aria-hidden="true"
              />
            </button>
          ))}
        </div>
        <div className="agenda-event-heading">
          {activeDate === today
            ? "Today"
            : format(activeDate, {
                weekday: "long",
                day: "numeric",
                month: "short",
              })}
          <span>
            {dayEvents.length} {dayEvents.length === 1 ? "event" : "events"}
          </span>
        </div>
        <div className="agenda-events" aria-live="polite">
          {dayEvents.length ? (
            dayEvents.slice(0, 3).map((event) => (
              <button
                key={event.id}
                onClick={() =>
                  go(event.kind === "shift" ? "attendance" : "calendar")
                }
              >
                <i
                  className={`agenda-marker marker-${event.kind}`}
                  aria-hidden="true"
                />
                <span>
                  <strong>{event.title}</strong>
                  <small>
                    {event.start
                      ? `${event.start} – ${event.end}${event.overnight ? " (+1 day)" : ""}`
                      : event.kind === "holiday"
                        ? "Holiday"
                        : "All day · Approved"}
                  </small>
                </span>
                <ArrowRight size={15} />
              </button>
            ))
          ) : (
            <p className="widget-empty">
              No scheduled events. Your day is clear.
            </p>
          )}
          {dayEvents.length > 3 ? (
            <button
              className="widget-text-action"
              onClick={() => go("calendar")}
            >
              View {dayEvents.length - 3} more in calendar
              <ArrowRight size={14} />
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
