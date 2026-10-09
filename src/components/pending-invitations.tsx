"use client";
import { useEffect, useState } from "react";
import { api, shortDate } from "@/lib/client";
import { Button } from "./ui/button";
import { toast } from "sonner";
type Invitation = {
  id: string;
  email: string;
  role: string;
  employee_id: string | null;
  expires_at: string;
  active: boolean;
};
export function PendingInvitations({ revision }: { revision: string }) {
  const [rows, setRows] = useState<Invitation[]>([]),
    [url, setUrl] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<Invitation[]>("/api/access")
      .then((data) => {
        if (active) setRows(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [revision]);
  async function manage(row: Invitation, revoke: boolean) {
    setBusy(true);
    try {
      if (revoke) {
        await api("/api/access", { id: row.id });
        setUrl("");
        toast.success("Invitation revoked");
      } else {
        const result = await api<{ url: string }>("/api/auth/invite", {
          email: row.email,
          role: row.role,
          employeeId: row.employee_id,
        });
        setUrl(result.url);
        toast.success("New invitation prepared; previous link expired");
      }
      setRows(await api<Invitation[]>("/api/access"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3 mt-6">
      <h3>Invitations awaiting acceptance</h3>
      <p className="muted-text">
        Employee creation prepares access automatically. Resending replaces the
        old link. Email delivery requires configured SMTP.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {rows.map((row) => (
        <div
          className="rounded-xl border p-3 flex flex-wrap items-center justify-between gap-3"
          key={row.id}
        >
          <div>
            <strong className="break-all">{row.email}</strong>
            <p className="muted-text">
              {row.role} ·{" "}
              {row.active ? "Pending; expires" : "Inactive; expired or revoked"}{" "}
              {shortDate(row.expires_at)}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void manage(row, false)}
            >
              Resend
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void manage(row, true)}
            >
              Revoke
            </Button>
          </div>
        </div>
      ))}
      {!rows.length && !error ? (
        <p className="muted-text">No unaccepted invitations.</p>
      ) : null}
      {url ? (
        <div className="rounded-xl border p-3 space-y-2">
          <p className="break-all">{url}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              navigator.clipboard
                .writeText(url)
                .then(() => toast.success("Private link copied"))
                .catch(() => toast.error("Select the link to copy it"))
            }
          >
            Copy private link
          </Button>
        </div>
      ) : null}
    </section>
  );
}
