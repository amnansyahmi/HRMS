import { shiftOccurs } from "./calculations";
import { isStaff, type Actor, type Company, type HRRecord } from "./types";

export interface CalendarEvent {
  id: string;
  recordId: string | null;
  employeeId: string | null;
  date: string;
  title: string;
  kind: "leave" | "time_off" | "shift" | "holiday";
  status: string;
  start: string | null;
  end: string | null;
  overnight: boolean;
}
export function addCalendarDays(date: string, amount: number) {
  return new Date(Date.parse(date + "T00:00:00Z") + amount * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function calendarEmployees(actor: Actor, records: HRRecord[]) {
  return records.filter(
    (r) =>
      r.kind === "employee" &&
      r.data.status !== "Archived" &&
      (isStaff(actor) ||
        r.id === actor.employeeId ||
        (actor.role === "manager" &&
          actor.employeeId &&
          r.data.managerId === actor.employeeId)),
  );
}
/** Input must already be authorized; this adds the narrower calendar scope and removes reasons/attachments. */
export function calendarEvents(
  actor: Actor,
  company: Company,
  records: HRRecord[],
  start: string,
  end: string,
  scope = "team",
  includePending = false,
): CalendarEvent[] {
  if (company.id !== actor.companyId)
    throw new Error("Calendar company does not match this account");
  records = records.filter((r) => r.company_id === actor.companyId);
  const days = Math.floor((Date.parse(end) - Date.parse(start)) / 86400000);
  if (!Number.isFinite(days) || days < 0 || days > 61)
    throw new Error("Choose a calendar range of 1–62 days");
  const employees = calendarEmployees(actor, records).filter(
    (e) => scope !== "mine" || e.id === actor.employeeId,
  );
  const ids = new Set(employees.map((e) => e.id));
  const holidayRecords = records.filter(
    (r) =>
      r.kind === "holiday" &&
      (r.data.state === "National" ||
        employees.some((e) => e.data.state === r.data.state)),
  );
  const events: CalendarEvent[] = [];
  const names = new Map(employees.map((e) => [e.id, String(e.data.name)]));
  for (let d = start; d <= end; d = addCalendarDays(d, 1)) {
    const holidays = holidayRecords.filter((h) => h.data.date === d);
    for (const h of holidays)
      events.push({
        id: `${h.id}:${d}`,
        recordId: h.id,
        employeeId: null,
        date: d,
        title: `${h.data.title}${h.data.state !== "National" ? ` · ${h.data.state}` : ""}`,
        kind: "holiday",
        status: "Holiday",
        start: null,
        end: null,
        overnight: false,
      });
    if (company.settings.holidays.includes(d) && !holidays.length)
      events.push({
        id: `company-holiday:${d}`,
        recordId: null,
        employeeId: null,
        date: d,
        title: "Company holiday",
        kind: "holiday",
        status: "Holiday",
        start: null,
        end: null,
        overnight: false,
      });
    const weekday = new Date(d + "T00:00:00Z").getUTCDay();
    for (const r of records) {
      if (
        !r.employee_id ||
        !ids.has(r.employee_id) ||
        !["leave", "time_off"].includes(r.kind) ||
        !(
          r.data.status === "Approved" ||
          (includePending && r.data.status === "Pending")
        )
      )
        continue;
      const employee = employees.find((e) => e.id === r.employee_id)!;
      if (r.kind === "leave") {
        if (
          String(r.data.startDate) > d ||
          String(r.data.endDate) < d ||
          !company.settings.workDays.includes(weekday) ||
          company.settings.holidays.includes(d) ||
          holidayRecords.some(
            (h) =>
              h.data.date === d &&
              (h.data.state === "National" ||
                h.data.state === employee.data.state),
          )
        )
          continue;
      } else if (r.data.date !== d) continue;
      let from: string | null = null,
        to: string | null = null;
      const time = (hour: number) => {
        const minutes = Math.round(hour * 60);
        return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
      };
      if (r.kind === "time_off") {
        from = String(r.data.start);
        to = String(r.data.end);
      } else if (r.data.unit === "Morning") {
        from = "09:00";
        to = "13:00";
      } else if (r.data.unit === "Afternoon") {
        from = "13:00";
        to = "17:00";
      } else if (r.data.unit === "Hours") {
        from = time(Number(r.data.startHour || 0));
        to = time(Number(r.data.startHour || 0) + Number(r.data.hours));
      }
      events.push({
        id: `${r.id}:${d}`,
        recordId: r.id,
        employeeId: r.employee_id,
        date: d,
        title: `${names.get(r.employee_id)} · ${r.kind === "leave" ? "Away" : "Time off"}`,
        kind: r.kind as "leave" | "time_off",
        status: String(r.data.status),
        start: from,
        end: to,
        overnight: false,
      });
    }
    for (const shift of records.filter(
      (r) =>
        r.kind === "shift" &&
        (r.data.days as number[]).includes(weekday) &&
        shiftOccurs(r.data, d),
    )) {
      for (const e of employees) {
        if (
          (e.data.startDate && String(e.data.startDate) > d) ||
          (e.data.endDate && String(e.data.endDate) < d)
        )
          continue;
        if (!(
          (shift.data.employeeIds as string[]).includes(e.id) ||
          ((shift.data.departmentIds as string[]) || []).includes(
            String(e.data.departmentId),
          )
        ))
          continue;
        events.push({
          id: `${shift.id}:${e.id}:${d}`,
          recordId: shift.id,
          employeeId: e.id,
          date: d,
          title: `${names.get(e.id)} · ${shift.data.name}`,
          kind: "shift",
          status: "Scheduled",
          start: String(shift.data.start),
          end: String(shift.data.end),
          overnight: String(shift.data.end) < String(shift.data.start),
        });
      }
    }
  }
  return events.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.start || "").localeCompare(b.start || "") ||
      a.title.localeCompare(b.title),
  );
}
