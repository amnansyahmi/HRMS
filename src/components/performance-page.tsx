"use client";
import { useState } from "react";
import { Target, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "./workspace-context";
import {
  PageHeader,
  Person,
  Status,
  Empty,
  AddButton,
  SearchField,
} from "./common";
import { shortDate } from "@/lib/client";
import { isStaff } from "@/lib/types";
export function PerformancePage() {
  const { workspace, edit } = useWorkspace(),
    [search, setSearch] = useState(""),
    employees = workspace.records.filter((r) => r.kind === "employee"),
    staff = isStaff(workspace.actor),
    rows = workspace.records.filter(
      (r) =>
        r.kind === "goal" &&
        JSON.stringify(r.data).toLowerCase().includes(search.toLowerCase()),
    );
  return (
    <>
      <PageHeader
        title="Goals & evaluations"
        description="Make expectations clear. Keep progress in the conversation."
        action={
          staff || workspace.actor.role === "manager" ? (
            <AddButton onClick={() => edit("goal")}>Add goal</AddButton>
          ) : null
        }
      />
      <div className="table-toolbar">
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Search goals…"
        />
      </div>
      <div className="goal-grid" aria-label="Balanced scorecard">
        {["Financial", "Customer", "Process", "Learning"].map((perspective) => {
          const goals = rows.filter((g) => g.data.perspective === perspective),
            weights = goals.reduce((n, g) => n + Number(g.data.weight || 1), 0);
          const score = weights
            ? Math.round(
                (goals.reduce(
                  (n, g) =>
                    n +
                    Math.min(
                      1,
                      Number(g.data.progress) / Number(g.data.target),
                    ) *
                      Number(g.data.weight || 1),
                  0,
                ) /
                  weights) *
                  100,
              )
            : 0;
          return (
            <div className="record-card" key={perspective}>
              <strong>{perspective}</strong>
              <p>
                {goals.length
                  ? `${score}% weighted progress · ${goals.length} goals`
                  : "No goals yet"}
              </p>
            </div>
          );
        })}
      </div>
      <div className="goal-grid">
        {rows.map((g) => {
          const percent = Math.min(
            100,
            Math.round((Number(g.data.progress) / Number(g.data.target)) * 100),
          );
          return (
            <div className="goal-card" key={g.id}>
              <div className="row-between">
                <Target size={20} />
                <Status value={g.data.status} />
              </div>
              <h3>{String(g.data.title)}</h3>
              <Person
                name={String(
                  employees.find((e) => e.id === g.employee_id)?.data.name ||
                    (g.data.scope === "Team"
                      ? String(
                          workspace.records.find(
                            (r) => r.id === g.data.departmentId,
                          )?.data.name || "Team",
                        )
                      : "Company"),
                )}
              />
              <small>
                {String(g.data.scope || "Individual")} ·{" "}
                {String(g.data.perspective || "Learning")}
                {g.data.parentId
                  ? ` · aligned to ${String(workspace.records.find((r) => r.id === g.data.parentId)?.data.title || "a parent goal")}`
                  : ""}
              </small>
              <div className="mini-progress">
                <span style={{ width: `${percent}%` }} />
              </div>
              <div className="row-between">
                <small>
                  {Number(g.data.progress)} / {Number(g.data.target)}{" "}
                  {String(g.data.unit)}
                </small>
                <strong>{percent}%</strong>
              </div>
              <small className="due-date">
                Due {shortDate(g.data.dueDate)}
              </small>
              {g.data.rating ? (
                <div className="evaluation">
                  <strong>Evaluation · {Number(g.data.rating)}/5</strong>
                  <p>{String(g.data.feedback || "")}</p>
                </div>
              ) : g.data.feedback ? (
                <p className="evaluation-note">{String(g.data.feedback)}</p>
              ) : null}
              {staff ||
              g.employee_id === workspace.actor.employeeId ||
              (workspace.actor.role === "manager" &&
                employees.find((e) => e.id === g.employee_id)?.data
                  .managerId === workspace.actor.employeeId) ? (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => edit("goal", g)}
                >
                  <Pencil size={14} />
                  {!staff && g.employee_id === workspace.actor.employeeId
                    ? "Update progress"
                    : "Review goal"}
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
      {!rows.length ? (
        <Empty
          title="Make the next step visible"
          description="Create measurable goals and review progress with your team."
        />
      ) : null}
    </>
  );
}
