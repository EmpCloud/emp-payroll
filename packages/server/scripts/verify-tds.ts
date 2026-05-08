import { computeIncomeTax } from "../src/services/tax/india-tax.service";
import { TaxRegime } from "@emp-payroll/shared";

const cases = [
  { label: "₹3L (below threshold)", gross: 300000, regime: TaxRegime.NEW },
  { label: "₹5L (within rebate, low)", gross: 500000, regime: TaxRegime.NEW },
  { label: "₹8.45L (user's example)", gross: 845004, regime: TaxRegime.NEW },
  { label: "₹12L (at rebate ceiling)", gross: 1200000, regime: TaxRegime.NEW },
  { label: "₹12.75L (marginal relief)", gross: 1275000, regime: TaxRegime.NEW },
  { label: "₹15L (above rebate)", gross: 1500000, regime: TaxRegime.NEW },
  { label: "₹25L (high)", gross: 2500000, regime: TaxRegime.NEW },
  { label: "₹50L (very high)", gross: 5000000, regime: TaxRegime.NEW },
  { label: "₹8.45L OLD regime (no decl)", gross: 845004, regime: TaxRegime.OLD },
  { label: "₹12L OLD regime (no decl)", gross: 1200000, regime: TaxRegime.OLD },
];

console.log(
  "Scenario".padEnd(34),
  "Regime".padEnd(7),
  "Gross".padStart(11),
  "Taxable".padStart(11),
  "Slab Tax".padStart(10),
  "Cess".padStart(8),
  "Annual TDS".padStart(11),
  "Monthly".padStart(9),
);
console.log("-".repeat(112));

for (const c of cases) {
  const annualGross = c.gross;
  const basicAnnual = Math.round(annualGross * 0.5);
  const employeePfAnnual = Math.min(basicAnnual, 15000 * 12) * 0.12;
  const t = computeIncomeTax({
    employeeId: "verify",
    financialYear: "2025-2026",
    regime: c.regime,
    annualGross,
    basicAnnual,
    hraAnnual: Math.round(annualGross * 0.4),
    rentPaidAnnual: 0,
    isMetroCity: false,
    declarations: [],
    employeePfAnnual,
    monthsWorked: 12,
    taxAlreadyPaid: 0,
    panNumber: "ABCDE1234F",
  });
  console.log(
    c.label.padEnd(34),
    c.regime.padEnd(7),
    `₹${annualGross.toLocaleString("en-IN")}`.padStart(11),
    `₹${t.taxableIncome.toLocaleString("en-IN")}`.padStart(11),
    `₹${t.taxOnIncome.toLocaleString("en-IN")}`.padStart(10),
    `₹${t.healthAndEducationCess.toLocaleString("en-IN")}`.padStart(8),
    `₹${t.totalTax.toLocaleString("en-IN")}`.padStart(11),
    `₹${t.monthlyTds.toLocaleString("en-IN")}`.padStart(9),
  );
}

console.log("\nPAN MISSING (Section 206AA — flat 20% on annual gross):");
for (const gross of [300000, 845004, 1500000]) {
  const t = computeIncomeTax({
    employeeId: "verify",
    financialYear: "2025-2026",
    regime: TaxRegime.NEW,
    annualGross: gross,
    basicAnnual: gross * 0.5,
    hraAnnual: gross * 0.4,
    rentPaidAnnual: 0,
    isMetroCity: false,
    declarations: [],
    employeePfAnnual: 0,
    monthsWorked: 12,
    taxAlreadyPaid: 0,
    panNumber: null,
  });
  console.log(
    `  ₹${gross.toLocaleString("en-IN").padStart(10)} → annual ₹${t.totalTax.toLocaleString("en-IN")} | monthly ₹${t.monthlyTds.toLocaleString("en-IN")}`,
  );
}
