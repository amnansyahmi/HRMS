"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, ArrowRight, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { api } from "@/lib/client";
import { toast } from "sonner";
import { Empty, Loading } from "./common";
type Job = {
  id: string;
  data: {
    title: string;
    description: string;
    requirements: string;
    location: string;
    employmentType: string;
    screeningQuestions?: string[];
  };
};
function PublicFrame({
  name,
  children,
}: {
  name?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="public-page">
      <header className="public-topbar">
        <div>
          <span className="brand-mark">N</span>
          <span>{name || "Nonymauz People"}</span>
        </div>
        <Link href="/">Team sign in</Link>
      </header>
      {children}
      <footer className="public-footer">Powered by Nonymauz People</footer>
    </div>
  );
}
export function CareersPage({ slug }: { slug: string }) {
  const [data, setData] = useState<{
      company: { name: string; intro: string };
      jobs: Job[];
    } | null>(null),
    [error, setError] = useState(""),
    [job, setJob] = useState<Job | null>(null),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [submitted, setSubmitted] = useState(false),
    [file, setFile] = useState<File | undefined>();
  useEffect(() => {
    api<{ company: { name: string; intro: string }; jobs: Job[] }>(
      `/api/careers/${slug}`,
    )
      .then(setData)
      .catch((e) => setError(e.message));
  }, [slug]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!job) return;
    setBusy(true);
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const form = new FormData();
      form.set(
        "data",
        JSON.stringify({
          ...fields,
          jobId: job.id,
          consent,
          screeningAnswers: (
            (job.data.screeningQuestions as string[]) || []
          ).map((question, i) => ({
            question,
            answer: String(fields[`screening-${i}`] || ""),
          })),
        }),
      );
      if (file) form.set("file", file);
      await api(`/api/careers/${slug}`, form);
      setSubmitted(true);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (error)
    return (
      <PublicFrame>
        <Empty title="Career page unavailable" description={error} />
      </PublicFrame>
    );
  if (!data) return <Loading />;
  return (
    <PublicFrame name={data.company.name}>
      <main className="career-main">
        <span className="eyebrow">
          CAREERS AT {data.company.name.toUpperCase()}
        </span>
        <h1>
          Good work starts
          <br />
          with good people.
        </h1>
        <p className="career-intro">{data.company.intro}</p>
        {data.jobs.length ? (
          data.jobs.map((j) => (
            <article className="career-job" key={j.id}>
              <div className="row-between">
                <div>
                  <h2>{j.data.title}</h2>
                  <p>
                    <span>{j.data.location}</span>
                    <span>{j.data.employmentType}</span>
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => {
                    setJob(j);
                    setSubmitted(false);
                    setConsent(false);
                    setFile(undefined);
                  }}
                >
                  Apply
                  <ArrowRight size={14} />
                </Button>
              </div>
              <details>
                <summary>About the role</summary>
                <p>{j.data.description}</p>
                <h3>What we’re looking for</h3>
                <p>{j.data.requirements}</p>
              </details>
            </article>
          ))
        ) : (
          <Empty
            title="No open roles right now"
            description="Check back for future opportunities."
          />
        )}
      </main>
      <Dialog
        open={!!job}
        onOpenChange={(open) => !open && !busy && setJob(null)}
      >
        <DialogContent className="record-dialog sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>
              {submitted
                ? "Application received"
                : `Apply for ${job?.data.title}`}
            </DialogTitle>
            <DialogDescription>
              {submitted
                ? "Your application has been sent to the company’s HR workspace."
                : "Tell us about yourself and the work you’ve done."}
            </DialogDescription>
          </DialogHeader>
          {submitted ? (
            <div className="success-panel">
              <CheckCircle2 size={33} />
              <h2>Thank you for applying.</h2>
              <p>
                The team will review your application and contact you if they
                would like to proceed.
              </p>
              <Button
                variant="outline"
                onClick={() => setJob(null)}
                className="mt-6"
              >
                Close
              </Button>
            </div>
          ) : (
            <form onSubmit={submit}>
              <div className="record-form-grid">
                <div className="form-field full">
                  <Label htmlFor="apply-name">Full name</Label>
                  <Input
                    id="apply-name"
                    name="name"
                    required
                    maxLength={200}
                    autoComplete="name"
                  />
                </div>
                <div className="form-field">
                  <Label htmlFor="apply-email">Email</Label>
                  <Input
                    id="apply-email"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                  />
                </div>
                <div className="form-field">
                  <Label htmlFor="apply-phone">Phone (optional)</Label>
                  <Input id="apply-phone" name="phone" autoComplete="tel" />
                </div>
                <div className="form-field full">
                  <Label>Resume file (optional)</Label>
                  <label className="upload-field">
                    <Upload size={17} />
                    <span>
                      {file ? file.name : "Choose PDF, DOCX or TXT"}
                      <small>Max 2 MB. Use a PDF with selectable text.</small>
                    </span>
                    <input
                      type="file"
                      accept=".pdf,.docx,.txt"
                      onChange={(e) => setFile(e.target.files?.[0])}
                    />
                  </label>
                </div>
                <div className="form-field full">
                  {((job?.data.screeningQuestions as string[]) || []).map(
                    (question, i) => (
                      <div key={i}>
                        <Label htmlFor={`screening-${i}`}>{question}</Label>
                        <Textarea
                          id={`screening-${i}`}
                          name={`screening-${i}`}
                          required
                          maxLength={2000}
                        />
                      </div>
                    ),
                  )}
                  <Label htmlFor="apply-resume">Experience / resume text</Label>
                  <Textarea
                    id="apply-resume"
                    name="resume"
                    rows={6}
                    maxLength={24000}
                    required={!file}
                    placeholder="Paste your experience, relevant skills and portfolio links. A resume file can supply this text instead."
                  />
                </div>
                <div className="form-field full">
                  <label className="check-label">
                    <Checkbox
                      checked={consent}
                      onCheckedChange={(v) => setConsent(v === true)}
                    />
                    <span>
                      I agree that {data.company.name} may store and review this
                      application for recruitment, including using its
                      configured AI service for a job-related resume review.
                    </span>
                  </label>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  type="button"
                  disabled={busy}
                  onClick={() => setJob(null)}
                >
                  Cancel
                </Button>
                <Button disabled={busy || !consent} type="submit">
                  {busy ? <Loader2 className="animate-spin" /> : null}Submit
                  application
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </PublicFrame>
  );
}
export function InvitationPage({ token }: { token: string }) {
  const router = useRouter();
  const [invite, setInvite] = useState<{
      email: string;
      role: string;
      company: string;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ email: string; role: string; company: string }>(
      `/api/invitations/${token}`,
    )
      .then(setInvite)
      .catch((e) => setError(e.message));
  }, [token]);
  async function accept(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      await api("/api/auth/accept", {
        ...Object.fromEntries(new FormData(event.currentTarget)),
        token,
      });
      router.push("/");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <PublicFrame name={invite?.company}>
      <main className="public-form">
        {error ? (
          <Empty title="This invitation is unavailable" description={error} />
        ) : invite ? (
          <>
            <h1>Join {invite.company}.</h1>
            <p>
              You’ve been invited as {invite.role} using{" "}
              <strong>{invite.email}</strong>. If you already have an account,
              enter your existing password.
            </p>
            <form onSubmit={accept}>
              <div className="form-field">
                <Label htmlFor="invite-name">Your name</Label>
                <Input
                  id="invite-name"
                  name="name"
                  required
                  minLength={2}
                  autoComplete="name"
                />
              </div>
              <div className="form-field">
                <Label htmlFor="invite-password">Password</Label>
                <Input
                  id="invite-password"
                  type="password"
                  name="password"
                  required
                  minLength={12}
                  autoComplete="new-password"
                />
                <small>New accounts require at least 12 characters.</small>
              </div>
              <Button disabled={busy} type="submit">
                {busy ? <Loader2 className="animate-spin" /> : null}Join
                workspace
                <ArrowRight size={15} />
              </Button>
            </form>
          </>
        ) : (
          <Loading />
        )}
      </main>
    </PublicFrame>
  );
}
export function AssessmentPage({ token }: { token: string }) {
  const [assessment, setAssessment] = useState<{
      title: string;
      type: string;
      instructions: string;
      questions: { prompt: string; options: string[] }[];
    } | null>(null),
    [answers, setAnswers] = useState<number[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<{ score?: number } | null>(null);
  useEffect(() => {
    api<typeof assessment>(`/api/assessments/${token}`)
      .then(setAssessment)
      .catch((e) => setError(e.message));
  }, [token]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      setResult(await api(`/api/assessments/${token}`, { answers }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <PublicFrame>
      <main className="public-form">
        {error ? (
          <Empty title="This assessment is unavailable" description={error} />
        ) : result ? (
          <div className="success-panel">
            <CheckCircle2 size={33} />
            <h2>Answers submitted.</h2>
            <p>
              {result.score !== undefined
                ? `Your skills score is ${result.score}%.`
                : "Thank you for sharing your work preferences."}{" "}
              The hiring team can now review your responses.
            </p>
          </div>
        ) : assessment ? (
          <>
            <span className="eyebrow">{assessment.type}</span>
            <h1>{assessment.title}</h1>
            <p>{assessment.instructions}</p>
            <form onSubmit={submit}>
              {assessment.questions.map((q, i) => (
                <fieldset key={i} className="assessment-question">
                  <legend className="sr-only">Question {i + 1}</legend>
                  <h3>
                    {i + 1}. {q.prompt}
                  </h3>
                  {q.options.map((option, j) => (
                    <label key={j}>
                      <input
                        type="radio"
                        name={`question-${i}`}
                        required
                        checked={answers[i] === j}
                        onChange={() =>
                          setAnswers((a) => {
                            const next = [...a];
                            next[i] = j;
                            return next;
                          })
                        }
                      />
                      {option}
                    </label>
                  ))}
                </fieldset>
              ))}
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : null}Submit
                answers
              </Button>
            </form>
          </>
        ) : (
          <Loading />
        )}
      </main>
    </PublicFrame>
  );
}
