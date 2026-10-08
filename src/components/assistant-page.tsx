"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Square,
  Plus,
  MessageSquare,
  Users,
  CalendarDays,
  BookOpen,
  BriefcaseBusiness,
  Copy,
  ChevronDown,
  Database,
  Settings2,
  Loader2,
  FileText,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client";
import { toast } from "sonner";
import { useWorkspace } from "./workspace-context";
import { NativeSelect } from "./common";
import { isStaff } from "@/lib/types";
export type AssistantIntent = {
  mode: string;
  recordId?: string;
  message?: string;
  key: number;
};
type Source = { id: string; kind: string; label: string };
type Message = {
  id?: string;
  thread_id?: string;
  role: string;
  content: string;
  sources: Source[];
};
export function AssistantPage({ intent }: { intent?: AssistantIntent }) {
  const { workspace, go, edit } = useWorkspace(),
    [message, setMessage] = useState(intent?.message || ""),
    [mode, setMode] = useState(intent?.mode || "hr"),
    [recordId, setRecordId] = useState(intent?.recordId || ""),
    [messages, setMessages] = useState<Message[]>([]),
    [history, setHistory] = useState<Message[]>([]),
    [threadId, setThreadId] = useState<string | undefined>(),
    [busy, setBusy] = useState(false),
    [historyOpen, setHistoryOpen] = useState(false),
    end = useRef<HTMLDivElement>(null),
    abort = useRef<AbortController | null>(null),
    staff = isStaff(workspace.actor);
  const loadHistory = useCallback(async () => {
    try {
      setHistory(await api<Message[]>("/api/ai"));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, []);
  useEffect(() => {
    let active = true;
    api<Message[]>("/api/ai")
      .then((data) => {
        if (active) setHistory(data);
      })
      .catch((e) => {
        if (active) toast.error(e.message);
      });
    return () => {
      active = false;
      abort.current?.abort();
    };
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);
  const records = workspace.records.filter((r) =>
    mode === "resume"
      ? r.kind === "candidate"
      : mode === "meeting"
        ? r.kind === "meeting"
        : mode === "preferences"
          ? r.kind === "assessment_result" &&
            !!r.data.submittedAt &&
            (r.data.assessmentSnapshot as { type: string }).type ===
              "Work preferences"
          : false,
  );
  const recordLabel = (id: string) => {
    const r = workspace.records.find((r) => r.id === id);
    return String(
      r?.data.name ||
        r?.data.title ||
        (r?.data.assessmentSnapshot as { title?: string })?.title ||
        "Selected record",
    );
  };
  const configured = workspace.ai.configured && workspace.ai.enabled;
  const threads = Array.from(new Set(history.map((m) => m.thread_id)))
    .filter(Boolean)
    .reverse();
  function newChat() {
    if (busy) return;
    setMessages([]);
    setThreadId(undefined);
    setMessage("");
    setRecordId("");
    setMode("hr");
  }
  async function send(event?: React.FormEvent) {
    event?.preventDefault();
    if (!message.trim() || busy) return;
    const current = message.trim(),
      old = messages;
    setMessage("");
    setBusy(true);
    setMessages([...old, { role: "user", content: current, sources: [] }]);
    abort.current = new AbortController();
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: current,
          mode,
          recordId: recordId || undefined,
          threadId,
        }),
        signal: abort.current.signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "AI request failed");
      setThreadId(result.threadId);
      setMessages([
        ...old,
        { role: "user", content: current, sources: result.sources },
        { role: "assistant", content: result.text, sources: result.sources },
      ]);
      void loadHistory();
    } catch (e) {
      setMessages(old);
      setMessage(current);
      toast.error(
        (e as Error).name === "AbortError"
          ? "Request stopped"
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }
  const suggestions = [
    {
      icon: CalendarDays,
      label: "Who is on leave?",
      prompt:
        "Who has pending or upcoming leave in the records available to me?",
    },
    {
      icon: BookOpen,
      label: "Explain a policy",
      prompt:
        "What do our handbook policies say about leave and expense claims?",
    },
    {
      icon: Users,
      label: "Follow up with my team",
      prompt:
        "Which pending requests and goals in my available records need follow-up?",
    },
    ...(staff
      ? [
          {
            icon: BriefcaseBusiness,
            label: "Plan an interview",
            prompt:
              "Suggest a practical interview plan for our published job listings.",
          },
        ]
      : []),
  ];
  return (
    <div className="assistant-page">
      <div className="assistant-top">
        <div>
          <h1>People AI</h1>
          <span>
            {workspace.ai.model || "ai-nonymauz-cloud"}
            <span className="dot-separator">·</span>Read-only assistant
          </span>
        </div>
        <div className="table-actions">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => setHistoryOpen((v) => !v)}
          >
            <MessageSquare size={15} />
            History
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={newChat}>
            <Plus size={15} />
            New chat
          </Button>
        </div>
      </div>
      {historyOpen ? (
        <div className="chat-history">
          <h3>Your recent conversations</h3>
          {threads.length ? (
            threads.map((id) => (
              <button
                key={id}
                onClick={() => {
                  setMessages(history.filter((m) => m.thread_id === id));
                  setThreadId(id);
                  setHistoryOpen(false);
                  setMode("hr");
                  setRecordId("");
                }}
              >
                {history.find((m) => m.thread_id === id && m.role === "user")
                  ?.content || "Conversation"}
              </button>
            ))
          ) : (
            <p>No conversations yet.</p>
          )}
        </div>
      ) : null}
      {!configured ? (
        <div className="ai-setup-note">
          <Settings2 size={19} />
          <div>
            <strong>
              {!workspace.ai.configured
                ? "Connect ai-nonymauz-cloud"
                : "Enable AI for your workspace"}
            </strong>
            <p>
              {!workspace.ai.configured
                ? "Add the backend URL, API key and model alias in your server environment."
                : "The workspace owner can enable AI in Settings. Authorized records are sent to the configured endpoint."}
            </p>
          </div>
          {workspace.actor.role === "owner" ? (
            <Button size="sm" variant="outline" onClick={() => go("settings")}>
              Settings
            </Button>
          ) : null}
        </div>
      ) : null}
      <div
        className={`conversation ${!messages.length ? "conversation-empty" : ""}`}
      >
        {!messages.length ? (
          <div className="chat-welcome">
            <span className="chat-mark">
              <MessageSquare size={25} />
            </span>
            <h2>What can I help you with?</h2>
            <p>Your HR questions, grounded in your workspace.</p>
            <div className="suggestion-grid">
              {suggestions.map((s) => (
                <button
                  key={s.label}
                  onClick={() => {
                    setMode("hr");
                    setMessage(s.prompt);
                  }}
                >
                  <s.icon size={19} />
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div
              className={`chat-message ${m.role === "user" ? "user-message" : "ai-message"}`}
              key={m.id || i}
            >
              {m.role === "assistant" ? (
                <span className="message-avatar">N</span>
              ) : null}
              <div className="message-body">
                {m.role === "user" ? (
                  <p>{m.content}</p>
                ) : (
                  <>
                    <div className="markdown">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        skipHtml
                        components={{
                          a: ({ children, href }) => (
                            <a href={href} target="_blank" rel="noreferrer">
                              {children}
                            </a>
                          ),
                        }}
                      >
                        {m.content.replace(
                          /\[source:([a-f0-9-]+)\]/g,
                          (_, id) =>
                            `[${m.sources.find((s) => s.id === id)?.label || "Record"}]`,
                        )}
                      </ReactMarkdown>
                    </div>
                    <div className="message-controls">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Copy answer"
                        onClick={() =>
                          navigator.clipboard
                            .writeText(m.content)
                            .then(() => toast.success("Answer copied"))
                            .catch(() =>
                              toast.error("Select the answer to copy it"),
                            )
                        }
                      >
                        <Copy size={14} />
                      </Button>
                      {m.sources.length === 1 &&
                      m.sources[0].kind === "meeting" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const r = workspace.records.find(
                              (r) => r.id === m.sources[0].id,
                            );
                            if (r)
                              edit("meeting", {
                                ...r,
                                data: { ...r.data, summary: m.content },
                              });
                          }}
                        >
                          <FileText size={13} />
                          Review as meeting summary
                        </Button>
                      ) : null}
                    </div>
                    {m.sources.length ? (
                      <details className="sources-panel">
                        <summary>
                          <Database size={13} />
                          {m.sources.length} records supplied
                          <ChevronDown size={13} />
                        </summary>
                        <div>
                          {m.sources.map((s) => (
                            <span key={s.id}>
                              {s.label}
                              <small>{s.kind}</small>
                            </span>
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          ))
        )}
        {busy ? (
          <div className="chat-message ai-message">
            <span className="message-avatar">N</span>
            <div className="thinking">
              <Loader2 size={16} className="animate-spin" />
              Reading your workspace…
            </div>
          </div>
        ) : null}
        <div ref={end} />
      </div>
      <div className="composer-area">
        <div className="composer-options">
          {staff ? (
            <NativeSelect
              label="Assistant mode"
              value={mode}
              onChange={(v) => {
                setMode(v);
                setRecordId("");
              }}
              options={[
                { value: "hr", label: "HR assistant" },
                { value: "recruit", label: "Recruit assistant" },
                { value: "resume", label: "Resume review" },
                { value: "meeting", label: "Meeting summary" },
                { value: "preferences", label: "Work preferences" },
              ]}
            />
          ) : (
            <span>HR assistant</span>
          )}
          {["resume", "meeting", "preferences"].includes(mode) ? (
            <NativeSelect
              label="Record for AI review"
              value={recordId}
              onChange={setRecordId}
              options={[
                { value: "", label: "Choose a record" },
                ...records.map((r) => ({
                  value: r.id,
                  label: recordLabel(r.id),
                })),
              ]}
            />
          ) : null}
        </div>
        <form className="chat-composer" onSubmit={send}>
          <Textarea
            aria-label="Message People AI"
            placeholder="Ask about your people, policies or work…"
            rows={2}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void send();
              }
            }}
          />
          {busy ? (
            <Button
              type="button"
              className="send-button"
              size="icon"
              aria-label="Stop AI request"
              onClick={() => abort.current?.abort()}
            >
              <Square size={14} />
            </Button>
          ) : (
            <Button
              type="submit"
              className="send-button"
              size="icon"
              aria-label="Send message"
              disabled={
                !configured ||
                !message.trim() ||
                (["resume", "meeting", "preferences"].includes(mode) &&
                  !recordId)
              }
            >
              <ArrowUp size={19} />
            </Button>
          )}
        </form>
        <p className="composer-foot">
          AI can make mistakes. Check the records. Enter adds a new line; Ctrl +
          Enter sends.
        </p>
      </div>
    </div>
  );
}
