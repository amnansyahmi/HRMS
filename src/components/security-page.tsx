"use client";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { api } from "@/lib/client";
import { toast } from "sonner";
export function AccountPage({
  purpose,
  token,
}: {
  purpose: "reset" | "verify" | "forgot";
  token?: string;
}) {
  const [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [message, setMessage] = useState("");
  return (
    <div className="auth-page">
      <div className="auth-content">
        <span className="brand-mark">N</span>
        <h1>
          {purpose === "forgot"
            ? "Reset your password"
            : purpose === "reset"
              ? "Choose a new password"
              : "Verify your email"}
        </h1>
        {done ? (
          <p role="status">
            {message || "Your account was updated."}{" "}
            <Link className="inline-link" href="/">
              Return to login
            </Link>
          </p>
        ) : (
          <form
            className="auth-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                const data = Object.fromEntries(new FormData(e.currentTarget));
                const response = await api<{
                  message?: string;
                  deliveryConfigured?: boolean;
                }>(`/api/auth/${purpose}`, { ...data, token });
                setDone(true);
                setMessage(
                  response.deliveryConfigured === false
                    ? "Email delivery needs to be configured by the workspace administrator."
                    : response.message || "Your account was updated.",
                );
              } catch (error) {
                toast.error((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {purpose === "forgot" ? (
              <>
                <Label htmlFor="recovery-email">Email</Label>
                <Input
                  id="recovery-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                />
              </>
            ) : purpose === "reset" ? (
              <>
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  name="password"
                  type="password"
                  minLength={12}
                  required
                  autoComplete="new-password"
                />
                <small>At least 12 characters.</small>
              </>
            ) : (
              <p>Press the button to verify this email address.</p>
            )}
            <Button disabled={busy}>
              {purpose === "forgot"
                ? "Send reset link"
                : purpose === "reset"
                  ? "Save new password"
                  : "Verify email"}
            </Button>
            <Link href="/">Return to login</Link>
          </form>
        )}
      </div>
    </div>
  );
}
export function SecuritySettings() {
  const [status, setStatus] = useState<{
      emailVerified: boolean;
      mfaEnabled: boolean;
      smtpConfigured: boolean;
      mfaConfigured: boolean;
    } | null>(null),
    [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null),
    [code, setCode] = useState(""),
    [password, setPassword] = useState(""),
    [recovery, setRecovery] = useState<string[]>([]),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api<NonNullable<typeof status>>("/api/account")
      .then(setStatus)
      .catch(() => {});
  }, []);
  async function action(name: string) {
    setBusy(true);
    try {
      const result = await api<{
        secret: string;
        qr: string;
        recoveryCodes: string[];
        deliveryConfigured?: boolean;
      }>("/api/auth/" + name, { code, password });
      if (name === "mfa-setup") setSetup(result);
      else if (name === "mfa-enable") {
        setRecovery(result.recoveryCodes);
        setSetup(null);
        setStatus((s) => (s ? { ...s, mfaEnabled: true } : s));
      } else if (name === "mfa-disable") {
        setStatus((s) => (s ? { ...s, mfaEnabled: false } : s));
        setPassword("");
        setCode("");
      } else
        toast.success(
          result.deliveryConfigured === false
            ? "Configure email delivery first"
            : "Verification link queued",
        );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-panel">
      <h2>Account security</h2>
      <p>Email: {status?.emailVerified ? "verified" : "not yet verified"}</p>
      <Button
        variant="outline"
        disabled={busy || !status?.smtpConfigured}
        onClick={() => void action("request-verification")}
      >
        Send verification link
      </Button>
      {!status?.smtpConfigured ? (
        <small>Email delivery requires an SMTP connection.</small>
      ) : null}
      <h3>Authenticator</h3>
      <p>
        {status?.mfaEnabled
          ? "Two-step verification is enabled."
          : "Add a six-digit authenticator code to your real workspace login."}
      </p>
      {setup ? (
        <>
          <Image
            unoptimized
            className="mfa-qr"
            src={setup.qr}
            alt="Authenticator setup QR code"
            width={200}
            height={200}
          />
          <p className="mfa-secret">{setup.secret}</p>
          <Label htmlFor="mfa-setup-code">Authenticator code</Label>
          <Input
            id="mfa-setup-code"
            autoComplete="one-time-code"
            inputMode="numeric"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Button disabled={busy} onClick={() => void action("mfa-enable")}>
            Enable authenticator
          </Button>
        </>
      ) : status?.mfaEnabled ? (
        <>
          <Label htmlFor="mfa-password">Current password</Label>
          <Input
            id="mfa-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Label htmlFor="mfa-disable-code">
            Authenticator or recovery code
          </Label>
          <Input
            id="mfa-disable-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void action("mfa-disable")}
          >
            Disable authenticator
          </Button>
        </>
      ) : (
        <Button
          variant="outline"
          disabled={busy || !status?.mfaConfigured}
          onClick={() => void action("mfa-setup")}
        >
          Set up authenticator
        </Button>
      )}
      {!status?.mfaConfigured ? (
        <small>Server encryption key must be configured first.</small>
      ) : null}
      {recovery.length ? (
        <div className="recovery-codes">
          <h3>Save your recovery codes</h3>
          <p>Each code can be used once. They are only shown now.</p>
          <pre>{recovery.join("\n")}</pre>
          <Button
            variant="outline"
            onClick={() => {
              const a = document.createElement("a");
              a.href = URL.createObjectURL(
                new Blob([recovery.join("\n")], { type: "text/plain" }),
              );
              a.download = "nonymauz-recovery-codes.txt";
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            Download codes
          </Button>
        </div>
      ) : null}
    </section>
  );
}
