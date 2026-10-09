"use client";
import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  CalendarDays,
} from "lucide-react";
import { useWorkspace } from "./workspace-context";
import { PageHeader, Empty, NativeSelect } from "./common";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { localDate } from "@/lib/calculations";
import {
  addCalendarDays,
  calendarEvents,
  type CalendarEvent,
} from "@/lib/hr-calendar";
import { isStaff } from "@/lib/types";

export function CalendarPage() {
  const { workspace } = useWorkspace(),
    today = localDate(new Date(), workspace.company.settings.timezone);
  const [month, setMonth] = useState(today.slice(0, 7)),
    [scope, setScope] = useState(
      workspace.actor.role === "employee" ? "mine" : "team",
    ),
    [category, setCategory] = useState("All"),
    [pending, setPending] = useState(false);
  const start = `${month}-01`,
    end = addCalendarDays(
      `${month}-01`,
      new Date(
        Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
      ).getUTCDate() - 1,
    );
  const events = calendarEvents(
    workspace.actor,
    workspace.company,
    workspace.records,
    start,
    end,
    scope,
    pending,
  ).filter((e) => category === "All" || e.kind === category);
  const firstDay = new Date(start + "T00:00:00Z").getUTCDay(),
    count = Number(end.slice(8));
  const days = Array.from({ length: count }, (_, i) =>
    addCalendarDays(start, i),
  );
  const navigate = (amount: number) => {
    const d = new Date(start + "T00:00:00Z");
    d.setUTCMonth(d.getUTCMonth() + amount);
    setMonth(d.toISOString().slice(0, 7));
  };
  const canTeam =
    isStaff(workspace.actor) || workspace.actor.role === "manager";
  const download = new URLSearchParams({
    type: "calendar",
    start,
    end,
    scope,
    category,
  });
  return (
    <>
      <div className="daily-header">
        <PageHeader
          title="Team calendar"
          description={`Approved time away, workplace holidays and rotating shifts. Times use ${workspace.company.settings.timezone}.`}
          action={
            <Button variant="outline" asChild>
              <a href={`/api/export?${download}`}>
                <Download size={15} />
                Download calendar
              </a>
            </Button>
          }
        />
      </div>
      <div className="calendar-toolbar">
        <div className="calendar-month">
          <Button
            size="icon"
            variant="outline"
            aria-label="Previous month"
            onClick={() => navigate(-1)}
          >
            <ChevronLeft size={17} />
          </Button>
          <label className="sr-only" htmlFor="calendar-month">
            Calendar month
          </label>
          <Input
            id="calendar-month"
            type="month"
            min="2020-01"
            max="2100-12"
            value={month}
            onChange={(e) => {
              if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value))
                setMonth(e.target.value);
            }}
          />
          <Button
            size="icon"
            variant="outline"
            aria-label="Next month"
            onClick={() => navigate(1)}
          >
            <ChevronRight size={17} />
          </Button>
          <Button variant="ghost" onClick={() => setMonth(today.slice(0, 7))}>
            Today
          </Button>
        </div>
        <NativeSelect
          label="Calendar scope"
          value={scope}
          onChange={setScope}
          options={[
            ...(canTeam
              ? [
                  {
                    value: "team",
                    label: isStaff(workspace.actor) ? "Workspace" : "My team",
                  },
                ]
              : []),
            { value: "mine", label: "My calendar" },
          ]}
        />
        <NativeSelect
          label="Calendar category"
          value={category}
          onChange={setCategory}
          options={[
            { value: "All", label: "All events" },
            { value: "leave", label: "Leave" },
            { value: "time_off", label: "Time off" },
            { value: "shift", label: "Shifts" },
            { value: "holiday", label: "Holidays" },
          ]}
        />
      </div>
      <label className="calendar-pending">
        <input
          type="checkbox"
          checked={pending}
          onChange={(e) => setPending(e.target.checked)}
        />
        <span>
          Show pending requests{" "}
          <small>Pending events stay out of the downloaded calendar.</small>
        </span>
      </label>
      <p className="muted calendar-note">
        {canTeam
          ? "You see the employees and requests available to your role."
          : "Your calendar contains your own requests and assigned shifts."}{" "}
        Absence events omit leave reasons, receipts and medical details.
      </p>
      <div className="calendar-grid">
        <div className="calendar-weekdays">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="calendar-cells">
          {Array.from({ length: firstDay }, (_, i) => (
            <div className="calendar-blank" key={`blank-${i}`} />
          ))}
          {days.map((d) => (
            <section
              className={`calendar-day ${d === today ? "calendar-today" : ""}`}
              key={d}
              aria-label={d}
            >
              <strong>{Number(d.slice(8))}</strong>
              {events
                .filter((e) => e.date === d)
                .map((e) => (
                  <Event key={e.id} event={e} />
                ))}
            </section>
          ))}
        </div>
      </div>
      <div className="calendar-agenda">
        {events.length ? (
          days
            .filter((d) => events.some((e) => e.date === d))
            .map((d) => (
              <section className="panel" key={d}>
                <h2 className={d === today ? "calendar-today-label" : ""}>
                  {new Date(d + "T00:00:00Z").toLocaleDateString("en-MY", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    timeZone: "UTC",
                  })}
                  {d === today ? " · Today" : ""}
                </h2>
                {events
                  .filter((e) => e.date === d)
                  .map((e) => (
                    <Event key={e.id} event={e} />
                  ))}
              </section>
            ))
        ) : (
          <Empty
            title="No events this month"
            description="Approved requests, assigned shifts and holidays will appear here."
            action={<CalendarDays size={20} />}
          />
        )}
      </div>
    </>
  );
}
function Event({ event: e }: { event: CalendarEvent }) {
  return (
    <div
      className={`calendar-event calendar-${e.kind} ${e.status === "Pending" ? "calendar-tentative" : ""}`}
    >
      <strong>{e.title}</strong>
      <small>
        {e.start
          ? `${e.start}–${e.end}${e.overnight ? " (+1 day)" : ""}`
          : "All day"}
        {e.status === "Pending" ? " · Pending" : ""}
      </small>
    </div>
  );
}
