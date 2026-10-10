"use client";
import { useId } from "react";
import { BarChart3, ChartPie } from "lucide-react";
import { dashboardAnalytics, type dashboardSnapshot } from "@/lib/dashboard";
import { InlineLink } from "./common";
import { useWorkspace } from "./workspace-context";

type Snapshot = ReturnType<typeof dashboardSnapshot>;
const dayLabel = (date: string, weekday = false) =>
  new Intl.DateTimeFormat("en-MY", {
    timeZone: "UTC",
    ...(weekday
      ? { weekday: "short" as const }
      : { day: "numeric" as const, month: "short" as const }),
  }).format(new Date(`${date}T12:00:00Z`));

export function AttendanceActivityWidget({ snapshot }: { snapshot: Snapshot }) {
  const { go, workspace } = useWorkspace();
  const titleId = useId();
  const { attendance } = dashboardAnalytics(snapshot);
  const max = Math.max(1, ...attendance.map((day) => day.count));
  const total = attendance.reduce((sum, day) => sum + day.count, 0);
  return (
    <section
      className="panel dashboard-widget chart-widget activity-widget"
      data-dashboard-widget="activity"
    >
      <div className="panel-heading">
        <div>
          <h2>
            <BarChart3 size={18} />
            Attendance activity
          </h2>
          <p>
            Last seven days ·{" "}
            {workspace.company.settings.timezone.replace("Asia/", "")}
          </p>
        </div>
        <InlineLink onClick={() => go("attendance")}>Details</InlineLink>
      </div>
      <div className="chart-body">
        <div className="chart-stat">
          <strong>{total}</strong>
          <span>
            recorded workdays<span>Each person counted once per day</span>
          </span>
        </div>
        <svg
          className="attendance-chart"
          viewBox="0 0 420 184"
          role="img"
          aria-labelledby={titleId}
        >
          <title id={titleId}>
            Daily recorded attendance:{" "}
            {attendance
              .map((day) => `${dayLabel(day.date)}: ${day.count}`)
              .join("; ")}
            . Counts reflect records available to your account.
          </title>
          {[0, 1, 2].map((tick) => (
            <line
              key={tick}
              x1="0"
              x2="420"
              y1={130 - tick * 50}
              y2={130 - tick * 50}
              className="chart-gridline"
            />
          ))}
          {attendance.map((day, i) => {
            const height = (day.count / max) * 90;
            return (
              <g key={day.date}>
                <rect
                  x={i * 60 + 14}
                  y={130 - height}
                  width="32"
                  height={height}
                  rx="5"
                  className={i === 6 ? "chart-bar today" : "chart-bar"}
                />
                <text
                  x={i * 60 + 30}
                  y={day.count ? 121 - height : 120}
                  textAnchor="middle"
                  className="chart-value"
                >
                  {day.count}
                </text>
                <text
                  x={i * 60 + 30}
                  y="152"
                  textAnchor="middle"
                  className="chart-label"
                >
                  {dayLabel(day.date, true)}
                </text>
                <text
                  x={i * 60 + 30}
                  y="173"
                  textAnchor="middle"
                  className="chart-date"
                >
                  {Number(day.date.slice(8))}
                </text>
              </g>
            );
          })}
        </svg>
        {!total ? (
          <p className="chart-empty-note">
            No recorded attendance in this period.
          </p>
        ) : null}
        <details className="chart-data">
          <summary>View daily counts</summary>
          <table>
            <caption>Attendance records available to you</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">People recorded</th>
              </tr>
            </thead>
            <tbody>
              {attendance.map((day) => (
                <tr key={day.date}>
                  <th scope="row">{dayLabel(day.date)}</th>
                  <td>{day.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
    </section>
  );
}

export function RequestBreakdownWidget({ snapshot }: { snapshot: Snapshot }) {
  const { go } = useWorkspace();
  const titleId = useId();
  const { requests, totalRequests } = dashboardAnalytics(snapshot);
  const segments = requests.map((category, i) => ({
    ...category,
    offset:
      (requests.slice(0, i).reduce((sum, item) => sum + item.count, 0) /
        (totalRequests || 1)) *
      100,
    percent: (category.count / (totalRequests || 1)) * 100,
  }));
  return (
    <section
      className="panel dashboard-widget chart-widget request-mix-widget"
      data-dashboard-widget="request-mix"
    >
      <div className="panel-heading">
        <div>
          <h2>
            <ChartPie size={18} />
            Request breakdown
          </h2>
          <p>Your pending requests and available reviews</p>
        </div>
        <InlineLink onClick={() => go("approvals")}>Inbox</InlineLink>
      </div>
      <div className="chart-body">
        <div className="request-chart-layout">
          <div className="donut-wrap">
            <svg viewBox="0 0 160 160" role="img" aria-labelledby={titleId}>
              <title id={titleId}>
                {totalRequests} pending requests.{" "}
                {requests
                  .map((category) => `${category.label}: ${category.count}`)
                  .join("; ")}
                .
              </title>
              <circle
                cx="80"
                cy="80"
                r="62"
                fill="none"
                strokeWidth="16"
                className="donut-track"
              />
              {segments
                .filter((category) => category.count > 0)
                .map((category) => (
                  <circle
                    key={category.id}
                    cx="80"
                    cy="80"
                    r="62"
                    fill="none"
                    strokeWidth="16"
                    pathLength="100"
                    strokeDasharray={`${category.percent} ${100 - category.percent}`}
                    strokeDashoffset={-category.offset}
                    transform="rotate(-90 80 80)"
                    className={`donut-segment tone-${category.tone}`}
                  />
                ))}
            </svg>
            <div className="donut-total" aria-hidden="true">
              <strong>{totalRequests}</strong>
              <span>pending</span>
            </div>
          </div>
          <ul className="chart-legend" aria-label="Pending requests by type">
            {requests.map((category) => (
              <li key={category.id}>
                <span
                  className={`chart-dot tone-${category.tone}`}
                  aria-hidden="true"
                />
                <span>{category.label}</span>
                <strong>{category.count}</strong>
              </li>
            ))}
          </ul>
        </div>
        <p className="chart-scope">
          {totalRequests
            ? "Includes your own requests and requests you can review."
            : "All clear. New pending requests will appear here."}
        </p>
      </div>
    </section>
  );
}
