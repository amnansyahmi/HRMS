"use client";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useWorkspace } from "./workspace-context";
import { shiftOccurs, localDate } from "@/lib/calculations";
import { addCalendarDays, calendarEmployees } from "@/lib/hr-calendar";
import type { HRRecord, Workspace } from "@/lib/types";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Person, Empty } from "./common";

type RosterData = {
  settings: Workspace["company"]["settings"];
  shifts: HRRecord[];
  holidays: HRRecord[];
  leaves: HRRecord[];
};
function scheduleFor(data: RosterData, employee: HRRecord, date: string) {
  const weekday = new Date(date + "T12:00:00Z").getUTCDay();
  return {
    shifts: data.shifts.filter(
      (s) =>
        ((s.data.employeeIds as string[]).includes(employee.id) ||
          ((s.data.departmentIds as string[]) || []).includes(
            String(employee.data.departmentId),
          )) &&
        (s.data.days as number[]).includes(weekday) &&
        shiftOccurs(s.data, date),
    ),
    holiday:
      data.settings.holidays.includes(date) ||
      data.holidays.some(
        (h) =>
          h.data.date === date &&
          (h.data.state === "National" || h.data.state === employee.data.state),
      ),
    leave: data.leaves.find(
      (l) =>
        l.employee_id === employee.id &&
        l.data.status === "Approved" &&
        String(l.data.startDate) <= date &&
        String(l.data.endDate) >= date,
    ),
  };
}
function RosterAssignment({
  schedule,
}: {
  schedule: ReturnType<typeof scheduleFor>;
}) {
  return schedule.leave ? (
    <span className="roster-leave">
      {String(schedule.leave.data.type)}
      <small>{String(schedule.leave.data.unit || "Full day")}</small>
    </span>
  ) : schedule.shifts.length ? (
    <>
      {schedule.shifts.map((s) => (
        <span className="roster-shift" key={s.id}>
          {String(s.data.name)}
          <small>
            {String(s.data.start)}–{String(s.data.end)}
          </small>
        </span>
      ))}
    </>
  ) : (
    <span className="roster-rest">
      {schedule.holiday ? "Holiday" : "No shift scheduled"}
    </span>
  );
}
export function ShiftRoster() {
  const { workspace } = useWorkspace();
  const [start, setStart] = useState(
    localDate(new Date(), workspace.company.settings.timezone),
  );
  const [selected, setSelected] = useState(start);
  const days = Array.from({ length: 14 }, (_, i) => addCalendarDays(start, i));
  const activeDate = days.includes(selected) ? selected : start;
  const records = workspace.records.filter(
    (record) => record.company_id === workspace.actor.companyId,
  );
  const employees = calendarEmployees(workspace.actor, records);
  const data: RosterData = {
    settings: workspace.company.settings,
    shifts: records.filter((record) => record.kind === "shift"),
    holidays: records.filter((record) => record.kind === "holiday"),
    leaves: records.filter((record) => record.kind === "leave"),
  };
  return (
    <div className="shift-roster">
      <div className="roster-toolbar">
        <label className="period-picker">
          Roster starts
          <Input
            type="date"
            aria-label="Roster starts"
            value={start}
            onChange={(e) => {
              if (e.target.value) setStart(e.target.value);
            }}
          />
        </label>
        <p>
          14-day roster · {employees.length}{" "}
          {employees.length === 1 ? "person" : "people"}
        </p>
      </div>
      <section className="roster-phone" aria-label="Daily roster">
        <div className="roster-day-nav">
          <Button
            size="icon"
            variant="outline"
            aria-label="Previous roster day"
            disabled={activeDate === start}
            onClick={() => setSelected(addCalendarDays(activeDate, -1))}
          >
            <ChevronLeft size={18} />
          </Button>
          <h2 aria-live="polite">
            {new Intl.DateTimeFormat("en-MY", {
              timeZone: "UTC",
              weekday: "short",
              day: "numeric",
              month: "short",
            }).format(new Date(activeDate + "T12:00:00Z"))}
          </h2>
          <Button
            size="icon"
            variant="outline"
            aria-label="Next roster day"
            disabled={activeDate === days[13]}
            onClick={() => setSelected(addCalendarDays(activeDate, 1))}
          >
            <ChevronRight size={18} />
          </Button>
        </div>
        {employees.length ? (
          <div className="roster-day-list">
            {employees.map((employee) => (
              <article className="roster-person-card" key={employee.id}>
                <Person name={String(employee.data.name)} />
                <div className="roster-person-schedule">
                  <RosterAssignment
                    schedule={scheduleFor(data, employee, activeDate)}
                  />
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty
            title="No people in this roster"
            description="Available employees will appear here."
          />
        )}
      </section>
      <div className="table-wrap roster-table">
        <table>
          <thead>
            <tr>
              <th scope="col">Employee</th>
              {days.map((date) => (
                <th scope="col" key={date}>
                  {date.slice(5)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.map((employee) => (
              <tr key={employee.id}>
                <th scope="row">{String(employee.data.name)}</th>
                {days.map((date) => (
                  <td key={date}>
                    <RosterAssignment
                      schedule={scheduleFor(data, employee, date)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
