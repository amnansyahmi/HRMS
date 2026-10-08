"use client";
import { HireButton, CandidateDetails } from "./hiring-actions";
import { useState } from "react";
import {
  BriefcaseBusiness,
  MapPin,
  Pencil,
  ExternalLink,
  Sparkles,
  Paperclip,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useWorkspace } from "./workspace-context";
import {
  PageHeader,
  Person,
  Status,
  Empty,
  AddButton,
  SearchField,
  NativeSelect,
} from "./common";
export function RecruitmentPage() {
  const { workspace, edit, ask, act } = useWorkspace(),
    [tab, setTab] = useState("jobs"),
    [search, setSearch] = useState(""),
    [stage, setStage] = useState("All"),
    jobs = workspace.records.filter((r) => r.kind === "job"),
    candidates = workspace.records.filter((r) => r.kind === "candidate"),
    filtered = candidates.filter(
      (c) =>
        (stage === "All" || c.data.stage === stage) &&
        `${c.data.name} ${c.data.email}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    );
  return (
    <>
      <PageHeader
        title="Recruitment"
        description="Find the next person who’ll make a difference."
        action={
          <AddButton onClick={() => edit(tab === "jobs" ? "job" : "candidate")}>
            {tab === "jobs" ? "Add job listing" : "Add candidate"}
          </AddButton>
        }
      />
      <Tabs value={tab} onValueChange={setTab}>
        <div className="tabs-with-action">
          <TabsList>
            <TabsTrigger value="jobs">
              Job listings <span className="tab-count">{jobs.length}</span>
            </TabsTrigger>
            <TabsTrigger value="candidates">
              Candidates <span className="tab-count">{candidates.length}</span>
            </TabsTrigger>
          </TabsList>
          <Button variant="outline" size="sm" asChild>
            <a
              href={`/careers/${workspace.company.slug}`}
              target="_blank"
              rel="noreferrer"
            >
              Career portal
              <ExternalLink size={14} />
            </a>
          </Button>
        </div>
        <TabsContent value="jobs">
          <div className="table-toolbar">
            <p className="muted-text">
              Published positions appear on your public career portal.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                ask(
                  "recruit",
                  undefined,
                  "Help me write a clear job description and an interview plan for our open roles.",
                )
              }
            >
              <Sparkles size={14} />
              Recruit assistant
            </Button>
          </div>
          <div className="job-grid">
            {jobs.map((j) => (
              <div className="job-card" key={j.id}>
                <div className="row-between">
                  <BriefcaseBusiness size={21} />
                  <Status value={j.data.status} />
                </div>
                <h3>{String(j.data.title)}</h3>
                <p className="location">
                  <MapPin size={14} />
                  {String(j.data.location)}
                </p>
                <p className="job-excerpt">{String(j.data.description)}</p>
                <div className="row-between">
                  <small>
                    {String(j.data.employmentType)} ·{" "}
                    {candidates.filter((c) => c.data.jobId === j.id).length}{" "}
                    candidates
                  </small>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void act("job-clone", { id: j.id }, "Job template copied")
                    }
                  >
                    Copy template
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${j.data.title}`}
                    onClick={() => edit("job", j)}
                  >
                    <Pencil size={15} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          {!jobs.length ? (
            <Empty
              title="Your next hire starts here"
              description="Add a position and publish it on your career page."
            />
          ) : null}
        </TabsContent>
        <TabsContent value="candidates">
          <div className="pipeline-summary">
            {["Applied", "Screening", "Interview", "Offer", "Hired"].map(
              (s) => (
                <button
                  key={s}
                  onClick={() => setStage(stage === s ? "All" : s)}
                  className={stage === s ? "selected" : ""}
                >
                  <span>{s}</span>
                  <strong>
                    {candidates.filter((c) => c.data.stage === s).length}
                  </strong>
                </button>
              ),
            )}
          </div>
          <div className="table-toolbar">
            <SearchField
              value={search}
              onChange={setSearch}
              placeholder="Search candidates…"
            />
            <NativeSelect
              label="Candidate stage"
              value={stage}
              onChange={setStage}
              options={[
                "All",
                "Applied",
                "Screening",
                "Interview",
                "Offer",
                "Hired",
                "Rejected",
              ].map((v) => ({
                value: v,
                label: v === "All" ? "All stages" : v,
              }))}
            />
          </div>
          {filtered.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Candidate</th>
                    <th>Position</th>
                    <th>Stage</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Person
                          name={String(c.data.name)}
                          detail={String(c.data.email)}
                        />
                      </td>
                      <td>
                        {String(
                          jobs.find((j) => j.id === c.data.jobId)?.data.title ||
                            "Position",
                        )}
                      </td>
                      <td>
                        <Status value={c.data.stage} />
                      </td>
                      <td>
                        <div className="table-actions">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              ask(
                                "resume",
                                c.id,
                                "Score the evidence for each job requirement from 0–5 and explain the gaps. Suggest practical interview questions.",
                              )
                            }
                          >
                            <Sparkles size={14} />
                            Review resume
                          </Button>
                          {c.data.resumeFileId ? (
                            <Button asChild variant="ghost" size="icon">
                              <a
                                aria-label="Download resume"
                                href={`/api/files/${c.data.resumeFileId}`}
                              >
                                <Paperclip size={15} />
                              </a>
                            </Button>
                          ) : null}
                          <CandidateDetails candidate={c} />
                          {["Offer", "Hired"].includes(String(c.data.stage)) ? (
                            <HireButton candidate={c} />
                          ) : null}
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Edit ${c.data.name}`}
                            onClick={() => edit("candidate", c)}
                          >
                            <Pencil size={15} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="No candidates to show"
              description="Applications from your career page will appear here."
            />
          )}
          <div className="info-note">
            AI reviews provide skill evidence and questions for a recruiter to
            assess. Stage changes and hiring decisions are made by your team.
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}
