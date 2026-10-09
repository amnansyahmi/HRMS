"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { NativeSelect } from "./common";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import type { Company } from "@/lib/types";
import type { aiUsage } from "@/lib/ai-usage";
export function AIManagement({
  settings,
  onChange,
  models,
  onSave,
  busy,
}: {
  settings: Company["settings"];
  onChange: (settings: Company["settings"]) => void;
  models: string[];
  onSave: () => void;
  busy: boolean;
}) {
  const [usage, setUsage] = useState<Awaited<
      ReturnType<typeof aiUsage>
    > | null>(null),
    [error, setError] = useState("");
  const routing = settings.aiRouting || {
    generalModel: "",
    analysisModel: "",
    visionModel: "",
    monthlyRequestLimit: 0,
  };
  useEffect(() => {
    let active = true;
    api<Awaited<ReturnType<typeof aiUsage>>>("/api/ai/usage")
      .then((value) => {
        if (active) setUsage(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  const aliases = [
    ...new Set(
      [
        ...models,
        routing.generalModel,
        routing.analysisModel,
        routing.visionModel,
      ].filter(Boolean),
    ),
  ];
  return (
    <section className="settings-section">
      <h2>Models and usage</h2>
      <p>
        Use Check connection to discover model aliases. Quick questions use the
        general model; documents, resume reviews, meeting summaries and CHRO
        briefs use the analysis model. Image attachments require a
        vision-capable model selected by the owner.
      </p>
      <div className="record-form-grid">
        {(
          [
            ["generalModel", "General questions"],
            ["analysisModel", "Longer analysis"],
            ["visionModel", "Image attachments"],
          ] as const
        ).map(([key, label]) => (
          <div className="form-field" key={key}>
            <Label>{label}</Label>
            <NativeSelect
              label={label}
              value={routing[key]}
              onChange={(value) =>
                onChange({
                  ...settings,
                  aiRouting: { ...routing, [key]: value },
                })
              }
              options={[
                {
                  value: "",
                  label:
                    key === "visionModel"
                      ? "Image sending disabled"
                      : "Use server default",
                },
                ...aliases.map((value) => ({ value, label: value })),
              ]}
            />
          </div>
        ))}
        <div className="form-field">
          <Label htmlFor="monthly-ai-budget">Monthly request budget</Label>
          <Input
            id="monthly-ai-budget"
            type="number"
            min={0}
            max={100000}
            value={routing.monthlyRequestLimit}
            onChange={(e) =>
              onChange({
                ...settings,
                aiRouting: {
                  ...routing,
                  monthlyRequestLimit: Number(e.target.value),
                },
              })
            }
          />
          <small>
            0 means no additional monthly cap. UTC calendar month; failed and
            in-flight requests count toward the cap.
          </small>
        </div>
      </div>
      <Button onClick={onSave} disabled={busy}>
        Save AI models and budget
      </Button>
      <h3>Current month</h3>
      {error ? (
        <p role="alert">{error}</p>
      ) : !usage ? (
        <p>Loading usage…</p>
      ) : (
        <>
          <p>
            {usage.requests} requests recorded in {usage.month}. Historical
            requests before this feature are excluded.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Status</th>
                  <th>Requests</th>
                  <th>Tokens</th>
                  <th>Average response</th>
                </tr>
              </thead>
              <tbody>
                {usage.rows.map((row) => (
                  <tr key={row.model + row.status}>
                    <td>{row.model}</td>
                    <td>{row.status}</td>
                    <td>{row.requests}</td>
                    <td>
                      {row.total_tokens ?? "Not reported"}
                      {Number(row.reported) < Number(row.requests)
                        ? ` (${row.reported}/${row.requests} reported)`
                        : ""}
                    </td>
                    <td>
                      {row.response_ms
                        ? `${(Number(row.response_ms) / 1000).toFixed(1)}s`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!usage.requests ? <p>No requests recorded this month.</p> : null}
          <p>
            No monetary cost is estimated because backend provider pricing is
            not configured.
          </p>
        </>
      )}
    </section>
  );
}
