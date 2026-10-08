import { z } from "zod";
import type { Kind } from "./types";
const text = z.string().trim().min(1).max(200);
const long = z.string().trim().max(24000).default("");
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Enter a valid date",
  );
const money = z.coerce.number().finite().min(0).max(10000000).default(0);
const optionalId = z.string().uuid().nullable().default(null);
const question = z
  .object({
    prompt: text,
    options: z.array(text).min(2).max(6),
    correctIndex: z.number().int().min(0).max(5),
  })
  .refine(
    (v) => v.correctIndex < v.options.length,
    "Correct answer must match an option",
  );
export const schemas = {
  employee: z.object({
    name: text,
    email: z.email().toLowerCase(),
    title: text,
    departmentId: optionalId,
    managerId: optionalId,
    startDate: date,
    endDate: date.nullable().default(null),
    employmentType: z
      .enum(["Full-time", "Part-time", "Contract", "Intern"])
      .default("Full-time"),
    status: z.enum(["Active", "Onboarding", "Archived"]).default("Active"),
    salary: money,
    annualLeave: z.coerce.number().int().min(0).max(365).default(14),
    sickLeave: z.coerce.number().int().min(0).max(365).default(14),
    phone: z.string().max(40).default(""),
  }),
  department: z.object({ name: text, description: long }),
  shift: z
    .object({
      name: text,
      start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
      employeeIds: z.array(z.string().uuid()).max(500),
      graceMinutes: z.coerce.number().int().min(0).max(120).default(5),
    })
    .refine((v) => v.start !== v.end, "Shift start and end must differ"),
  attendance: z.object({
    workDate: date,
    clockIn: z.iso.datetime(),
    clockOut: z.iso.datetime().nullable(),
    shiftId: optionalId,
    lateMinutes: z.number().int().min(0),
    location: z.enum(["Office", "Remote", "Client site"]),
  }),
  leave: z
    .object({
      type: z.enum(["Annual", "Sick", "Unpaid", "Other"]),
      startDate: date,
      endDate: date,
      reason: long,
      days: z.number().int().min(1).max(366),
      status: z.enum(["Pending", "Approved", "Rejected", "Cancelled"]),
      reviewedBy: optionalId,
      reviewNote: z.string().max(1000).default(""),
    })
    .refine((v) => v.endDate >= v.startDate, "End date must follow start date"),
  claim: z.object({
    category: z.enum(["Travel", "Meals", "Medical", "Equipment", "Other"]),
    date,
    amount: money.refine((v) => v > 0, "Amount must be greater than zero"),
    description: text,
    receiptId: optionalId,
    status: z.enum(["Pending", "Approved", "Rejected", "Cancelled", "Paid"]),
    reviewedBy: optionalId,
    reviewNote: z.string().max(1000).default(""),
  }),
  payroll: z.object({
    period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    base: money,
    allowance: money,
    overtime: money,
    bonus: money,
    epfEmployee: money,
    socsoEmployee: money,
    eisEmployee: money,
    pcb: money,
    otherDeduction: money,
    epfEmployer: money,
    socsoEmployer: money,
    eisEmployer: money,
    gross: money,
    net: money,
    status: z.enum(["Draft", "Published"]),
    employeeName: text,
    employeeTitle: text,
    reviewed: z.boolean().default(false),
    note: long,
  }),
  goal: z.object({
    title: text,
    target: z.coerce.number().positive().max(10000000),
    progress: z.coerce.number().min(0).max(10000000).default(0),
    unit: text.default("items"),
    dueDate: date,
    status: z.enum(["In progress", "Completed"]).default("In progress"),
    rating: z.coerce.number().int().min(1).max(5).nullable().default(null),
    feedback: long,
  }),
  job: z.object({
    title: text,
    departmentId: optionalId,
    location: text,
    employmentType: z.enum(["Full-time", "Part-time", "Contract", "Intern"]),
    description: z.string().trim().min(20).max(16000),
    requirements: z.string().trim().min(5).max(8000),
    status: z.enum(["Draft", "Published", "Closed"]).default("Draft"),
  }),
  candidate: z.object({
    name: text,
    email: z.email().toLowerCase(),
    phone: z.string().max(40).default(""),
    jobId: z.string().uuid(),
    resume: z.string().trim().max(24000).default(""),
    resumeFileId: optionalId,
    stage: z
      .enum(["Applied", "Screening", "Interview", "Offer", "Hired", "Rejected"])
      .default("Applied"),
    notes: long,
    consent: z.boolean().refine(Boolean, "Consent is required"),
  }),
  assessment: z.object({
    title: text,
    type: z.enum(["Skills", "Work preferences"]),
    instructions: long,
    questions: z.array(question).min(1).max(30),
  }),
  assessment_result: z.object({
    assessmentId: z.string().uuid(),
    candidateId: z.string().uuid(),
    answers: z.array(z.number().int().min(0).max(5)).max(30),
    score: z.number().min(0).max(100),
    tokenHash: z.string(),
    expiresAt: z.iso.datetime(),
    submittedAt: z.iso.datetime().nullable(),
    assessmentSnapshot: z.object({
      title: text,
      type: z.enum(["Skills", "Work preferences"]),
      instructions: long,
      questions: z.array(question).min(1).max(30),
    }),
  }),
  meeting: z.object({
    title: text,
    date,
    transcript: z.string().trim().max(24000),
    summary: long,
    actions: z
      .array(
        z.object({
          task: text,
          owner: z.string().max(100).default(""),
          dueDate: date.nullable().default(null),
          done: z.boolean().default(false),
        }),
      )
      .max(50)
      .default([]),
    fileId: optionalId,
  }),
  policy: z.object({
    title: text,
    body: z.string().trim().min(1).max(24000),
    category: z
      .enum(["Leave", "Claims", "Conduct", "Benefits", "General"])
      .default("General"),
  }),
} satisfies Record<Kind, z.ZodType>;
export const companySettings = z.object({
  timezone: z.string().refine((v) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }),
  workDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  holidays: z.array(date).max(366),
  aiEnabled: z.boolean(),
  careersIntro: z.string().max(3000),
  registrationNo: z.string().max(60),
  taxNo: z.string().max(60),
});
export const roles = z.enum(["owner", "hr", "manager", "employee"]);
