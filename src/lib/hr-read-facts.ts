import { localDate } from "./calculations";
import { leaveEntitlement } from "./leave-entitlement";
import { sameClaimPeriod } from "./claim-period";
import { specialistAllows } from "./workflow-config";
import { addCalendarDays } from "./hr-calendar";
import { reviewOptions } from "./request-workflow";
import type { Actor, Company, HRRecord } from "./types";
/** Only already authorized, specialist-filtered records may enter this lookup. */
export function hrReadFacts(
  actor: Actor,
  company: Company,
  input: HRRecord[],
  now = new Date(),
) {
  const records = input.filter((r) => r.company_id === actor.companyId),
    today = localDate(now, company.settings.timezone);
  const own = records.find(
      (r) => r.kind === "employee" && r.id === actor.employeeId,
    ),
    employees = records.filter(
      (r) => r.kind === "employee" && r.data.status !== "Archived",
    );
  const pending = records.filter(
    (r) =>
      r.data.status === "Pending" &&
      reviewOptions(actor, r, records).includes("Approved"),
  );
  const availability = specialistAllows(company.settings, "leave", "read")
    ? Array.from({ length: 14 }, (_, i) => {
        const date = addCalendarDays(today, i);
        const off = records.filter(
          (r) =>
            r.kind === "leave" &&
            r.data.status === "Approved" &&
            String(r.data.startDate) <= date &&
            String(r.data.endDate) >= date,
        );
        return {
          date,
          employeeCount: new Set(off.map((r) => r.employee_id)).size,
          people: [...new Set(off.map((r) => r.employee_id))]
            .slice(0, 30)
            .map((id) => ({
              employeeId: id,
              name: String(
                employees.find((e) => e.id === id)?.data.name || "Employee",
              ),
            })),
          listTruncated: new Set(off.map((r) => r.employee_id)).size > 30,
          partialDayRequestIds: off
            .filter((r) => r.data.unit && r.data.unit !== "Full day")
            .slice(0, 30)
            .map((r) => r.id),
        };
      })
    : null;
  const policies = records.filter(
    (r) =>
      r.kind === "leave_type" &&
      (!r.data.departmentId || r.data.departmentId === own?.data.departmentId),
  );
  const leaveBalances =
    own && specialistAllows(company.settings, "leave", "read")
      ? [
          ...new Set([
            "Annual",
            "Sick",
            ...policies.map((p) => String(p.data.name)),
          ]),
        ].map((type) => ({
          type,
          ...leaveEntitlement(
            own,
            policies.find((p) => p.data.name === type) || null,
            type,
            today,
            today,
            records.filter((r) => r.kind === "leave"),
          ),
        }))
      : null;
  const claimBalances =
    own && specialistAllows(company.settings, "claims", "read")
      ? records
          .filter(
            (r) =>
              r.kind === "claim_type" &&
              (!r.data.departmentId ||
                r.data.departmentId === own.data.departmentId),
          )
          .map((policy) => {
            const used = records
              .filter(
                (r) =>
                  r.kind === "claim" &&
                  r.employee_id === own.id &&
                  r.data.claimTypeId === policy.id &&
                  ["Pending", "Approved", "Paid"].includes(
                    String(r.data.status),
                  ) &&
                  sameClaimPeriod(policy.data.period, r.data, { date: today }),
              )
              .reduce((sum, r) => sum + Number(r.data.amount), 0);
            return {
              policyId: policy.id,
              name: policy.data.name,
              period: policy.data.period,
              limitMYR: policy.data.limit,
              ...(policy.data.period === "Per trip"
                ? {
                    note: "Choose a trip reference to calculate its remaining balance",
                  }
                : {
                    reservedOrPaidMYR: used,
                    availableMYR: Math.max(0, Number(policy.data.limit) - used),
                  }),
            };
          })
      : null;
  const overtime =
    own &&
    typeof own.data.salary === "number" &&
    specialistAllows(company.settings, "claims", "read")
      ? {
          eligible: !!own.data.overtimeEligible,
          currentMonthlyBaseMYR: Number(own.data.salary || 0),
          normalHoursPerDay: Number(own.data.hoursPerDay || 8),
          rates: company.settings.overtimeRates,
          calculation:
            "Current monthly base / 26 / normal hours per day * requested hours * configured rate. Payroll checks effective-date salary and eligibility; this estimate is not an entitlement ruling.",
        }
      : null;
  return {
    date: today,
    timezone: company.settings.timezone,
    scope:
      "All records currently authorized to this account and permitted by the enabled HR specialists. Missing permissions are not zero activity.",
    activeDirectoryHeadcount: employees.length,
    pendingApprovalCount: pending.length,
    pendingApprovalIds: pending.slice(0, 50).map((r) => r.id),
    pendingListTruncated: pending.length > 50,
    approvedLeaveDateOverlaps: availability,
    ownLeaveBalances: leaveBalances,
    ownClaimBalances: claimBalances,
    ownOvertimeEstimateInputs: overtime,
    note: "Approved leave date overlaps can include weekends and partial days. They do not establish a full-day staffing absence. Other records supplied to the model are a limited snapshot.",
  };
}
