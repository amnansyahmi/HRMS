import type { Workspace } from "./types";

export function personalWorkday(workspace: Workspace, today: string) {
  const records = workspace.records.filter(
    (r) => r.company_id === workspace.actor.companyId,
  );
  const own = records.find(
    (r) => r.kind === "employee" && r.id === workspace.actor.employeeId,
  );
  const requests = own
    ? records.filter(
        (r) => r.employee_id === own.id && ["claim", "leave"].includes(r.kind),
      )
    : [];
  const pendingClaims = requests.filter(
    (r) => r.kind === "claim" && r.data.status === "Pending",
  );
  const holidayDates = [
    ...workspace.company.settings.holidays.map((date) => ({
      date,
      title: "Company holiday",
    })),
    ...records
      .filter(
        (r) =>
          r.kind === "holiday" &&
          (r.data.state === "National" ||
            (own && r.data.state === own.data.state)),
      )
      .map((r) => ({ date: String(r.data.date), title: String(r.data.title) })),
  ]
    .filter((h) => /^\d{4}-\d{2}-\d{2}$/.test(h.date) && h.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const holiday = holidayDates[0];
  return {
    pendingClaims,
    pendingAmount: pendingClaims.reduce(
      (total, r) =>
        total +
        (Number.isFinite(Number(r.data.amount)) ? Number(r.data.amount) : 0),
      0,
    ),
    recent: requests
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 3),
    holiday: holiday
      ? {
          ...holiday,
          days: Math.round(
            (Date.parse(holiday.date + "T00:00:00Z") -
              Date.parse(today + "T00:00:00Z")) /
              86400000,
          ),
        }
      : null,
    announcement: records
      .filter(
        (r) =>
          r.kind === "announcement" &&
          r.data.published === true &&
          (!r.data.expiresOn || String(r.data.expiresOn) >= today),
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0],
  };
}

export function elapsedWork(clockIn: unknown, now: number) {
  const start = Date.parse(String(clockIn || ""));
  if (!Number.isFinite(start)) return null;
  const minutes = Math.max(0, Math.floor((now - start) / 60000));
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}
