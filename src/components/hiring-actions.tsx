"use client";
import { useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { useWorkspace } from "./workspace-context";
import type { HRRecord } from "@/lib/types";
export function HireButton({ candidate }: { candidate: HRRecord }) {
  const { act, workspace } = useWorkspace(),
    [open, setOpen] = useState(false),
    [date, setDate] = useState(""),
    [salary, setSalary] = useState(0),
    [employmentType, setEmploymentType] = useState(
      workspace.company.settings.employeeTypes[0],
    );
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={!!candidate.data.employeeId}
        onClick={() => setOpen(true)}
      >
        {candidate.data.employeeId ? "Employee created" : "Hire & onboard"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hire {String(candidate.data.name)}</DialogTitle>
            <DialogDescription>
              Create their employee profile and onboarding checklist. Their CV
              and assessments follow the record.
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor="hire-start">Start date</Label>
          <Input
            type="date"
            id="hire-start"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <Label htmlFor="hire-type">Employment type</Label>
          <select
            id="hire-type"
            className="native-select"
            value={employmentType}
            onChange={(e) => setEmploymentType(e.target.value)}
          >
            {workspace.company.settings.employeeTypes.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
          <Label htmlFor="hire-salary">Monthly base salary (RM)</Label>
          <Input
            type="number"
            id="hire-salary"
            min={0}
            value={salary}
            onChange={(e) => setSalary(Number(e.target.value))}
          />
          <Button
            disabled={!date}
            onClick={async () => {
              const result = await act(
                "candidate-hire",
                {
                  id: candidate.id,
                  data: { startDate: date, salary, employmentType },
                },
                "Employee profile created",
              );
              if (result) setOpen(false);
            }}
          >
            Create employee & checklist
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
export function CandidateDetails({ candidate: c }: { candidate: HRRecord }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Details
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="record-dialog">
          <DialogHeader>
            <DialogTitle>{String(c.data.name)}</DialogTitle>
            <DialogDescription>
              Screening responses and recruitment history.
            </DialogDescription>
          </DialogHeader>
          {(
            (c.data.screeningAnswers as {
              question: string;
              answer: string;
            }[]) || []
          ).map((a, i) => (
            <div key={i}>
              <strong>{a.question}</strong>
              <p>{a.answer}</p>
            </div>
          ))}
          <h3>Stage history</h3>
          {(
            (c.data.stageHistory as {
              stage: string;
              at: string;
              by: string;
            }[]) || []
          ).map((h, i) => (
            <p key={i}>
              {h.stage} · {new Date(h.at).toLocaleString()} · {h.by}
            </p>
          ))}
          {c.data.interviewAt ? (
            <p>
              Interview: {new Date(String(c.data.interviewAt)).toLocaleString()}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
