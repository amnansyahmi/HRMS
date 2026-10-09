"use client";
import { useState } from "react";
import { ClipboardCheck, Loader2, MessageSquare } from "lucide-react";
import { hasPayroll } from "@/lib/workflow-config";
import { api } from "@/lib/client";
import { Button } from "./ui/button";
import { useWorkspace } from "./workspace-context";
import type { checkPayrollDrafts } from "@/lib/payroll-diagnostics";
export function PayrollChecks({
  period,
  runId,
}: {
  period: string;
  runId: string;
}) {
  const { workspace, ask, edit } = useWorkspace();
  const [result, setResult] = useState<ReturnType<
      typeof checkPayrollDrafts
    > | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <section className="payroll-checks panel">
      <div className="panel-heading">
        <h2>Pre-publication checks</h2>
        <Button
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              setResult(
                await api(
                  `/api/payroll/checks?period=${period}${runId ? `&runId=${runId}` : ""}`,
                ),
              );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <ClipboardCheck size={16} />
          )}
          Check payroll drafts
        </Button>
      </div>
      <div className="digest-body">
        <p>
          Checks stored totals, repeated inputs, missing details and changes
          from the last monthly run, using records available to your role. HR
          remains responsible for review.
        </p>
        {error ? <p role="alert">{error}</p> : null}
        {result ? (
          <>
            <p role="status">
              {result.drafts} drafts checked · {result.errors} errors ·{" "}
              {result.findings.length} findings
            </p>
            {result.findings.map((finding, i) => (
              <div
                className="payroll-finding"
                key={finding.recordId + finding.code + i}
              >
                <strong>
                  {finding.severity}: {finding.title}
                </strong>
                <p>{finding.detail}</p>
                <div className="table-actions">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!hasPayroll(workspace.actor, "prepare")}
                    onClick={() => {
                      const record = workspace.records.find(
                        (r) => r.id === finding.recordId,
                      );
                      if (record) edit("payroll", record);
                    }}
                  >
                    Open draft
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!workspace.ai.enabled || !workspace.ai.configured}
                    onClick={() =>
                      ask(
                        "payroll",
                        finding.recordId,
                        "Explain the payroll diagnostics for this draft and suggest what HR should verify. Do not change any amounts.",
                      )
                    }
                  >
                    <MessageSquare size={15} />
                    Explain with AI
                  </Button>
                </div>
              </div>
            ))}
            {!result.findings.length ? (
              <p>
                No discrepancies flagged by these checks. Complete the normal
                review before publication.
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
