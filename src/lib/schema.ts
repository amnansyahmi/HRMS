import { z } from "zod";
import { extendedSchemas, employeeFields } from "./extended-schema";
import {
  defaultEmployeeStatuses,
  defaultSpecialists,
  specialistNames,
} from "./workflow-config";
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
  ...extendedSchemas,
  designation: z.object({ name: text, description: long }),
  payroll_run: z.object({
    title: text,
    cycle: z.enum([
      "Monthly",
      "Weekly",
      "Fortnightly",
      "Off-cycle",
      "Final settlement",
    ]),
    startDate: date,
    endDate: date,
    payDate: date,
    status: z.enum(["Draft", "Published"]),
    finalInMonth: z.boolean().default(false),
    preparedBy: z.uuid(),
    approvedBy: optionalId,
    period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  }),
  employee: z.object({
    ...employeeFields,
    name: text,
    email: z.email().toLowerCase(),
    title: text,
    designationId: optionalId,
    employmentStatus: z.string().trim().max(100).default(""),
    departmentId: optionalId,
    managerId: optionalId,
    startDate: date,
    endDate: date.nullable().default(null),
    employmentType: text.default("Full-time"),
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
      employeeIds: z.array(z.string().uuid()).max(500).default([]),
      departmentIds: z.array(z.uuid()).max(100).default([]),
      locationId: optionalId,
      anchorDate: date.nullable().default(null),
      rotationWeeks: z.coerce.number().int().min(1).max(12).default(1),
      activeWeeks: z
        .array(z.number().int().min(1).max(12))
        .min(1)
        .max(12)
        .default([1]),
      endDate: date.nullable().default(null),
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
      type: text,
      leaveTypeId: optionalId,
      unit: z
        .enum(["Full day", "Morning", "Afternoon", "Hours"])
        .default("Full day"),
      hours: z.coerce.number().min(0.25).max(24).default(1),
      startHour: z.coerce.number().min(0).max(23.75).default(9),
      evidenceId: optionalId,
      approvalStep: z.number().int().min(0).max(2).default(0),
      startDate: date,
      endDate: date,
      reason: long,
      days: z.number().min(0.01).max(366),
      status: z.enum(["Pending", "Approved", "Rejected", "Cancelled"]),
      reviewedBy: optionalId,
      reviewNote: z.string().max(1000).default(""),
    })
    .refine((v) => v.endDate >= v.startDate, "End date must follow start date"),
  claim: z.object({
    category: text,
    claimTypeId: optionalId,
    mileageKm: z.coerce.number().min(0).max(10000).default(0),
    approvalStep: z.number().int().min(0).max(2).default(0),
    date,
    amount: money.refine((v) => v > 0, "Amount must be greater than zero"),
    description: text,
    receiptId: optionalId,
    status: z.enum([
      "Pending",
      "Approved",
      "Rejected",
      "Returned",
      "Cancelled",
      "Paid",
    ]),
    history: z
      .array(
        z.object({
          at: z.iso.datetime(),
          by: z.string().max(200),
          actorId: z.uuid(),
          action: z.string().max(100),
          note: z.string().max(1000),
          snapshot: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .max(200)
      .default([]),
    reviewedBy: optionalId,
    reviewNote: z.string().max(1000).default(""),
  }),
  payroll: z.object({
    runId: optionalId,
    cycle: z
      .enum([
        "Monthly",
        "Weekly",
        "Fortnightly",
        "Off-cycle",
        "Final settlement",
      ])
      .default("Monthly"),
    startDate: date.nullable().default(null),
    endDate: date.nullable().default(null),
    payDate: date.nullable().default(null),
    finalInMonth: z.boolean().default(false),
    preparedBy: optionalId,
    statutoryMode: z
      .enum(["Monthly", "Manual", "Reconciled"])
      .default("Monthly"),
    taxableNormal: money.nullable().default(null),
    taxableAdditional: money.nullable().default(null),
    epfWages: money.nullable().default(null),
    epfNormalWages: money.nullable().default(null),
    socsoWages: money.nullable().default(null),
    unpaidDeduction: money,
    reimbursements: money,
    commission: money,
    zakat: money,
    calculation: z.record(z.string(), z.unknown()).default({}),
    inputRecordIds: z.array(z.uuid()).default([]),
    bankName: z.string().max(100).default(""),
    bankAccount: z.string().max(40).default(""),
    nric: z.string().max(40).default(""),
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
    scope: z.enum(["Individual", "Team", "Company"]).default("Individual"),
    departmentId: optionalId,
    title: text,
    cycleId: optionalId,
    parentId: optionalId,
    perspective: z
      .enum(["Financial", "Customer", "Process", "Learning"])
      .default("Learning"),
    weight: z.coerce.number().positive().max(100).default(1),
    target: z.coerce.number().positive().max(10000000),
    progress: z.coerce.number().min(0).max(10000000).default(0),
    unit: text.default("items"),
    dueDate: date,
    status: z.enum(["In progress", "Completed"]).default("In progress"),
    rating: z.coerce.number().int().min(1).max(5).nullable().default(null),
    feedback: long,
  }),
  job: z.object({
    screeningQuestions: z.array(text).max(10).default([]),
    templateName: z.string().max(100).default(""),
    title: text,
    departmentId: optionalId,
    location: text,
    employmentType: z.enum(["Full-time", "Part-time", "Contract", "Intern"]),
    description: z.string().trim().min(20).max(16000),
    requirements: z.string().trim().min(5).max(8000),
    status: z.enum(["Draft", "Published", "Closed"]).default("Draft"),
  }),
  candidate: z.object({
    screeningAnswers: z
      .array(z.object({ question: text, answer: z.string().max(2000) }))
      .max(10)
      .default([]),
    stageHistory: z
      .array(
        z.object({ stage: z.string(), at: z.iso.datetime(), by: z.string() }),
      )
      .max(100)
      .default([]),
    employeeId: optionalId,
    interviewAt: z.iso.datetime().nullable().default(null),
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
    type: z.enum(["Skills", "Work preferences", "DISC", "DOPE"]),
    instructions: long,
    questions: z.array(question).min(1).max(30),
  }),
  assessment_result: z.object({
    assessmentId: z.string().uuid(),
    candidateId: optionalId,
    employeeId: optionalId,
    profile: z.record(z.string(), z.number()).default({}),
    answers: z.array(z.number().int().min(0).max(5)).max(30),
    score: z.number().min(0).max(100),
    tokenHash: z.string(),
    expiresAt: z.iso.datetime(),
    submittedAt: z.iso.datetime().nullable(),
    assessmentSnapshot: z.object({
      title: text,
      type: z.enum(["Skills", "Work preferences", "DISC", "DOPE"]),
      instructions: long,
      questions: z.array(question).min(1).max(30),
    }),
  }),
  meeting: z.object({
    calendarUID: z.string().max(500).default(""),
    calendarStartsAt: z.iso.datetime().nullable().default(null),
    calendarEndsAt: z.iso.datetime().nullable().default(null),
    createdBy: optionalId,
    sharedEmployeeIds: z.array(z.uuid()).max(500).default([]),
    linkedEmployeeId: optionalId,
    audioIds: z.array(z.uuid()).max(500).default([]),
    audioTracks: z
      .array(
        z.object({
          id: z.uuid(),
          parts: z.array(z.uuid()).max(50),
          duration: z.number().positive().max(10800),
          mime: z.string().max(100),
          filename: z.string().max(160),
        }),
      )
      .max(10)
      .default([]),
    flags: z
      .array(z.object({ seconds: z.number().min(0), label: text }))
      .max(100)
      .default([]),
    segments: z
      .array(
        z.object({
          start: z.number().min(0),
          end: z.number().min(0),
          speaker: z.string().max(100).default("Speaker"),
          text: z.string().max(24000),
        }),
      )
      .max(10000)
      .default([]),
    attendees: z.string().max(1000).default(""),
    title: text,
    date,
    transcript: z.string().trim().max(300000),
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
  overtimeRates: z
    .object({
      Normal: z.number().min(1).max(10),
      "Rest day": z.number().min(1).max(10),
      "Public holiday": z.number().min(1).max(10),
    })
    .default({ Normal: 1.5, "Rest day": 2, "Public holiday": 3 }),
  employeeStatuses: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(100),
        access: z.enum(["Active", "Onboarding", "Archived"]),
      }),
    )
    .min(3)
    .max(30)
    .refine(
      (v) => new Set(v.map((s) => s.name.toLowerCase())).size === v.length,
      "Status names must be unique",
    )
    .default(defaultEmployeeStatuses),
  employeeTypes: z
    .array(text)
    .min(1)
    .max(30)
    .refine(
      (v) => new Set(v.map((s) => s.toLowerCase())).size === v.length,
      "Employee types must be unique",
    )
    .default(["Full-time", "Part-time", "Contract", "Intern"]),
  clockReminderMinutes: z.number().int().min(0).max(120).default(15),
  aiSpecialists: z
    .record(
      z.enum(specialistNames),
      z.object({
        enabled: z.boolean(),
        tools: z
          .array(
            z.enum([
              "read",
              "review",
              "create-leave",
              "create-claim",
              "candidate-stage",
              "letter-draft",
              "clock",
              "configure",
            ]),
          )
          .max(8),
      }),
    )
    .default(defaultSpecialists),
  aiEnabled: z.boolean(),
  aiActionsEnabled: z.boolean().default(false),
  aiAgents: z
    .object({
      hr: z.boolean(),
      recruit: z.boolean(),
      resume: z.boolean(),
      meeting: z.boolean(),
      preferences: z.boolean(),
    })
    .default({
      hr: true,
      recruit: true,
      resume: true,
      meeting: true,
      preferences: true,
    }),
  careersIntro: z.string().max(3000),
  registrationNo: z.string().max(60),
  taxNo: z.string().max(60),
});
export const roles = z.enum(["owner", "hr", "manager", "employee"]);
