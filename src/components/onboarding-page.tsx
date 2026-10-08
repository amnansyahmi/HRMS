"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { api } from "@/lib/client";
import { toast } from "sonner";
import type { Data } from "@/lib/types";
import { employeeDetails } from "./extended-fields";
export function OnboardingPage({ token }: { token: string }) {
  const [profile, setProfile] = useState<{
      name: string;
      requiredDocuments: string[];
      data: Data;
      status: string;
    } | null>(null),
    [data, setData] = useState<Data>({}),
    [dependants, setDependants] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const url = "/api/onboarding/" + token;
  useEffect(() => {
    let active = true;
    api<NonNullable<typeof profile>>(url)
      .then((p) => {
        if (active) {
          setProfile(p);
          setData(p.data);
          setDependants(
            ((p.data.dependants as Data[]) || [])
              .map((d) =>
                [d.name, d.relationship, d.birthDate || ""].join(" | "),
              )
              .join("\n"),
          );
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [url]);
  async function save(submit: boolean) {
    setBusy(true);
    try {
      const parsedDependants = dependants
        .split("\n")
        .filter((v) => v.trim())
        .map((v) => {
          const [name, relationship, birthDate] = v
            .split("|")
            .map((p) => p.trim());
          return { name, relationship, birthDate: birthDate || null };
        });
      await api(url, {
        data: { ...data, dependants: parsedDependants },
        submit,
      });
      const p = await api<NonNullable<typeof profile>>(url);
      setProfile(p);
      setData(p.data);
      toast.success(submit ? "Submitted to HR" : "Progress saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(type: string, file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("type", type);
      await api(url, form);
      const p = await api<NonNullable<typeof profile>>(url);
      setProfile(p);
      setData((current) => ({ ...current, documents: p.data.documents }));
      toast.success("Document uploaded");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const documents =
    (data.documents as { type: string; filename: string }[]) || [];
  return (
    <div className="public-page onboarding-page">
      <Link className="auth-brand" href="/">
        <span className="brand-mark">N</span>Nonymauz People
      </Link>
      <h1>{profile ? `Welcome, ${profile.name}` : "Your employee profile"}</h1>
      <p>Complete your details before your first day. HR will review them.</p>
      {error ? (
        <p role="alert">{error}</p>
      ) : !profile ? (
        <p>Loading your profile…</p>
      ) : profile.status === "Submitted" ? (
        <section className="record-card">
          <h2>Ready for HR review</h2>
          <p>Your profile and documents have been submitted.</p>
        </section>
      ) : (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save(true);
            }}
          >
            <div className="record-form-grid">
              {[{ key: "phone", label: "Phone" }, ...employeeDetails]
                .filter((f) =>
                  [
                    "phone",
                    "nric",
                    "birthDate",
                    "nationality",
                    "state",
                    "race",
                    "religion",
                    "address",
                    "epfNo",
                    "socsoNo",
                    "taxNo",
                    "bankName",
                    "bankAccount",
                    "emergencyName",
                    "emergencyPhone",
                    "education",
                    "pastEmployment",
                  ].includes(f.key),
                )
                .map((f) => (
                  <div
                    className={`form-field ${f.type === "textarea" ? "full" : ""}`}
                    key={f.key}
                  >
                    <Label htmlFor={"onboard-" + f.key}>{f.label}</Label>
                    {f.type === "textarea" ? (
                      <Textarea
                        id={"onboard-" + f.key}
                        value={String(data[f.key] || "")}
                        onChange={(e) =>
                          setData((d) => ({ ...d, [f.key]: e.target.value }))
                        }
                      />
                    ) : f.type === "select" ? (
                      <select
                        className="native-select"
                        id={"onboard-" + f.key}
                        value={String(data[f.key] || f.options?.[0] || "")}
                        onChange={(e) =>
                          setData((d) => ({ ...d, [f.key]: e.target.value }))
                        }
                      >
                        {f.options?.map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        id={"onboard-" + f.key}
                        type={f.type === "date" ? "date" : "text"}
                        required={["emergencyName", "emergencyPhone"].includes(
                          f.key,
                        )}
                        value={String(data[f.key] || "")}
                        onChange={(e) =>
                          setData((d) => ({
                            ...d,
                            [f.key]: e.target.value || null,
                          }))
                        }
                      />
                    )}
                  </div>
                ))}
            </div>
            <label className="form-field">
              Dependants — name | relationship | date of birth, one per line
              <Textarea
                value={dependants}
                onChange={(e) => setDependants(e.target.value)}
                placeholder="Name | Spouse | YYYY-MM-DD"
              />
            </label>
            <h2>Required documents</h2>
            <div className="checklist">
              {profile.requiredDocuments.map((type) => (
                <div className="row-between" key={type}>
                  <span>
                    {type}
                    <small>
                      {documents.find((d) => d.type === type)?.filename ||
                        "Not uploaded"}
                    </small>
                  </span>
                  <Button variant="outline" disabled={busy} asChild>
                    <label>
                      Upload
                      <input
                        className="sr-only"
                        type="file"
                        accept=".pdf,.docx,.jpg,.jpeg,.png,.txt"
                        onChange={(e) => void upload(type, e.target.files?.[0])}
                      />
                    </label>
                  </Button>
                </div>
              ))}
            </div>
            <div className="toolbar-actions">
              <Button
                variant="outline"
                type="button"
                disabled={busy}
                onClick={() => void save(false)}
              >
                Save progress
              </Button>
              <Button type="submit" disabled={busy}>
                Submit to HR
              </Button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
