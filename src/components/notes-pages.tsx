"use client";
import { useState } from "react";
import {
  FileText,
  Pencil,
  Sparkles,
  CalendarDays,
  Paperclip,
  BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useWorkspace } from "./workspace-context";
import { PageHeader, Empty, AddButton, SearchField, Status } from "./common";
import { api, shortDate } from "@/lib/client";
import { toast } from "sonner";
import { isStaff, type HRRecord } from "@/lib/types";
export function MeetingsPage() {
  const { workspace, edit, ask, refresh } = useWorkspace(),
    [search, setSearch] = useState(""),
    rows = workspace.records.filter(
      (r) =>
        r.kind === "meeting" &&
        JSON.stringify(r.data).toLowerCase().includes(search.toLowerCase()),
    );
  async function toggle(r: HRRecord, index: number, done: boolean) {
    const actions = (r.data.actions as { done: boolean }[]).map((a, i) =>
      i === index ? { ...a, done } : a,
    );
    try {
      await api(
        `/api/records/meeting/${r.id}`,
        { data: { actions }, updatedAt: r.updated_at },
        "PATCH",
      );
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  return (
    <>
      <PageHeader
        title="Meeting notes"
        description="Keep the decisions, actions and context together."
        action={
          <AddButton onClick={() => edit("meeting")}>
            Add meeting notes
          </AddButton>
        }
      />
      <div className="table-toolbar">
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Search notes or action items…"
        />
        <span className="muted-text">
          Upload a transcript or add your notes.
        </span>
      </div>
      <div className="meeting-list">
        {rows.map((r) => (
          <article className="meeting-card" key={r.id}>
            <div className="row-between">
              <div className="meeting-title">
                <FileText size={21} />
                <div>
                  <h3>{String(r.data.title)}</h3>
                  <small>
                    <CalendarDays size={12} />
                    {shortDate(r.data.date)}
                  </small>
                </div>
              </div>
              <div className="table-actions">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    ask(
                      "meeting",
                      r.id,
                      "Summarize the decisions and action items from this meeting.",
                    )
                  }
                >
                  <Sparkles size={14} />
                  Summarize
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Edit ${r.data.title}`}
                  onClick={() => edit("meeting", r)}
                >
                  <Pencil size={15} />
                </Button>
              </div>
            </div>
            {r.data.summary ? (
              <p className="meeting-summary">{String(r.data.summary)}</p>
            ) : (
              <p className="muted-text">No reviewed summary yet.</p>
            )}
            {(
              r.data.actions as {
                task: string;
                owner: string;
                dueDate: string | null;
                done: boolean;
              }[]
            ).length ? (
              <div className="meeting-actions">
                {(
                  r.data.actions as {
                    task: string;
                    owner: string;
                    dueDate: string | null;
                    done: boolean;
                  }[]
                ).map((a, i) => (
                  <div key={i}>
                    <Checkbox
                      aria-label={`Complete ${a.task}`}
                      checked={a.done}
                      onCheckedChange={(v) => toggle(r, i, v === true)}
                    />
                    <span className={a.done ? "done" : ""}>{a.task}</span>
                    <small>
                      {a.owner}
                      {a.dueDate ? ` · ${shortDate(a.dueDate)}` : ""}
                    </small>
                  </div>
                ))}
              </div>
            ) : null}
            <details className="transcript-details">
              <summary>View original notes</summary>
              <p>{String(r.data.transcript)}</p>
            </details>
            {r.data.fileId ? (
              <a className="inline-link" href={`/api/files/${r.data.fileId}`}>
                <Paperclip size={14} />
                Download attachment
              </a>
            ) : null}
          </article>
        ))}
      </div>
      {!rows.length ? (
        <Empty
          title="Good conversations deserve a record"
          description="Add a transcript, review the AI summary, and track action items."
        />
      ) : null}
    </>
  );
}
export function PoliciesPage() {
  const { workspace, edit, ask } = useWorkspace(),
    [search, setSearch] = useState(""),
    staff = isStaff(workspace.actor),
    rows = workspace.records.filter(
      (r) =>
        r.kind === "policy" &&
        JSON.stringify(r.data).toLowerCase().includes(search.toLowerCase()),
    );
  return (
    <>
      <PageHeader
        title="Company handbook"
        description="The answers your team should be able to find."
        action={
          staff ? (
            <AddButton onClick={() => edit("policy")}>Add policy</AddButton>
          ) : null
        }
      />
      <div className="table-toolbar">
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Search your handbook…"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            ask(
              "hr",
              undefined,
              "Explain the leave and claims policies available in our handbook.",
            )
          }
        >
          <Sparkles size={14} />
          Ask about policies
        </Button>
      </div>
      <div className="policy-list">
        {rows.map((r) => (
          <article key={r.id} className="policy-card">
            <div className="row-between">
              <div className="policy-title">
                <BookOpen size={20} />
                <h3>{String(r.data.title)}</h3>
              </div>
              <div className="table-actions">
                <Status value={r.data.category} />
                {staff ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${r.data.title}`}
                    onClick={() => edit("policy", r)}
                  >
                    <Pencil size={15} />
                  </Button>
                ) : null}
              </div>
            </div>
            <p>{String(r.data.body)}</p>
            <small>Updated {shortDate(r.updated_at)}</small>
          </article>
        ))}
      </div>
      {!rows.length ? (
        <Empty
          title="A shared source of clarity"
          description="Add policies so your team and the HR assistant can find reliable answers."
        />
      ) : null}
    </>
  );
}
