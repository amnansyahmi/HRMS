import type { Kind } from "@/lib/types";
export interface Field {
  key: string;
  label: string;
  type?:
    | "text"
    | "number"
    | "textarea"
    | "date"
    | "time"
    | "datetime-local"
    | "select"
    | "boolean"
    | "multi"
    | "lines";
  options?: string[];
  source?: Kind;
  required?: boolean;
  min?: number;
  step?: string;
  itemKeys?: string[];
}
const text = (key: string, label: string): Field => ({ key, label });
const date = (key: string, label: string): Field => ({
  key,
  label,
  type: "date",
});
const num = (key: string, label: string): Field => ({
  key,
  label,
  type: "number",
});
const area = (key: string, label: string): Field => ({
  key,
  label,
  type: "textarea",
});
const select = (key: string, label: string, options: string[]): Field => ({
  key,
  label,
  type: "select",
  options,
});
const ref = (key: string, label: string, source: Kind): Field => ({
  key,
  label,
  type: "select",
  source,
});
const bool = (key: string, label: string): Field => ({
  key,
  label,
  type: "boolean",
});
const approval = select("approval", "Approval steps", [
  "Manager or HR",
  "Manager then HR",
  "HR only",
]);
export const employeeDetails: Field[] = [
  text("staffNo", "Staff number"),
  text("nric", "NRIC / passport"),
  date("birthDate", "Date of birth"),
  select("nationality", "Nationality", [
    "Malaysian",
    "Permanent resident",
    "Foreign",
  ]),
  text("state", "State"),
  text("race", "Race (optional)"),
  text("religion", "Religion (optional)"),
  area("address", "Home address"),
  text("epfNo", "EPF number"),
  text("socsoNo", "SOCSO number"),
  text("taxNo", "Income tax number"),
  text("bankName", "Bank name"),
  text("bankAccount", "Bank account"),
  date("probationEnd", "Probation ends"),
  date("confirmationDate", "Confirmation date"),
  text("emergencyName", "Emergency contact"),
  text("emergencyPhone", "Emergency phone"),
  {
    key: "dependants",
    label: "Dependants — name | relationship | date of birth, one per line",
    type: "lines",
    itemKeys: ["name", "relationship", "birthDate"],
  },
  area("education", "Education"),
  area("pastEmployment", "Previous employment"),
  select("epfCategory", "Verified EPF category", [
    "Manual",
    "Part A",
    "Part C",
    "Part E",
    "Part F",
  ]),
  select("socsoCategory", "SOCSO category", ["First", "Second", "Exempt"]),
  bool("skbbk", "Local employee opted into SKBBK"),
  bool("eisEligible", "Eligible for EIS"),
  bool("taxResident", "Malaysian tax resident"),
  select("pcbCategory", "PCB category", [
    "Single",
    "Spouse not working",
    "Spouse working",
  ]),
  select("taxScheme", "Verified tax scheme", [
    "Manual",
    "Standard",
    "REP",
    "Knowledge worker",
    "C-suite",
  ]),
  num("childRelief", "Verified annual child relief (RM)"),
  bool("disabledSelf", "Disabled individual relief"),
  bool("disabledSpouse", "Disabled spouse relief"),
  num("tp1Relief", "Verified cumulative TP1 deductions this year (RM)"),
  num(
    "previousTaxable",
    "Previous employer taxable remuneration this year (RM)",
  ),
  num("previousEPF", "Previous employer EPF this year (RM)"),
  num("previousPCB", "Previous employer PCB this year (RM)"),
  num("previousZakat", "Previous employer zakat this year (RM)"),
  num("monthlyZakat", "Current monthly zakat (RM)"),
  bool(
    "taxProfileVerified",
    "HR has verified statutory eligibility and TP1/TP3 inputs",
  ),
  num("hoursPerDay", "Normal working hours per day"),
  bool("overtimeEligible", "Eligible for overtime payment"),
  num("carryForward", "Additional annual leave carry (days)"),
];
export const extendedFields: Partial<Record<Kind, Field[]>> = {
  document: [
    text("title", "Document name"),
    select("type", "Document type", [
      "Contract",
      "Identity",
      "Passport",
      "Permit",
      "Certificate",
      "Other",
    ]),
    date("issueDate", "Issued on"),
    date("expiryDate", "Expires on"),
    area("notes", "Notes"),
  ],
  asset: [
    text("name", "Equipment"),
    text("serialNo", "Serial number"),
    date("issuedOn", "Issued on"),
    date("returnedOn", "Returned on"),
    select("condition", "Condition", ["Good", "Needs repair", "Returned"]),
    area("notes", "Notes"),
  ],
  lifecycle: [
    text("title", "Checklist name"),
    select("type", "Checklist type", ["Onboarding", "Offboarding"]),
    date("dueDate", "Due date"),
    {
      key: "items",
      label: "Tasks — one per line",
      type: "lines",
      itemKeys: ["task"],
    },
    select("status", "Status", ["In progress", "Completed"]),
  ],
  letter: [
    text("title", "Letter title"),
    select("type", "Letter type", [
      "Offer",
      "Confirmation",
      "Warning",
      "Termination",
      "Reference",
      "Other",
    ]),
    date("effectiveDate", "Effective date"),
    area("body", "Letter text"),
  ],
  announcement: [
    text("title", "Announcement"),
    area("body", "Message"),
    ref("departmentId", "Audience department (empty = everyone)", "department"),
    bool("published", "Publish to staff"),
    date("expiresOn", "Expires on"),
  ],
  location: [
    text("name", "Location name"),
    text("state", "State"),
    area("address", "Address"),
    num("latitude", "Latitude"),
    num("longitude", "Longitude"),
    num("radius", "Allowed distance (metres)"),
    bool("geofence", "Require clock-in within this area"),
  ],
  holiday: [
    text("title", "Holiday name"),
    date("date", "Date"),
    text("state", "State, or National"),
  ],
  overtime: [
    date("date", "Work date"),
    num("hours", "Overtime hours"),
    select("type", "Overtime type", ["Normal", "Rest day", "Public holiday"]),
    area("reason", "Reason"),
  ],
  time_off: [
    date("date", "Date"),
    { key: "start", label: "From", type: "time" },
    { key: "end", label: "Until", type: "time" },
    area("reason", "Reason"),
  ],
  attendance_correction: [
    ref(
      "attendanceId",
      "Existing clock-in (empty = missed shift)",
      "attendance",
    ),
    date("workDate", "Shift date"),
    { key: "clockIn", label: "Correct clock-in time", type: "datetime-local" },
    {
      key: "clockOut",
      label: "Correct clock-out time",
      type: "datetime-local",
    },
    area("reason", "Reason"),
  ],
  lateness: [
    ref("attendanceId", "Clock-in", "attendance"),
    area("reason", "Lateness explanation"),
  ],
  leave_type: [
    text("name", "Leave type"),
    bool("paid", "Paid leave"),
    num("annualDays", "Yearly entitlement (days)"),
    select("accrual", "Entitlement release", ["Annual", "Monthly"]),
    num("carryDays", "Maximum automatic carry (days)"),
    num("carryExpiryMonth", "Carry expires after month (1–12)"),
    bool("receiptRequired", "Supporting document required"),
    approval,
    ref("departmentId", "Department (empty = everyone)", "department"),
  ],
  claim_type: [
    text("name", "Claim type"),
    num("limit", "Limit (RM)"),
    select("period", "Limit resets", ["Annual", "Monthly", "Per request"]),
    ref("departmentId", "Department (empty = everyone)", "department"),
    bool("receiptRequired", "Receipt required"),
    num("mileageRate", "Mileage rate per km (RM, 0 = amount entered)"),
    approval,
  ],
  review_cycle: [
    text("title", "Review cycle"),
    date("startDate", "From"),
    date("endDate", "Until"),
    select("status", "Status", ["Open", "Closed"]),
  ],
  evaluation_template: [
    text("title", "Evaluation template"),
    {
      key: "criteria",
      label: "Criteria — title | weight, one per line",
      type: "lines",
      itemKeys: ["title", "weight"],
    },
  ],
  evaluation: [
    ref("cycleId", "Review cycle", "review_cycle"),
    ref("templateId", "Evaluation template", "evaluation_template"),
    area("selfComments", "Self reflection"),
  ],
  goal_update: [
    ref("goalId", "Goal", "goal"),
    num("progress", "New progress"),
    area("note", "Progress note"),
  ],
};
export const requestFields = {
  leave: [
    ref("leaveTypeId", "Custom leave policy (optional)", "leave_type"),
    select("unit", "Leave portion", [
      "Full day",
      "Morning",
      "Afternoon",
      "Hours",
    ]),
    num("hours", "Hours, when using hourly leave"),
    num("startHour", "Hourly leave starts (24-hour, e.g. 9.5)"),
  ],
  claim: [
    ref("claimTypeId", "Custom claim policy (optional)", "claim_type"),
    num("mileageKm", "Mileage kilometres (optional)"),
  ],
  goal: [
    select("scope", "Goal scope", ["Individual", "Team", "Company"]),
    ref("departmentId", "Team department", "department"),
    ref("cycleId", "Review cycle", "review_cycle"),
    ref("parentId", "Parent company / team goal", "goal"),
    select("perspective", "Scorecard perspective", [
      "Financial",
      "Customer",
      "Process",
      "Learning",
    ]),
    num("weight", "Weight"),
  ],
  job: [
    {
      key: "screeningQuestions",
      label: "Screening questions — one per line",
      type: "lines",
    } as Field,
    text("templateName", "Reusable template name"),
  ],
  candidate: [
    {
      key: "interviewAt",
      label: "Interview time",
      type: "datetime-local",
    } as Field,
  ],
  meeting: [
    text("attendees", "Attendees"),
    {
      key: "sharedEmployeeIds",
      label: "Share with employees",
      type: "multi",
      source: "employee",
    } as Field,
    ref("linkedEmployeeId", "Linked employee (e.g. one-to-one)", "employee"),
  ],
};
