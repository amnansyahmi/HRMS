import { localDate } from "./calculations";
import { reviewOptions, requestKinds } from "./request-workflow";
import { isStaff, type Actor, type Company, type HRRecord } from "./types";
import { teamIds } from "./permissions";
import { fail } from "./errors";
export type DigestItem = {
  id: string;
  category: string;
  title: string;
  detail: string;
  page: string;
  date: string;
};
/** Deterministic reminders built only from records already visible to the recipient. */
export function buildHRDigest(
  actor: Actor,
  company: Company,
  records: HRRecord[],
  now = new Date(),
) {
  if (actor.companyId !== company.id) fail("Workspace unavailable", 404);
  const today = localDate(now, company.settings.timezone),
    horizon = new Date(Date.parse(today) + 30 * 86400000)
      .toISOString()
      .slice(0, 10);
  const employees = records.filter((r) => r.kind === "employee"),
    team = new Set(teamIds(actor, employees));
  const mine = (r: HRRecord) =>
    isStaff(actor) || (!!r.employee_id && team.has(r.employee_id));
  const items: DigestItem[] = [];
  for (const r of records) {
    if (r.company_id !== actor.companyId) continue;
    const date = String(
      r.data.dueDate ||
        r.data.expiryDate ||
        r.data.endDate ||
        r.created_at.slice(0, 10),
    );
    const name = String(
      employees.find((e) => e.id === r.employee_id)?.data.name || "",
    );
    if (
      [...requestKinds, "profile_change"].includes(r.kind) &&
      r.data.status === "Pending" &&
      r.created_at.slice(0, 10) <
        new Date(Date.parse(today) - 3 * 86400000).toISOString().slice(0, 10) &&
      reviewOptions(actor, r, records).some((o) =>
        ["Approved", "Rejected", "Returned"].includes(o),
      )
    )
      items.push({
        id: r.id,
        category: "Approval",
        title: `${r.kind.replaceAll("_", " ")} awaiting review`,
        detail: name,
        page: "approvals",
        date: r.created_at.slice(0, 10),
      });
    if (
      r.kind === "document" &&
      mine(r) &&
      r.data.expiryDate &&
      date <= horizon
    )
      items.push({
        id: r.id,
        category: "Document",
        title: String(r.data.title),
        detail: `${name} · ${date < today ? "Expired" : "Expires"} ${date}`,
        page: "employee-files",
        date,
      });
    if (
      r.kind === "lifecycle" &&
      mine(r) &&
      r.data.status !== "Completed" &&
      date <= horizon
    ) {
      const incomplete = ((r.data.items as { done: boolean }[]) || []).filter(
        (i) => !i.done,
      ).length;
      if (incomplete)
        items.push({
          id: r.id,
          category: String(r.data.type),
          title: String(r.data.title),
          detail: `${name} · ${incomplete} unfinished tasks · due ${date}`,
          page: "employee-files",
          date,
        });
    }
    if (
      r.kind === "employee" &&
      r.data.status !== "Archived" &&
      r.data.endDate &&
      date <= horizon &&
      (isStaff(actor) || team.has(r.id))
    )
      items.push({
        id: r.id,
        category: "Employment",
        title: String(r.data.name),
        detail: `Employment end date ${date}. Verify the next step with HR.`,
        page: "people",
        date,
      });
    if (
      r.kind === "goal" &&
      r.data.status !== "Completed" &&
      r.data.dueDate &&
      date < today &&
      (isStaff(actor) || (!!r.employee_id && team.has(r.employee_id)))
    )
      items.push({
        id: r.id,
        category: "Goal",
        title: String(r.data.title),
        detail: `Overdue since ${date}`,
        page: "performance",
        date,
      });
    if (r.kind === "meeting" && mine(r)) {
      const actions = (
        (r.data.actions as {
          task?: string;
          done?: boolean;
          dueDate?: string;
        }[]) || []
      ).filter((a) => !a.done && a.dueDate && a.dueDate < today);
      if (actions.length)
        items.push({
          id: r.id,
          category: "Meeting",
          title: String(r.data.title),
          detail: `${actions.length} overdue follow-ups`,
          page: "meetings",
          date: today,
        });
    }
  }
  items.sort(
    (a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title),
  );
  return {
    date: today,
    total: items.length,
    items: items.slice(0, 100),
    truncated: items.length > 100,
  };
}
