"use client";
import { useEffect, useState } from "react";
import { Bell, MessageSquare, ArrowRight } from "lucide-react";
import { api } from "@/lib/client";
import { Button } from "./ui/button";
import { useWorkspace, type Page } from "./workspace-context";
import type { buildHRDigest } from "@/lib/hr-digest";
export function HRDigest() {
  const { workspace, go, ask } = useWorkspace();
  const [expanded, setExpanded] = useState(false);
  const [digest, setDigest] = useState<ReturnType<typeof buildHRDigest> | null>(
      null,
    ),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<ReturnType<typeof buildHRDigest>>("/api/digest")
      .then((data) => {
        if (active) {
          setDigest(data);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [workspace]);
  return (
    <section className="panel hr-digest">
      <div className="panel-heading">
        <h2>
          <Bell size={17} />
          Your HR digest
        </h2>
        {digest ? <span>{digest.total} follow-ups</span> : null}
      </div>
      <div className="digest-body">
        {error ? (
          <p role="alert">{error}</p>
        ) : !digest ? (
          <p>Loading follow-ups…</p>
        ) : (
          <>
            <p>Due work and upcoming dates from records available to you.</p>
            {digest.items.slice(0, expanded ? 100 : 5).map((item) => (
              <button
                className="digest-item"
                key={item.id + item.category}
                onClick={() => go(item.page as Page)}
              >
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </span>
                <ArrowRight size={16} />
              </button>
            ))}
            {!digest.total ? <p>No follow-ups flagged today.</p> : null}
            {digest.total > 5 ? (
              <Button variant="ghost" onClick={() => setExpanded(!expanded)}>
                {expanded ? "Show less" : "Show all follow-ups"}
              </Button>
            ) : null}
            <Button
              variant="outline"
              disabled={!workspace.ai.enabled || !workspace.ai.configured}
              onClick={() =>
                ask(
                  "hr",
                  undefined,
                  "Summarize my HR digest and explain which authorized follow-ups need attention first.",
                )
              }
            >
              <MessageSquare size={16} />
              Discuss with AI
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
