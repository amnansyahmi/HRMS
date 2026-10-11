"use client";
import { Receipt, CalendarDays, Megaphone, ArrowRight } from "lucide-react";
import { personalWorkday } from "@/lib/personal-workday";
import { money, shortDate } from "@/lib/client";
import { useWorkspace } from "./workspace-context";
import { Status } from "./common";

export function PersonalWorkday({ today }: { today: string }) {
  const { workspace, go, edit } = useWorkspace();
  const summary = personalWorkday(workspace, today);
  return (
    <section className="personal-workday" aria-label="My work summary">
      {workspace.actor.employeeId ? (
        <>
          <div className="personal-summary-row">
            <button onClick={() => go("claims")}>
              <Receipt size={20} aria-hidden="true" />
              <span>
                <small>My pending claims</small>
                <strong>{money(summary.pendingAmount)}</strong>
                <small>{summary.pendingClaims.length} awaiting review</small>
              </span>
              <ArrowRight size={16} aria-hidden="true" />
            </button>
            <button onClick={() => edit("claim")}>
              <Receipt size={20} aria-hidden="true" />
              <span>
                <strong>Submit a claim</strong>
                <small>Add your receipt and expense</small>
              </span>
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
          {summary.recent.length ? (
            <section className="personal-recent">
              <h2>My recent requests</h2>
              <ul>
                {summary.recent.map((r) => (
                  <li key={r.id}>
                    <button
                      onClick={() =>
                        go(r.kind === "claim" ? "claims" : "leave")
                      }
                    >
                      <span>
                        <strong>
                          {String(r.data.category || r.data.type || r.kind)}
                        </strong>
                        <small>
                          {r.kind === "claim"
                            ? money(r.data.amount)
                            : shortDate(r.data.startDate)}
                        </small>
                      </span>
                      <Status value={r.data.status} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
      {summary.holiday ? (
        <button className="workday-notice" onClick={() => go("calendar")}>
          <CalendarDays size={20} aria-hidden="true" />
          <span>
            <strong>{summary.holiday.title}</strong>
            <small>
              {shortDate(summary.holiday.date)} ·{" "}
              {summary.holiday.days === 0
                ? "Today"
                : `In ${summary.holiday.days} ${summary.holiday.days === 1 ? "day" : "days"}`}
            </small>
          </span>
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      ) : null}
      {summary.announcement ? (
        <button className="workday-notice" onClick={() => go("announcements")}>
          <Megaphone size={20} aria-hidden="true" />
          <span>
            <strong>{String(summary.announcement.data.title)}</strong>
            <small>
              {String(
                summary.announcement.data.body ||
                  summary.announcement.data.content ||
                  "Read the latest team update",
              )}
            </small>
          </span>
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      ) : null}
    </section>
  );
}
