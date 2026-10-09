"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Square,
  Plus,
  History,
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
import { Popover } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { api } from "@/lib/client";
import { toast } from "sonner";
import { useWorkspace } from "./workspace-context";
import { NativeSelect } from "./common";
import {
  specialistLabels,
  specialistNames,
  specialistAllows,
} from "@/lib/workflow-config";
import { isStaff } from "@/lib/types";
import { Dictation, ReadAnswer } from "./voice-controls";
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
  cards?: {
    id: string;
    action: string;
    label: string;
    expiresAt: string;
    preview?: Record<string, unknown>;
    requiresLocation?: boolean;
  }[];
};
export function AssistantPage({ intent }: { intent?: AssistantIntent }) {
  const { workspace, go, edit, act } = useWorkspace(),
    [message, setMessage] = useState(intent?.message || ""),
    [mode, setMode] = useState(intent?.mode || "hr"),
    [recordId, setRecordId] = useState(intent?.recordId || ""),
    [messages, setMessages] = useState<Message[]>([]),
    [history, setHistory] = useState<Message[]>([]),
    [threadId, setThreadId] = useState<string | undefined>(),
    [busy, setBusy] = useState(false),
    [historyOpen, setHistoryOpen] = useState(false),
    [optionsOpen, setOptionsOpen] = useState(false),
    frame = useRef<HTMLDivElement>(null),
    conversation = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    abort = useRef<AbortController | null>(null),
    staff = isStaff(workspace.actor);
  const loadHistory = useCallback(async () => {
    try {
      setHistory(await api<Message[]>("/api/ai"));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, []);
  const appendDictation = useCallback(
    (text: string) =>
      setMessage((old) => `${old}${old ? " " : ""}${text}`.slice(0, 4000)),
    [],
  );
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
    const viewport = window.visualViewport;
    const root = frame.current;
    const main = root?.closest<HTMLElement>(".chat-content");
    if (!viewport || !root || !main) return;
    function resize() {
      if (!window.matchMedia("(max-width: 767px)").matches) {
        main!.style.removeProperty("height");
        delete root!.dataset.keyboardOpen;
        return;
      }
      const keyboardOpen = window.innerHeight - viewport!.height > 120;
      root!.dataset.keyboardOpen = String(keyboardOpen);
      const navigation =
        document.querySelector<HTMLElement>(".mobile-bottom-nav");
      const bottom = keyboardOpen
        ? 0
        : navigation?.getBoundingClientRect().height || 0;
      const top = Math.max(
        0,
        root!.getBoundingClientRect().top - viewport!.offsetTop,
      );
      main!.style.height = `${Math.max(180, viewport!.height - top - bottom)}px`;
    }
    resize();
    viewport.addEventListener("resize", resize);
    viewport.addEventListener("scroll", resize);
    window.addEventListener("resize", resize);
    return () => {
      viewport.removeEventListener("resize", resize);
      viewport.removeEventListener("scroll", resize);
      window.removeEventListener("resize", resize);
      main.style.removeProperty("height");
    };
  }, []);
  useEffect(() => {
    const scroll = conversation.current;
    scroll?.scrollTo({
      top: scroll.scrollHeight,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }, [messages, busy]);
  useEffect(() => {
    const textarea = input.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [message]);
  const records = workspace.records.filter((r) =>
    mode === "resume"
      ? r.kind === "candidate"
      : mode === "meeting"
        ? r.kind === "meeting"
        : mode === "preferences"
          ? r.kind === "assessment_result" &&
            !!r.data.submittedAt &&
            ["Work preferences", "DISC", "DOPE"].includes(
              (r.data.assessmentSnapshot as { type: string }).type,
            )
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
  const requiresRecord = ["resume", "meeting", "preferences"].includes(mode);
  const modes = [
    { value: "hr", label: "HR assistant" },
    ...(workspace.actor.role === "owner" &&
    workspace.company.settings.aiAgents.chro
      ? [{ value: "chro", label: "CHRO brief · read only" }]
      : []),
    ...specialistNames
      .filter(
        (name) =>
          specialistAllows(workspace.company.settings, name, "read") &&
          (name !== "recruitment" || staff),
      )
      .map((name) => ({
        value: name,
        label: specialistLabels[name] + " specialist",
      })),
    ...(staff
      ? [
          { value: "resume", label: "Resume review" },
          { value: "meeting", label: "Meeting summary" },
          { value: "preferences", label: "Work preferences" },
        ]
      : []),
  ];
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
    setHistoryOpen(false);
    setOptionsOpen(false);
    input.current?.focus();
  }
  async function send(event?: React.FormEvent) {
    event?.preventDefault();
    if (!message.trim() || busy || !configured || (requiresRecord && !recordId))
      return;
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
        {
          role: "assistant",
          content: result.text,
          sources: result.sources,
          cards: result.cards,
        },
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
    <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
      <div className="assistant-page" ref={frame}>
        <div className="assistant-top">
          <Popover.Root open={optionsOpen} onOpenChange={setOptionsOpen}>
            <Popover.Trigger asChild>
              <Button
                variant="ghost"
                className="chat-mode-button"
                disabled={busy}
                aria-label="Chat options"
              >
                {modes.find((m) => m.value === mode)?.label || "HR assistant"}
                <ChevronDown size={15} />
              </Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                className="chat-options-popover"
                align="start"
                sideOffset={8}
                collisionPadding={16}
              >
                <h2>Chat options</h2>
                <label className="chat-option-field">
                  <span>Assistant</span>
                  <NativeSelect
                    label="Assistant mode"
                    value={mode}
                    onChange={(v) => {
                      setMode(v);
                      setRecordId("");
                    }}
                    options={modes}
                  />
                </label>
                {requiresRecord ? (
                  <label className="chat-option-field">
                    <span>Record to review</span>
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
                  </label>
                ) : null}
                <p>{workspace.ai.model || "ai-nonymauz-cloud"}</p>
                <p>Changes are saved only after you confirm.</p>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <div className="chat-top-actions">
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                disabled={busy}
                aria-label="History"
                title="Conversation history"
              >
                <History size={18} />
              </Button>
            </DialogTrigger>
            <Button
              variant="ghost"
              size="icon"
              disabled={busy}
              onClick={newChat}
              aria-label="New chat"
              title="New chat"
            >
              <Plus size={19} />
            </Button>
          </div>
        </div>
        {!configured ? (
          <div className="ai-setup-note">
            <Settings2 size={18} />
            <div>
              <strong>
                {!workspace.ai.configured
                  ? "Connect ai-nonymauz-cloud"
                  : "Enable AI for your workspace"}
              </strong>
              <p>
                {!workspace.ai.configured
                  ? "Add your backend URL, API key and model alias to the server environment."
                  : "The workspace owner can enable AI in Settings."}
              </p>
            </div>
            {workspace.actor.role === "owner" ? (
              <Button size="sm" variant="ghost" onClick={() => go("settings")}>
                Settings
              </Button>
            ) : null}
          </div>
        ) : null}
        <div
          className={`chat-stage ${messages.length ? "chat-stage-active" : "chat-stage-empty"}`}
        >
          {!messages.length ? (
            <div className="chat-welcome">
              <h1>What can I help you with?</h1>
              <p>Ask about your people, policies or everyday work.</p>
            </div>
          ) : null}
          <div
            ref={conversation}
            className={`conversation ${!messages.length ? "conversation-empty" : ""}`}
            role="log"
            aria-label="Conversation"
            aria-live="polite"
            aria-relevant="additions"
            aria-busy={busy}
          >
            {messages.length
              ? messages.map((m, i) => (
                  <div
                    className={`chat-message ${m.role === "user" ? "user-message" : "ai-message"}`}
                    key={m.id || i}
                  >
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
                                  <a
                                    href={href}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
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
                          {m.cards?.map((card) => (
                            <div className="ai-action-card" key={card.id}>
                              <strong>{card.label}</strong>
                              <p>
                                Confirm this change. Your permissions and the
                                latest record will be checked.
                              </p>
                              {card.preview ? (
                                card.action === "letter-draft" ? (
                                  <div className="action-preview preserve-lines">
                                    <strong>
                                      {String(card.preview.title)}
                                    </strong>
                                    <p>{String(card.preview.body)}</p>
                                    <small>
                                      Save as draft only ·{" "}
                                      {String(card.preview.effectiveDate)}
                                    </small>
                                  </div>
                                ) : (
                                  <pre className="action-preview">
                                    {JSON.stringify(card.preview, null, 2)}
                                  </pre>
                                )
                              ) : null}
                              <Button
                                size="sm"
                                onClick={async () => {
                                  let coordinates:
                                    | {
                                        latitude: number;
                                        longitude: number;
                                        accuracy: number;
                                      }
                                    | undefined;
                                  if (card.requiresLocation) {
                                    try {
                                      const position =
                                        await new Promise<GeolocationPosition>(
                                          (resolve, reject) =>
                                            navigator.geolocation.getCurrentPosition(
                                              resolve,
                                              reject,
                                              {
                                                enableHighAccuracy: true,
                                                maximumAge: 0,
                                                timeout: 15000,
                                              },
                                            ),
                                        );
                                      coordinates = {
                                        latitude: position.coords.latitude,
                                        longitude: position.coords.longitude,
                                        accuracy: position.coords.accuracy,
                                      };
                                    } catch {
                                      toast.error(
                                        "Allow precise location to confirm clock-in",
                                      );
                                      return;
                                    }
                                  }
                                  const result = await act(
                                    "ai-confirm",
                                    { id: card.id, coordinates },
                                    "Confirmed action completed",
                                  );
                                  if (result)
                                    setMessages((rows) =>
                                      rows.map((message) =>
                                        message === m
                                          ? {
                                              ...message,
                                              cards: message.cards?.filter(
                                                (c) => c.id !== card.id,
                                              ),
                                            }
                                          : message,
                                      ),
                                    );
                                }}
                              >
                                Confirm action
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={async () => {
                                  const result = await act("ai-cancel", {
                                    id: card.id,
                                  });
                                  if (result)
                                    setMessages((rows) =>
                                      rows.map((row) =>
                                        row === m
                                          ? {
                                              ...row,
                                              cards: row.cards?.filter(
                                                (c) => c.id !== card.id,
                                              ),
                                            }
                                          : row,
                                      ),
                                    );
                                }}
                              >
                                Cancel
                              </Button>
                            </div>
                          ))}
                          <div className="message-controls">
                            <ReadAnswer compact text={m.content} />
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
              : null}
            {busy ? (
              <div className="chat-message ai-message">
                <div className="thinking">
                  <Loader2 size={16} className="animate-spin" />
                  Reading your workspace…
                </div>
              </div>
            ) : null}
          </div>
          <div className="composer-area">
            <form className="chat-composer" onSubmit={send}>
              {requiresRecord ? (
                <button
                  type="button"
                  className="chat-record-chip"
                  onClick={() => setOptionsOpen(true)}
                >
                  <FileText size={14} />
                  {recordId
                    ? recordLabel(recordId)
                    : "Choose a record to review"}
                  <ChevronDown size={13} />
                </button>
              ) : null}
              <Textarea
                ref={input}
                aria-label="Message People AI"
                placeholder="Ask People AI…"
                rows={1}
                maxLength={4000}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    (e.ctrlKey || e.metaKey) &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="composer-toolbar">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Chat options"
                  title="Choose an assistant or record"
                  onClick={() => setOptionsOpen(true)}
                  disabled={busy}
                >
                  <Settings2 size={18} />
                </Button>
                <div className="composer-send-tools">
                  <Dictation
                    compact
                    onTranscript={appendDictation}
                    disabled={busy}
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
                      title="Send (Ctrl / ⌘ + Enter)"
                      disabled={
                        !configured ||
                        !message.trim() ||
                        (requiresRecord && !recordId)
                      }
                    >
                      <ArrowUp size={20} />
                    </Button>
                  )}
                </div>
              </div>
            </form>
            {messages.length ? (
              <p className="composer-foot">
                AI can make mistakes. Review important details.
              </p>
            ) : null}
          </div>
          {!messages.length ? (
            <div className="suggestion-grid">
              {suggestions.map((s) => (
                <button
                  key={s.label}
                  onClick={() => {
                    setMode("hr");
                    setRecordId("");
                    setMessage(s.prompt);
                    input.current?.focus();
                  }}
                >
                  <s.icon size={15} />
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <DialogContent className="chat-history-dialog">
          <DialogTitle>Recent conversations</DialogTitle>
          <DialogDescription>
            Only your workspace conversations appear here.
          </DialogDescription>
          <div className="chat-history">
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
                  <MessageSquare size={16} />
                  <span>
                    {history.find(
                      (m) => m.thread_id === id && m.role === "user",
                    )?.content || "Conversation"}
                  </span>
                </button>
              ))
            ) : (
              <p>No conversations yet. Your chats will appear here.</p>
            )}
          </div>
        </DialogContent>
      </div>
    </Dialog>
  );
}
