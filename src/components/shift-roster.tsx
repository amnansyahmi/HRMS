"use client";
import { useState } from "react";
import { useWorkspace } from "./workspace-context";
import { shiftOccurs, localDate } from "@/lib/calculations";
import { Input } from "./ui/input";
export function ShiftRoster() {
  const { workspace } = useWorkspace();
  const [start, setStart] = useState(
    localDate(new Date(), workspace.company.settings.timezone),
  );
  const days = Array.from({ length: 14 }, (_, i) =>
      new Date(Date.parse(start + "T00:00:00Z") + i * 86400000)
        .toISOString()
        .slice(0, 10),
    ),
    employees = workspace.records.filter(
      (r) => r.kind === "employee" && r.data.status !== "Archived",
    ),
    shifts = workspace.records.filter((r) => r.kind === "shift"),
    holidays = workspace.records.filter((r) => r.kind === "holiday");
  return (
    <>
      <label className="period-picker">
        Roster starts
        <Input
          type="date"
          aria-label="Roster starts"
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
      </label>
      <div className="table-wrap roster-table">
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              {days.map((d) => (
                <th key={d}>{d.slice(5)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id}>
                <td>{String(e.data.name)}</td>
                {days.map((d) => {
                  const weekday = new Date(d + "T00:00:00Z").getUTCDay(),
                    match = shifts.filter(
                      (s) =>
                        ((s.data.employeeIds as string[]).includes(e.id) ||
                          ((s.data.departmentIds as string[]) || []).includes(
                            String(e.data.departmentId),
                          )) &&
                        (s.data.days as number[]).includes(weekday) &&
                        shiftOccurs(s.data, d),
                    ),
                    holiday =
                      workspace.company.settings.holidays.includes(d) ||
                      holidays.some(
                        (h) =>
                          h.data.date === d &&
                          (h.data.state === "National" ||
                            h.data.state === e.data.state),
                      ),
                    leave = workspace.records.find(
                      (l) =>
                        l.kind === "leave" &&
                        l.employee_id === e.id &&
                        l.data.status === "Approved" &&
                        String(l.data.startDate) <= d &&
                        String(l.data.endDate) >= d,
                    );
                  return (
                    <td key={d}>
                      {leave ? (
                        <span className="roster-leave">
                          {String(leave.data.type)}
                          <small>{String(leave.data.unit || "Full day")}</small>
                        </span>
                      ) : match.length ? (
                        match.map((s) => (
                          <span className="roster-shift" key={s.id}>
                            {String(s.data.name)}
                            <small>
                              {String(s.data.start)}–{String(s.data.end)}
                            </small>
                          </span>
                        ))
                      ) : holiday ? (
                        "Holiday"
                      ) : (
                        "Rest"
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
