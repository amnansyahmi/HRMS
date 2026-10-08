import { describe, it, expect } from "vitest";
import {
  epfContribution,
  socsoContribution,
  eisContribution,
  annualTax,
  pcb2026,
  calculateStatutory,
} from "@/lib/statutory";
import { parseCalendar } from "@/lib/calendar";
import { receiptSuggestions } from "@/lib/ocr";
const profile = {
  taxResident: true,
  taxScheme: "Standard",
  pcbCategory: "Single",
  monthlyZakat: 0,
};
const january = {
  month: 1,
  normal: 5000,
  additional: 0,
  normalEPF: 550,
  additionalEPF: 0,
  previousTaxable: 0,
  previousEPF: 0,
  previousPCB: 0,
  previousZakat: 0,
};
describe("versioned Malaysian payroll schedules", () => {
  it.each([
    [0, 0, 0],
    [10, 0, 0],
    [10.01, 3, 3],
    [4000, 440, 520],
    [5000, 550, 650],
    [5000.01, 561, 612],
    [20000.01, 2201, 2401],
  ])(
    "uses Part A bands and whole-ringgit rounding at RM%s",
    (wages, employee, employer) => {
      expect(epfContribution(wages, "Part A")).toEqual({ employee, employer });
    },
  );
  it("applies the bonus exception for normal pay up to RM5,000", () => {
    expect(epfContribution(6000, "Part A", 5000, 1000)).toEqual({
      employee: 660,
      employer: 780,
    });
    expect(epfContribution(6000, "Part C", 5000, 1000)).toEqual({
      employee: 330,
      employer: 390,
    });
    expect(epfContribution(6000, "Part E", 5000, 1000)).toEqual({
      employee: 0,
      employer: 240,
    });
    expect(epfContribution(2001, "Part F")).toEqual({
      employee: 41,
      employer: 41,
    });
  });
  it("uses the official SOCSO and EIS ceilings instead of percentages", () => {
    expect(socsoContribution(6000, "First")).toMatchObject({
      employer: 104.15,
      employee: 29.75,
      skbbk: 0,
    });
    expect(socsoContribution(6000.01, "First")).toEqual(
      socsoContribution(6000, "First"),
    );
    expect(socsoContribution(6000, "Second").employee).toBe(0);
    expect(socsoContribution(6000, "Exempt", true)).toEqual({
      employee: 0,
      employer: 0,
      skbbk: 0,
    });
    expect(eisContribution(30, true)).toEqual({
      employee: 0.05,
      employer: 0.05,
    });
    expect(eisContribution(30.01, true)).toEqual({
      employee: 0.1,
      employer: 0.1,
    });
    expect(eisContribution(6000, true)).toEqual({
      employee: 11.9,
      employer: 11.9,
    });
    expect(eisContribution(9000, true)).toEqual(eisContribution(6000, true));
    expect(eisContribution(6000, false)).toEqual({ employee: 0, employer: 0 });
  });
  it("calculates tax bracket boundaries and spouse rebates", () => {
    expect(annualTax(20000, "Single")).toBe(0);
    expect(annualTax(35000, "Single")).toBe(200);
    expect(annualTax(35000, "Spouse not working")).toBe(0);
    expect(annualTax(50000, "Single")).toBe(1500);
    expect(annualTax(100000, "Single")).toBe(9400);
    expect(() => annualTax(35000, "Single", "C-suite")).toThrow("manual");
  });
  it("projects the 2026 EPF relief cap and rounds PCB to five sen", () => {
    const result = pcb2026(profile, january);
    expect(result.chargeable).toBeCloseTo(47000, 1);
    expect(result.pcb).toBe(110);
    expect(result.epfRelief?.prior).toBe(0);
    expect(result.epfRelief?.current).toBe(550);
    expect(result.epfRelief?.future).toBeCloseTo(3450, 0);
  });
  it("carries excess current-month zakat against additional-remuneration PCB", () => {
    const noZakat = pcb2026(profile, {
      ...january,
      additional: 2000,
      additionalEPF: 220,
    });
    const zakat = pcb2026(
      { ...profile, monthlyZakat: 150 },
      { ...january, additional: 2000, additionalEPF: 220 },
    );
    expect(zakat.pcb).toBeCloseTo(Math.max(0, noZakat.pcb - 150), 2);
    expect(zakat.normalPCB).toBe(0);
    expect(zakat.additionalPCB).toBe(zakat.pcb);
  });
  it("offsets prior PCB and zakat, and handles non-residents", () => {
    const input = {
      ...january,
      month: 12,
      previousTaxable: 55000,
      previousEPF: 6050,
      previousPCB: 1000,
      previousZakat: 200,
    };
    expect(pcb2026(profile, input).pcb).toBe(120);
    expect(
      pcb2026(
        { ...profile, taxResident: false },
        { ...january, additional: 1000 },
      ).pcb,
    ).toBe(1800);
  });
  it("requires verified profiles and refuses unversioned tax years", () => {
    expect(() => calculateStatutory({}, { period: "2027-01" }, [])).toThrow(
      "versioned for 2026",
    );
    expect(() => calculateStatutory({}, { period: "2026-01" }, [])).toThrow(
      "verify",
    );
  });
});
describe("imports and receipt suggestions", () => {
  it("unfolds escaped calendar text without following external links", () => {
    const events = parseCalendar(
      "BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Review\\, planning\nDESCRIPTION:Line one\\nLine\n  two\nDTSTART:20261009T020000Z\nDTEND:20261009T030000Z\nEND:VEVENT\nEND:VCALENDAR",
      "Asia/Kuala_Lumpur",
    );
    expect(events[0].title).toBe("Review, planning");
    expect(events[0].notes).toBe("Line one\nLine two");
  });
  it("extracts receipt totals and real dates for human review", () => {
    expect(receiptSuggestions("ABC Cafe\n08/10/2026\nTOTAL RM 32.40")).toEqual({
      merchant: "ABC Cafe",
      date: "2026-10-08",
      amount: 32.4,
    });
    expect(
      receiptSuggestions("ABC Cafe\n31/02/2026\nTOTAL RM 1,200.00"),
    ).toMatchObject({ date: null, amount: 1200 });
  });
});
