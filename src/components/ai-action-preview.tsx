"use client";
import { money, shortDate } from "@/lib/client";
import { useWorkspace } from "./workspace-context";

const labels: Record<string, string> = {
  decision: "Decision",
  note: "Review note",
  stage: "Candidate stage",
  title: "Title",
  type: "Type",
  effectiveDate: "Effective date",
  body: "Letter draft",
  unit: "Duration",
  startDate: "From",
  endDate: "Until",
  reason: "Reason",
  category: "Category",
  date: "Expense date",
  amount: "Amount",
  description: "Purpose",
  tripReference: "Trip reference",
  action: "Clock action",
  location: "Workplace",
  locationId: "Workplace",
  claimTypeId: "Claim policy",
  clockReminderMinutes: "Reminder before shift",
};
export function AIActionPreview({
  preview,
  action,
  target,
}: {
  preview: Record<string, unknown>;
  action: string;
  target?: string;
}) {
  const { workspace } = useWorkspace();
  const rows = Object.entries(preview).filter(
    ([key, value]) =>
      labels[key] && value !== null && value !== undefined && value !== "",
  );
  function value(key: string, raw: unknown) {
    if (["claimTypeId", "locationId"].includes(key))
      return String(
        workspace.records.find((r) => r.id === raw)?.data.name ||
          "Selected policy",
      );
    if (key === "amount") return money(raw);
    if (["date", "startDate", "endDate", "effectiveDate"].includes(key))
      return shortDate(raw);
    if (key === "action" && action === "clock")
      return raw === "in" ? "Clock in" : "Clock out";
    if (key === "clockReminderMinutes")
      return Number(raw) === 0 ? "Off" : `${raw} minutes`;
    return String(raw);
  }
  return (
    <div className="action-preview readable-action-preview">
      {target ? (
        <p>
          <strong>For</strong> {target}
        </p>
      ) : null}
      <dl>
        {rows.map(([key, raw]) => (
          <div key={key} className={key === "body" ? "preview-letter" : ""}>
            <dt>{labels[key]}</dt>
            <dd>{value(key, raw)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
