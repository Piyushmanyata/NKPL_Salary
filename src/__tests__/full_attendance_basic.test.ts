import { describe, expect, it } from "vitest";
import {
  OFFICIAL_WAGE_DAYS,
  buildOfficialRow,
  officialBasic,
  wageBoardCategory,
} from "../officialSheet";
import { alignReferenceEsi, calculateSalary, roundMoney } from "../salary";
import { applyEmployeeEdit } from "../editEmployee";
import { applyEmployeeRates, buildRateMap, sanitizeEmployee } from "../roster";
import type { EmployeeInput, SalaryRow } from "../types";

function refRow(partial: EmployeeInput, monthDays = 30): SalaryRow {
  const raw = calculateSalary(partial, { workingDays: monthDays });
  const official = buildOfficialRow(raw, monthDays);
  return alignReferenceEsi(raw, official.esi, official.employerEsi);
}

/** GURU PRASAD PATRA — Skilled, PF off, package above the ESI limit. Issue #29. */
const guru = (over: Partial<EmployeeInput> = {}): EmployeeInput => ({
  id: "emp-1",
  name: "GURU PRASAD PATRA",
  category: "Skilled",
  monthlySalary: 19500,
  salaryPerDay: 650,
  bonusPerDay: 223,
  daysWorked: 30,
  extraDays: 0,
  basicPercent: 70,
  pfOptIn: false,
  esiOptIn: false,
  advance: null,
  otherDeduction: 0,
  ...over,
});

/** UTTAM DAS — the one pinned employee who is genuinely PF-on. Issue #29. */
const uttam = (over: Partial<EmployeeInput> = {}): EmployeeInput => ({
  id: "emp-j1",
  name: "UTTAM DAS",
  category: "Skilled",
  monthlySalary: 15000,
  salaryPerDay: 500,
  bonusPerDay: 400,
  daysWorked: 30,
  extraDays: 0,
  basicPercent: 70,
  pfOptIn: true,
  esiOptIn: false,
  advance: null,
  otherDeduction: 0,
  ...over,
});

/** Bindu Chirania — Special, pinned well above the 51% opt-out floor. Issue #29. */
const bindu = (over: Partial<EmployeeInput> = {}): EmployeeInput => ({
  id: "emp-42",
  name: "Bindu Chirania",
  category: "Special",
  monthlySalary: 60000,
  daysWorked: 30,
  extraDays: 0,
  basicPercent: 70,
  pfOptIn: false,
  esiOptIn: false,
  advance: null,
  otherDeduction: 0,
  ...over,
});

describe("Full Attendance Basic — the money rule (SPEC 6.3, issue #29)", () => {
  it("prints exactly the pinned figure at full attendance", () => {
    const row = refRow(guru({ fullAttendanceBasic: 21500 }));
    const official = buildOfficialRow(row, 30);
    expect(official.attendance).toBe(OFFICIAL_WAGE_DAYS);
    expect(official.monthlyBasic).toBe(21500);
  });

  it("prorates on the 26-day frame below full attendance", () => {
    // 27 of 30 days -> absentDays 3 -> A_max 23.
    const row = refRow(guru({ daysWorked: 27, fullAttendanceBasic: 21500 }));
    const official = buildOfficialRow(row, 30);
    expect(official.attendance).toBe(23);
    expect(official.monthlyBasic).toBe(roundMoney((21500 / OFFICIAL_WAGE_DAYS) * 23));
  });

  it("beats the wage board when PF is on, and PF follows the pinned basic", () => {
    const unpinned = buildOfficialRow(refRow(uttam()), 30);
    // Baseline: PF really is on, so the wage board applies (484 x 26).
    expect(unpinned.pf).toBeGreaterThan(0);
    expect(unpinned.monthlyBasic).toBe(484 * OFFICIAL_WAGE_DAYS);

    const pinned = buildOfficialRow(refRow(uttam({ fullAttendanceBasic: 21500 })), 30);
    expect(pinned.monthlyBasic).toBe(21500);
    // 12% of min(21500, 15000) — the PF ceiling still caps the contribution.
    expect(pinned.pf).toBe(1800);
    expect(pinned.pf).toBeGreaterThan(unpinned.pf);
  });

  it("beats the 51% opt-out floor for a Special employee", () => {
    expect(buildOfficialRow(refRow(bindu()), 30).monthlyBasic).toBe(30600);
    const pinned = buildOfficialRow(refRow(bindu({ fullAttendanceBasic: 42000 })), 30);
    expect(pinned.monthlyBasic).toBe(42000);
  });

  it("leaves Net Payable untouched — the pin only re-splits the components", () => {
    for (const build of [guru, uttam, bindu]) {
      const before = buildOfficialRow(refRow(build()), 30);
      const after = buildOfficialRow(refRow(build({ fullAttendanceBasic: 42000 })), 30);
      expect(after.unpackable).toBe(false);
      expect(after.netPayable).toBe(before.netPayable);
      expect(after.netPayable).toBe(after.referenceNetPayable);
    }
  });

  it("absent, zero and negative pins all leave the formula untouched", () => {
    const base = buildOfficialRow(refRow(guru()), 30).monthlyBasic;
    expect(base).toBe(21100);
    for (const pin of [undefined, 0, -500]) {
      const row = refRow(guru({ fullAttendanceBasic: pin as number | undefined }));
      expect(buildOfficialRow(row, 30).monthlyBasic).toBe(base);
    }
  });

  it("is ignored at zero attendance", () => {
    const row = refRow(guru({ daysWorked: 0, fullAttendanceBasic: 21500 }));
    expect(officialBasic(row, wageBoardCategory(row.category), 0)).toBe(0);
  });

  it("is rescued by the packer, not blocked, when the pin overshoots the gross", () => {
    // The packer walks A down until the prorated pin fits, so an overshooting
    // pin lowers the printed attendance instead of blocking export. This is the
    // real-world consequence of keeping the packer as-is: the row still files,
    // but the basic prints BELOW the pinned figure. Issue #29.
    const row = refRow(guru({ fullAttendanceBasic: 40000 }));
    const official = buildOfficialRow(row, 30);
    expect(official.unpackable).toBe(false);
    expect(official.attendance).toBeLessThan(OFFICIAL_WAGE_DAYS);
    expect(official.monthlyBasic).toBeLessThan(40000);
    expect(official.monthlyBasic).toBe(
      roundMoney((40000 / OFFICIAL_WAGE_DAYS) * official.attendance),
    );
    expect(official.netPayable).toBe(official.referenceNetPayable);
  });

  it("only goes unpackable when the pin exceeds 26x the target gross", () => {
    // A_min is 1 for anyone who worked, so the smallest basic a pin can produce
    // is pin/26. Below that there is no attendance left to walk down to.
    const row = refRow(
      guru({ monthlySalary: 5000, salaryPerDay: 0, bonusPerDay: 0, fullAttendanceBasic: 300000 }),
    );
    const official = buildOfficialRow(row, 30);
    expect(official.unpackable).toBe(true);
    expect(official.bonus).toBe(0);
  });

  it("allows HRA, TA and Bonus to land at zero when the pin consumes the gross", () => {
    // Rishi Jhajharia: 25,000 pin against exactly 25,000 target gross.
    const row = refRow({
      id: "emp-40",
      name: "Rishi Jhajharia",
      category: "Special",
      monthlySalary: 25000,
      daysWorked: 30,
      extraDays: 0,
      basicPercent: 70,
      pfOptIn: false,
      esiOptIn: false,
      advance: null,
      otherDeduction: 0,
      fullAttendanceBasic: 25000,
    });
    const official = buildOfficialRow(row, 30);
    expect(official.unpackable).toBe(false);
    expect(official.monthlyBasic).toBe(25000);
    expect(official.monthlyHra).toBe(0);
    expect(official.monthlyTravelAllowance).toBe(0);
    expect(official.bonus).toBe(0);
    expect(official.netPayable).toBe(official.referenceNetPayable);
  });
});

describe("Full Attendance Basic — the ESI flag (ADR-0011, issue #29)", () => {
  /** Package inside the ESI limit, so ESI genuinely applies without a pin. */
  const esiEligible = (over: Partial<EmployeeInput> = {}): EmployeeInput => ({
    id: "esi-1",
    name: "ESI Eligible",
    category: "Skilled",
    monthlySalary: 21000,
    daysWorked: 30,
    extraDays: 0,
    basicPercent: 70,
    pfOptIn: false,
    esiOptIn: true,
    advance: null,
    otherDeduction: 0,
    // ESI eligibility caps the PACKAGE at 21,000, but the pin must clear 21,000
    // to suppress ESI — and it can only do that if the row has gross beyond the
    // package to pack against. A special bonus is that headroom, which is why
    // this flag fires in a narrow band rather than never. Issue #29.
    specialBonus: 6000,
    ...over,
  });

  it("flags a row whose pin lifts the basic past the ESI ceiling", () => {
    const unpinned = buildOfficialRow(refRow(esiEligible()), 30);
    expect(unpinned.esi).toBeGreaterThan(0);
    expect(unpinned.esiSuppressedByPin).toBe(false);

    const pinned = buildOfficialRow(refRow(esiEligible({ fullAttendanceBasic: 21500 })), 30);
    expect(pinned.monthlyBasic).toBe(21500);
    expect(pinned.esi).toBe(0);
    expect(pinned.esiSuppressedByPin).toBe(true);
  });

  it("does not flag a pin that keeps the basic inside the ceiling", () => {
    const pinned = buildOfficialRow(refRow(esiEligible({ fullAttendanceBasic: 20000 })), 30);
    expect(pinned.esi).toBeGreaterThan(0);
    expect(pinned.esiSuppressedByPin).toBe(false);
  });

  it("does not flag an employee who had no ESI to lose", () => {
    // Guru's package is already above the 21,000 limit, so ESI was never charged.
    const pinned = buildOfficialRow(refRow(guru({ fullAttendanceBasic: 21500 })), 30);
    expect(pinned.esi).toBe(0);
    expect(pinned.esiSuppressedByPin).toBe(false);
  });

  it("never flags a Special employee, who has no ESI by category", () => {
    const pinned = buildOfficialRow(refRow(bindu({ fullAttendanceBasic: 42000 })), 30);
    expect(pinned.esiSuppressedByPin).toBe(false);
  });
});

describe("Full Attendance Basic — persistence (issue #29)", () => {
  it("survives a sanitize round trip and drops non-positive values", () => {
    const keep = sanitizeEmployee(guru({ fullAttendanceBasic: 21500 }), 0, 30);
    expect(keep?.fullAttendanceBasic).toBe(21500);
    for (const pin of [0, -1, undefined]) {
      const dropped = sanitizeEmployee(guru({ fullAttendanceBasic: pin as number }), 0, 30);
      expect(dropped?.fullAttendanceBasic).toBeUndefined();
    }
  });

  it("round-trips through the Rate Card and reaches every month", () => {
    const rates = buildRateMap([guru({ fullAttendanceBasic: 21500 }) as EmployeeInput]);
    expect(rates["emp-1"].fullAttendanceBasic).toBe(21500);

    // A stored month snapshot with no pin picks it up from the card.
    const [overlaid] = applyEmployeeRates([guru()], rates);
    expect(overlaid.fullAttendanceBasic).toBe(21500);
  });

  it("clearing the pin in the Rate Card clears it on already-saved months", () => {
    const rates = buildRateMap([guru({ fullAttendanceBasic: 0 }) as EmployeeInput]);
    const [overlaid] = applyEmployeeRates([guru({ fullAttendanceBasic: 21500 })], rates);
    expect(overlaid.fullAttendanceBasic).toBeUndefined();
  });

  it("is editable and clearable through the settings panel", () => {
    const set = applyEmployeeEdit(guru(), "fullAttendanceBasic", 21500, 30);
    expect(set.fullAttendanceBasic).toBe(21500);
    expect(applyEmployeeEdit(set, "fullAttendanceBasic", "", 30).fullAttendanceBasic).toBeUndefined();
    expect(applyEmployeeEdit(set, "fullAttendanceBasic", 0, 30).fullAttendanceBasic).toBeUndefined();
  });
});
