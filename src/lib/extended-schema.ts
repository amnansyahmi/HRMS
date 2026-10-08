import { z } from "zod";
const text = z.string().trim().min(1).max(200),
  long = z.string().trim().max(24000).default(""),
  id = z.uuid(),
  nullableId = id.nullable().default(null),
  money = z.coerce.number().finite().min(0).max(10000000).default(0);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    "Invalid date",
  );
const status = z
  .enum(["Pending", "Approved", "Rejected", "Cancelled"])
  .default("Pending");
const review = {
  status,
  reviewedBy: nullableId,
  reviewNote: z.string().max(1000).default(""),
  reviewedAt: z.iso.datetime().nullable().default(null),
  approvalStep: z.number().int().min(0).max(2).default(0),
};
export const extendedSchemas = {
  document: z.object({
    title: text,
    type: z
      .enum([
        "Contract",
        "Identity",
        "Passport",
        "Permit",
        "Certificate",
        "Other",
      ])
      .default("Other"),
    fileId: nullableId,
    issueDate: date,
    expiryDate: date.nullable().default(null),
    notes: long,
  }),
  asset: z.object({
    name: text,
    serial: text,
    issuedDate: date,
    returnedDate: date.nullable().default(null),
    condition: z.enum(["Good", "Needs repair", "Returned"]).default("Good"),
    notes: long,
  }),
  job_history: z.object({
    title: text,
    effectiveDate: date,
    previousTitle: z.string().max(200).default(""),
    previousSalary: money,
    newSalary: money,
    departmentId: nullableId,
    notes: long,
  }),
  lifecycle: z.object({
    title: text,
    type: z.enum(["Onboarding", "Offboarding"]),
    dueDate: date,
    items: z
      .array(
        z.object({
          task: text,
          done: z.boolean().default(false),
          owner: z.string().max(100).default(""),
        }),
      )
      .max(50)
      .default([]),
    status: z.enum(["In progress", "Completed"]).default("In progress"),
  }),
  letter: z.object({
    title: text,
    type: z.enum([
      "Offer",
      "Confirmation",
      "Warning",
      "Termination",
      "Reference",
      "Other",
    ]),
    effectiveDate: date,
    body: z.string().min(10).max(24000),
    status: z.enum(["Draft", "Issued"]).default("Draft"),
  }),
  announcement: z.object({
    title: text,
    body: z.string().min(1).max(16000),
    departmentId: nullableId,
    published: z.boolean().default(true),
    expiresOn: date.nullable().default(null),
  }),
  location: z
    .object({
      name: text,
      state: z.string().max(100).default(""),
      address: z.string().max(1000).default(""),
      latitude: z.coerce.number().min(-90).max(90).nullable().default(null),
      longitude: z.coerce.number().min(-180).max(180).nullable().default(null),
      radius: z.coerce.number().min(50).max(20000).default(200),
      geofence: z.boolean().default(false),
    })
    .refine(
      (v) => !v.geofence || (v.latitude !== null && v.longitude !== null),
      "Enter coordinates for a geofence",
    ),
  holiday: z.object({
    title: text,
    date,
    state: z.string().max(100).default("National"),
  }),
  overtime: z.object({
    date,
    hours: z.coerce.number().positive().max(24),
    type: z.enum(["Normal", "Rest day", "Public holiday"]),
    reason: text,
    ...review,
  }),
  time_off: z
    .object({
      date,
      start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      reason: text,
      ...review,
    })
    .refine((v) => v.end > v.start, "End must follow start"),
  attendance_correction: z
    .object({
      attendanceId: nullableId,
      workDate: date,
      clockIn: z.iso.datetime(),
      clockOut: z.iso.datetime(),
      reason: text,
      ...review,
    })
    .refine(
      (v) =>
        v.clockOut > v.clockIn &&
        Date.parse(v.clockOut) - Date.parse(v.clockIn) <= 24 * 3600000,
      "Enter a valid shift no longer than 24 hours",
    ),
  lateness: z.object({ attendanceId: id, reason: text, ...review }),
  leave_type: z.object({
    name: text,
    paid: z.boolean().default(true),
    annualDays: z.coerce.number().min(0).max(366),
    accrual: z.enum(["Annual", "Monthly"]).default("Annual"),
    carryDays: z.coerce.number().min(0).max(366).default(0),
    carryExpiryMonth: z.coerce.number().int().min(1).max(12).default(3),
    receiptRequired: z.boolean().default(false),
    approval: z
      .enum(["Manager or HR", "Manager then HR", "HR only"])
      .default("Manager or HR"),
    departmentId: nullableId,
  }),
  claim_type: z.object({
    name: text,
    limit: money,
    period: z.enum(["Annual", "Monthly", "Per request"]),
    departmentId: nullableId,
    receiptRequired: z.boolean().default(true),
    mileageRate: money,
    approval: z
      .enum(["Manager or HR", "Manager then HR", "HR only"])
      .default("Manager or HR"),
  }),
  review_cycle: z
    .object({
      title: text,
      startDate: date,
      endDate: date,
      status: z.enum(["Open", "Closed"]).default("Open"),
    })
    .refine((v) => v.endDate >= v.startDate, "End must follow start"),
  evaluation_template: z.object({
    title: text,
    criteria: z
      .array(
        z.object({
          title: text,
          weight: z.coerce.number().positive().max(100),
        }),
      )
      .min(1)
      .max(20),
  }),
  evaluation: z.object({
    cycleId: id,
    templateId: id,
    selfComments: long,
    feedback: long,
    ratings: z.array(z.number().min(1).max(5)).max(20).default([]),
    status: z.enum(["Draft", "Submitted", "Final"]).default("Draft"),
    score: z.number().min(0).max(5).default(0),
    templateSnapshot: z.record(z.string(), z.unknown()).default({}),
  }),
  goal_update: z.object({
    goalId: id,
    progress: z.coerce.number().min(0).max(10000000),
    note: long,
    ...review,
  }),
  payment_voucher: z.object({
    title: text,
    reference: text,
    period: z.string().max(30),
    recordIds: z.array(id).min(1).max(5000),
    amount: money,
    status: z.enum(["Prepared", "Paid"]).default("Prepared"),
    paidAt: z.iso.datetime().nullable().default(null),
    bankReference: z.string().max(200).default(""),
  }),
};
export const employeeFields = {
  staffNo: z.string().max(60).default(""),
  nric: z.string().max(40).default(""),
  birthDate: date.nullable().default(null),
  nationality: z
    .enum(["Malaysian", "Permanent resident", "Foreign"])
    .default("Malaysian"),
  state: z.string().max(100).default(""),
  race: z.string().max(100).default(""),
  religion: z.string().max(100).default(""),
  address: z.string().max(1000).default(""),
  epfNo: z.string().max(40).default(""),
  socsoNo: z.string().max(40).default(""),
  taxNo: z.string().max(40).default(""),
  bankName: z.string().max(100).default(""),
  bankAccount: z.string().max(40).default(""),
  probationEnd: date.nullable().default(null),
  confirmationDate: date.nullable().default(null),
  emergencyName: z.string().max(100).default(""),
  emergencyPhone: z.string().max(40).default(""),
  dependants: z
    .array(
      z.object({
        name: text,
        relationship: text,
        birthDate: date.nullable().default(null),
      }),
    )
    .max(20)
    .default([]),
  education: long,
  pastEmployment: long,
  epfCategory: z
    .enum(["Part A", "Part C", "Part E", "Part F", "Manual"])
    .default("Manual"),
  socsoCategory: z.enum(["First", "Second", "Exempt"]).default("First"),
  skbbk: z.boolean().default(false),
  eisEligible: z.boolean().default(true),
  taxResident: z.boolean().default(true),
  pcbCategory: z
    .enum(["Single", "Spouse not working", "Spouse working"])
    .default("Single"),
  taxScheme: z
    .enum(["Standard", "REP", "Knowledge worker", "C-suite", "Manual"])
    .default("Manual"),
  childRelief: money,
  disabledSelf: z.boolean().default(false),
  disabledSpouse: z.boolean().default(false),
  tp1Relief: money,
  previousTaxable: money,
  previousEPF: money,
  previousPCB: money,
  previousZakat: money,
  monthlyZakat: money,
  taxProfileVerified: z.boolean().default(false),
  hoursPerDay: z.coerce.number().positive().max(24).default(8),
  overtimeEligible: z.boolean().default(false),
  carryForward: z.coerce.number().min(0).max(366).default(0),
};
