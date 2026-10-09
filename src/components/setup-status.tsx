"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, Circle, RefreshCw } from "lucide-react";
import { api } from "@/lib/client";
import type { SetupCheck } from "@/lib/deployment-config";
import { Button } from "./ui/button";
export function SetupStatus() {
  const [data, setData] = useState<{
      checks: SetupCheck[];
      databaseConnected: boolean;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    setError("");
    try {
      setData(await api("/api/setup"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let active = true;
    api<NonNullable<typeof data>>("/api/setup")
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <section className="settings-section">
      <div className="row-between">
        <div>
          <h2>Deployment setup</h2>
          <p>
            Configuration checks for your server. Credentials are never
            displayed.
          </p>
        </div>
        <Button variant="outline" disabled={busy} onClick={() => void load()}>
          <RefreshCw size={15} />
          Refresh checks
        </Button>
      </div>
      {error ? (
        <p role="alert" className="info-note">
          {error}
        </p>
      ) : null}
      {data ? (
        <>
          <p className="info-note">
            Database connection:{" "}
            {data.databaseConnected ? "responding" : "unavailable"}. Configured
            checks confirm presence or format; they do not certify email
            delivery, scheduled jobs or external AI/worker services.
          </p>
          <div className="setup-checks">
            {data.checks.map((c) => (
              <article className="setup-check" key={c.id}>
                {c.ready ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                <div>
                  <h3>
                    {c.title}{" "}
                    <small>{c.ready ? "Configured" : "Needs setup"}</small>
                  </h3>
                  <p>{c.detail}</p>
                  <div className="setup-keys">
                    {c.keys.map((k) => (
                      <code key={k}>{k}</code>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : !error ? (
        <p role="status">Loading setup checks…</p>
      ) : null}
    </section>
  );
}
