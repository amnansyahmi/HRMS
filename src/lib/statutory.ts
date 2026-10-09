import schedules from "./data/malaysia-statutory.json";
import type { Data, HRRecord } from "./types";
import { fail } from "./errors";
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const truncate = (n: number) => Math.trunc((n + Number.EPSILON) * 100) / 100;
const ceiling5 = (n: number) =>
  Math.max(0, Math.ceil(truncate(Math.max(0, n)) * 20 - 1e-7) / 20);
export const statutorySources = schedules.sources;
export function epfContribution(
  wages: number,
  category: string,
  normalWages = wages,
  bonus = 0,
) {
  if (!Number.isFinite(wages) || wages < 0) fail("Invalid EPF wages");
  if (!wages) return { employee: 0, employer: 0 };
  if (category === "Part F")
    return {
      employee: Math.ceil(wages * 0.02 - 1e-9),
      employer: Math.ceil(wages * 0.02 - 1e-9),
    };
  if (!["Part A", "Part C", "Part E"].includes(category))
    fail("Choose a verified EPF category or enter manual contributions");
  const rates =
    category === "Part A"
      ? [0.11, 0.12]
      : category === "Part C"
        ? [0.055, 0.06]
        : [0, 0.04];
  const table = schedules.epf[category as keyof typeof schedules.epf],
    row = table.find((r) => wages <= r[1]);
  const result = row
    ? { employee: row[3], employer: row[2] }
    : {
        employee: Math.ceil(wages * rates[0] - 1e-9),
        employer: Math.ceil(wages * rates[1] - 1e-9),
      };
  if (category !== "Part E" && normalWages <= 5000 && bonus > 0 && wages > 5000)
    result.employer = Math.ceil(
      wages * (category === "Part A" ? 0.13 : 0.065) - 1e-9,
    );
  return result;
}
export function socsoContribution(
  wages: number,
  category: string,
  skbbk = false,
) {
  if (!wages || category === "Exempt")
    return { employee: 0, employer: 0, skbbk: 0 };
  const row =
    schedules.socso.find((r) => wages <= r[0]) || schedules.socso.at(-1)!;
  return {
    employer: category === "Second" ? row[4] : row[1],
    employee: category === "Second" ? 0 : row[2],
    skbbk: skbbk ? row[3] : 0,
  };
}
export function eisContribution(wages: number, eligible: boolean) {
  if (!wages || !eligible) return { employee: 0, employer: 0 };
  const row = schedules.eis.find((r) => wages <= r[0]) || schedules.eis.at(-1)!;
  return { employer: row[1], employee: row[2] };
}
const bands = [
  [5000, 0, 0, 0],
  [20000, 5000, 0.01, 0],
  [35000, 20000, 0.03, 150],
  [50000, 35000, 0.06, 600],
  [70000, 50000, 0.11, 1500],
  [100000, 70000, 0.19, 3700],
  [400000, 100000, 0.25, 9400],
  [600000, 400000, 0.26, 84400],
  [2000000, 600000, 0.28, 136400],
  [Infinity, 2000000, 0.3, 528400],
];
export function annualTax(
  chargeable: number,
  category: string,
  scheme = "Standard",
) {
  const p = Math.max(0, truncate(chargeable)),
    spouse = category === "Spouse not working",
    rebate = p <= 35000 ? (spouse ? 800 : 400) : 0;
  if (scheme === "C-suite" && p <= 35000)
    fail(
      "C-suite income at or below RM35,000 requires manual verified tax treatment",
    );
  if (scheme !== "Standard")
    return Math.max(
      0,
      truncate(p * 0.15 - (scheme === "C-suite" ? 0 : rebate)),
    );
  const b = bands.find((b) => p <= b[0])!;
  return Math.max(0, truncate((p - b[1]) * b[2] + b[3] - rebate));
}
export function pcb2026(
  profile: Data,
  input: {
    month: number;
    normal: number;
    additional: number;
    normalEPF: number;
    additionalEPF: number;
    previousTaxable: number;
    previousEPF: number;
    previousPCB: number;
    previousZakat: number;
  },
) {
  const {
    month,
    normal,
    additional,
    normalEPF,
    additionalEPF,
    previousTaxable,
    previousEPF,
    previousPCB,
    previousZakat,
  } = input;
  if (month < 1 || month > 12) fail("Invalid PCB month");
  if (!profile.taxResident)
    return {
      pcb: ceiling5((normal + additional) * 0.3),
      normalPCB: ceiling5(normal * 0.3),
      additionalPCB: ceiling5(additional * 0.3),
      chargeable: null,
    };
  const category = String(profile.pcbCategory || "Single"),
    scheme = String(profile.taxScheme || "Standard");
  if (scheme === "Manual") fail("Use verified manual PCB for this profile");
  const n = 12 - month,
    k = Math.min(4000, previousEPF),
    k1 = Math.min(normalEPF, Math.max(0, 4000 - k)),
    kt = Math.min(additionalEPF, Math.max(0, 4000 - k - k1));
  const relief =
    9000 +
    (category === "Spouse not working" ? 4000 : 0) +
    (profile.disabledSelf ? 7000 : 0) +
    (profile.disabledSpouse ? 6000 : 0) +
    (category === "Single" ? 0 : Number(profile.childRelief || 0)) +
    Number(profile.tp1Relief || 0);
  const base = previousTaxable - k + normal - k1;
  const k2 = n ? Math.min(k1, Math.max(0, (4000 - k - k1) / n)) : 0;
  const p = truncate(base + n * truncate(normal - k2) - relief),
    tax = annualTax(p, category, scheme);
  let normalBeforeZakat = truncate(
    Math.max(0, (tax - previousZakat - previousPCB) / (n + 1)),
  );
  if (normalBeforeZakat < 10) normalBeforeZakat = 0;
  const normalPCB = ceiling5(
    Math.max(0, normalBeforeZakat - Number(profile.monthlyZakat || 0)),
  );
  const additionalK2 = n
      ? Math.min(k1, Math.max(0, (4000 - k - k1 - kt) / n))
      : 0,
    pWithAdditional = truncate(
      base + n * truncate(normal - additionalK2) + additional - kt - relief,
    );
  let additionalPCB = additional
    ? truncate(
        Math.max(
          0,
          annualTax(pWithAdditional, category, scheme) -
            (previousPCB + normalBeforeZakat * (n + 1)) -
            previousZakat,
        ),
      )
    : 0;
  if (additionalPCB < 10) additionalPCB = 0;
  const totalPCB = ceiling5(
    Math.max(
      0,
      normalBeforeZakat + additionalPCB - Number(profile.monthlyZakat || 0),
    ),
  );
  additionalPCB = round(Math.max(0, totalPCB - normalPCB));
  return {
    pcb: totalPCB,
    normalPCB,
    additionalPCB,
    chargeable: p,
    chargeableWithAdditional: pWithAdditional,
    epfRelief: {
      prior: k,
      current: k1,
      additional: kt,
      future: round(additionalK2 * n),
    },
    relief,
    scheme,
    category,
  };
}
export function calculateStatutory(
  profile: Data,
  draft: Data,
  history: HRRecord[],
) {
  const period = String(draft.period);
  if (!period.startsWith("2026-"))
    fail(
      "Automatic PCB is versioned for 2026. Enter verified amounts for other years.",
    );
  if (!profile.taxProfileVerified)
    fail("HR must verify the employee statutory profile first");
  if (period < "2026-07" && profile.skbbk)
    fail("Review SKBBK transitional contributions manually before July 2026");
  const normal = Number(
      draft.taxableNormal ??
        Number(draft.base) +
          Number(draft.allowance) +
          Number(draft.overtime) -
          Number(draft.unpaidDeduction || 0),
    ),
    additional = Number(
      draft.taxableAdditional ??
        Number(draft.bonus) + Number(draft.commission || 0),
    ),
    epfNormal = Number(
      draft.epfNormalWages ??
        Number(draft.base) +
          Number(draft.allowance) -
          Number(draft.unpaidDeduction || 0),
    ),
    epfWages = Number(
      draft.epfWages ??
        epfNormal + Number(draft.bonus) + Number(draft.commission || 0),
    ),
    socsoWages = Number(
      draft.socsoWages ??
        Number(draft.base) +
          Number(draft.allowance) +
          Number(draft.overtime) +
          Number(draft.commission || 0) -
          Number(draft.unpaidDeduction || 0),
    );
  const epf = epfContribution(
      epfWages,
      String(profile.epfCategory),
      epfNormal,
      Number(draft.bonus),
    ),
    normalEPF = epfContribution(
      epfNormal,
      String(profile.epfCategory),
    ).employee;
  const skbbk =
      period >= "2026-06" &&
      (profile.nationality === "Foreign" || !!profile.skbbk),
    socso = socsoContribution(socsoWages, String(profile.socsoCategory), skbbk),
    eis = eisContribution(socsoWages, !!profile.eisEligible);
  const previous = history.filter(
    (r) =>
      r.data.status === "Published" &&
      String(r.data.period).startsWith("2026-") &&
      String(r.data.period) < period,
  );
  const accum = (key: string) =>
    previous.reduce((n, r) => n + Number(r.data[key] || 0), 0);
  const pcb = pcb2026(profile, {
    month: Number(period.slice(5)),
    normal,
    additional,
    normalEPF,
    additionalEPF: Math.max(0, epf.employee - normalEPF),
    previousTaxable:
      Number(profile.previousTaxable || 0) +
      previous.reduce(
        (n, r) =>
          n +
          Number(
            (r.data.calculation as Data)?.taxableTotal ??
              Number(r.data.gross) - Number(r.data.unpaidDeduction || 0),
          ),
        0,
      ),
    previousEPF: Number(profile.previousEPF || 0) + accum("epfEmployee"),
    previousPCB: Number(profile.previousPCB || 0) + accum("pcb"),
    previousZakat: Number(profile.previousZakat || 0) + accum("zakat"),
  });
  return {
    epfEmployee: epf.employee,
    epfEmployer: epf.employer,
    socsoEmployee: round(socso.employee + socso.skbbk),
    socsoEmployer: socso.employer,
    eisEmployee: eis.employee,
    eisEmployer: eis.employer,
    pcb: pcb.pcb,
    zakat: Number(profile.monthlyZakat || 0),
    calculation: {
      method: "MY-2026-v1",
      checkedOn: schedules.checkedOn,
      sources: schedules.sources,
      epfCategory: profile.epfCategory,
      socsoCategory: profile.socsoCategory,
      skbbk: socso.skbbk,
      taxableNormal: normal,
      taxableAdditional: additional,
      taxableTotal: normal + additional,
      epfWages,
      epfNormalWages: epfNormal,
      socsoWages,
      pcb,
      calculatedAt: new Date().toISOString(),
    },
  };
}
