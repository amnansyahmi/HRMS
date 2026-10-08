"use client";
import { useState } from "react";
import { ArrowRight, Loader2, Users, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/client";
import { toast } from "sonner";
export function AuthScreen({
  demo,
  onSuccess,
}: {
  demo: boolean;
  onSuccess: () => Promise<void>;
}) {
  const [signup, setSignup] = useState(false),
    [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api(`/api/auth/${signup ? "signup" : "login"}`, data);
      await onSuccess();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function enterDemo() {
    setBusy(true);
    try {
      await api("/api/auth/demo", { role: "owner" });
      await onSuccess();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <div className="auth-brand">
        <span className="brand-mark">N</span>
        <span>
          Nonymauz <strong>People</strong>
        </span>
      </div>
      <div className="auth-content">
        <div className="auth-symbol">
          <Users size={27} />
        </div>
        <h1>{signup ? "A better place for your people." : "Welcome back."}</h1>
        <p>
          {signup
            ? "Create your company workspace. Bring the team together."
            : "Your people, everyday work and hiring. All in one place."}
        </p>
        <form onSubmit={submit} className="auth-form">
          {signup ? (
            <>
              <div>
                <Label htmlFor="name">Your name</Label>
                <Input id="name" name="name" autoComplete="name" required />
              </div>
              <div>
                <Label htmlFor="company">Company name</Label>
                <Input id="company" name="company" required />
              </div>
            </>
          ) : null}
          <div>
            <Label htmlFor="email">Work email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
            />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              minLength={signup ? 12 : 1}
              autoComplete={signup ? "new-password" : "current-password"}
              required
            />
            {signup ? <small>At least 12 characters.</small> : null}
          </div>
          <Button disabled={busy} type="submit" className="w-full">
            {busy ? <Loader2 className="animate-spin" /> : null}
            {signup ? "Create workspace" : "Sign in"}
            <ArrowRight size={16} />
          </Button>
        </form>
        <button className="auth-switch" onClick={() => setSignup((v) => !v)}>
          {signup
            ? "Already have an account? Sign in"
            : "New here? Create a workspace"}
        </button>
        {demo ? (
          <div className="demo-entry">
            <span>Take a look around</span>
            <Button
              variant="outline"
              className="w-full"
              disabled={busy}
              onClick={enterDemo}
            >
              Explore the demo workspace
            </Button>
            <small>Sample records only. No real employee data.</small>
          </div>
        ) : null}
        <div className="auth-foot">
          <ShieldCheck size={14} />
          Company access is controlled by your workspace owner.
        </div>
      </div>
      <footer>Built for people. Powered by ai-nonymauz-cloud.</footer>
    </div>
  );
}
