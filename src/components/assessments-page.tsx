"use client";
import { useState } from "react";
import {
  ClipboardCheck,
  Pencil,
  Link2,
  Sparkles,
  Copy,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useWorkspace } from "./workspace-context";
import { PageHeader, Status, Empty, AddButton, NativeSelect } from "./common";
import type { HRRecord } from "@/lib/types";
import { shortDate } from "@/lib/client";
import { toast } from "sonner";
export function AssessmentsPage() {
  const { workspace, edit, act, ask } = useWorkspace(),
    [selected, setSelected] = useState<HRRecord | null>(null),
    [candidateId, setCandidateId] = useState(""),
    [link, setLink] = useState(""),
    [busy, setBusy] = useState(false),
    assessments = workspace.records.filter((r) => r.kind === "assessment"),
    results = workspace.records.filter((r) => r.kind === "assessment_result"),
    candidates = workspace.records.filter((r) => r.kind === "candidate");
  async function assign() {
    if (!selected) return;
    setBusy(true);
    try {
      const result = (await act("assessment-invite", {
        assessmentId: selected.id,
        candidateId,
      })) as { url: string } | undefined;
      if (result) setLink(result.url);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        title="Skills & work preferences"
        description="Learn how candidates solve problems and prefer to work."
        action={
          <AddButton onClick={() => edit("assessment")}>
            Add assessment
          </AddButton>
        }
      />
      <Tabs defaultValue="assessments">
        <TabsList>
          <TabsTrigger value="assessments">Assessments</TabsTrigger>
          <TabsTrigger value="results">Invitations & results</TabsTrigger>
        </TabsList>
        <TabsContent value="assessments">
          <div className="record-cards">
            {assessments.map((a) => (
              <div className="record-card" key={a.id}>
                <div className="row-between">
                  <ClipboardCheck size={22} />
                  <Status value={a.data.type} />
                </div>
                <h3>{String(a.data.title)}</h3>
                <p>{String(a.data.instructions)}</p>
                <small>
                  {(a.data.questions as unknown[]).length} questions
                </small>
                <div className="card-actions">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setSelected(a);
                      setLink("");
                      setCandidateId("");
                    }}
                  >
                    <Link2 size={14} />
                    Assign
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Edit ${a.data.title}`}
                    onClick={() => edit("assessment", a)}
                  >
                    <Pencil size={15} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          {!assessments.length ? (
            <Empty
              title="Get to know your candidates"
              description="Create a skills quiz or a self-reported work preference questionnaire."
            />
          ) : null}
        </TabsContent>
        <TabsContent value="results">
          {results.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Candidate</th>
                    <th>Assessment</th>
                    <th>Status</th>
                    <th>Result</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => {
                    const a = r.data.assessmentSnapshot as {
                      title: string;
                      type: string;
                    };
                    return (
                      <tr key={r.id}>
                        <td>
                          {String(
                            candidates.find((c) => c.id === r.data.candidateId)
                              ?.data.name || "Candidate",
                          )}
                        </td>
                        <td>
                          <strong>{a.title}</strong>
                          <small className="cell-detail">{a.type}</small>
                        </td>
                        <td>
                          <Status
                            value={
                              r.data.submittedAt
                                ? "Completed"
                                : Date.parse(String(r.data.expiresAt)) <
                                    new Date().getTime()
                                  ? "Expired"
                                  : "Invited"
                            }
                          />
                          <small className="cell-detail">
                            Expires {shortDate(r.data.expiresAt)}
                          </small>
                        </td>
                        <td>
                          {r.data.submittedAt
                            ? a.type === "Skills"
                              ? `${r.data.score}%`
                              : "Self-reported answers"
                            : "—"}
                        </td>
                        <td>
                          {r.data.submittedAt &&
                          a.type === "Work preferences" ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                ask(
                                  "preferences",
                                  r.id,
                                  "Summarize these self-reported work preferences and suggest discussion questions.",
                                )
                              }
                            >
                              <Sparkles size={14} />
                              Summarize
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="No assessment results yet"
              description="Assign an assessment and share its private link with a candidate."
            />
          )}
        </TabsContent>
      </Tabs>
      <div className="info-note">
        Work preference questionnaires have no correct answers and are not
        validated personality tests. AI summarises the candidate’s own answers
        for a conversation with your team.
      </div>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Assign {String(selected?.data.title || "assessment")}
            </DialogTitle>
            <DialogDescription>
              Generate a private link that expires in 7 days and can be
              submitted once.
            </DialogDescription>
          </DialogHeader>
          {link ? (
            <div className="share-link">
              <p>Share this link with the candidate.</p>
              <code>{link}</code>
              <Button
                variant="outline"
                onClick={() =>
                  navigator.clipboard
                    .writeText(link)
                    .then(() => toast.success("Link copied"))
                    .catch(() => toast.error("Copy the link above manually"))
                }
              >
                <Copy size={14} />
                Copy link
              </Button>
            </div>
          ) : (
            <NativeSelect
              label="Candidate"
              value={candidateId}
              onChange={setCandidateId}
              options={[
                { value: "", label: "Choose candidate" },
                ...candidates.map((c) => ({
                  value: c.id,
                  label: String(c.data.name),
                })),
              ]}
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>
              Close
            </Button>
            {!link ? (
              <Button disabled={busy || !candidateId} onClick={assign}>
                {busy ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Link2 size={14} />
                )}
                Create link
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
