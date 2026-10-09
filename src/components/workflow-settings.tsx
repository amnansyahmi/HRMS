"use client";
import { useState } from "react";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { api } from "@/lib/client";
import { toast } from "sonner";
import {
  payrollCapabilities,
  specialistNames,
  specialistLabels,
  defaultSpecialists,
} from "@/lib/workflow-config";
import type { Company, Workspace } from "@/lib/types";
export function PayrollAccessControl({
  member,
  refresh,
}: {
  member: Workspace["members"][number];
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const permissions =
    member.payroll_access ??
    (member.role === "owner" || member.role === "hr"
      ? [...payrollCapabilities]
      : []);
  if (member.role === "owner") return <small>Full access</small>;
  async function change(key: string, checked: boolean) {
    const next = checked
      ? [...new Set([...permissions, "read", key])]
      : key === "read"
        ? []
        : permissions.filter((k) => k !== key);
    setBusy(true);
    try {
      await api("/api/auth/payroll-access", {
        userId: member.user_id,
        permissions: next,
      });
      await refresh();
      toast.success("Payroll access updated");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="permission-grid">
      {payrollCapabilities.map((key) => (
        <label key={key}>
          <Checkbox
            aria-label={`${member.name}: payroll ${key}`}
            disabled={busy}
            checked={permissions.includes(key)}
            onCheckedChange={(v) => void change(key, v === true)}
          />
          <span>
            {key === "read"
              ? "View"
              : key === "prepare"
                ? "Prepare"
                : key === "approve"
                  ? "Approve"
                  : "Payments"}
          </span>
        </label>
      ))}
    </div>
  );
}
export function SpecialistControls({
  settings,
  onChange,
}: {
  settings: Company["settings"];
  onChange: (value: Company["settings"]) => void;
}) {
  return (
    <section className="settings-panel">
      <h2>HR specialist permissions</h2>
      <p>
        Choose which assistants can read records and which actions they may
        prepare. Every change still requires your confirmation.
      </p>
      <div className="record-cards">
        {specialistNames.map((name) => {
          const policy =
            settings.aiSpecialists[name] || defaultSpecialists[name];
          const tools = [
            ...new Set([
              ...defaultSpecialists[name].tools,
              ...(name === "attendance" ? ["configure"] : []),
            ]),
          ];
          return (
            <article className="record-card" key={name}>
              <Label className="permission-heading">
                <Checkbox
                  checked={policy.enabled}
                  onCheckedChange={(v) =>
                    onChange({
                      ...settings,
                      aiSpecialists: {
                        ...settings.aiSpecialists,
                        [name]: { ...policy, enabled: v === true },
                      },
                    })
                  }
                />
                {specialistLabels[name]}
              </Label>
              <div className="permission-grid">
                {tools.map((tool) => (
                  <label key={tool}>
                    <Checkbox
                      disabled={!policy.enabled}
                      checked={policy.tools.includes(tool)}
                      onCheckedChange={(v) =>
                        onChange({
                          ...settings,
                          aiSpecialists: {
                            ...settings.aiSpecialists,
                            [name]: {
                              ...policy,
                              tools:
                                v === true
                                  ? [...new Set([...policy.tools, tool])]
                                  : policy.tools.filter((t) => t !== tool),
                            },
                          },
                        })
                      }
                    />
                    <span>
                      {
                        (
                          {
                            read: "Read records",
                            review: "Review requests",
                            clock: "Clock in/out",
                            configure: "Configure reminders",
                            "create-leave": "Draft leave",
                            "create-claim": "Draft claim",
                            "candidate-stage": "Move candidate",
                            "letter-draft": "Draft letter",
                          } as Record<string, string>
                        )[tool]
                      }
                    </span>
                  </label>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
