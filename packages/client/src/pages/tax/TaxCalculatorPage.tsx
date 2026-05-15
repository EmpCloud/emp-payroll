import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatCurrency } from "@/lib/utils";
import {
  useEmployees,
  useTaxCalculatorPrefill,
  useSimulateTax,
  useSavePriorEmployerTds,
} from "@/api/hooks";
import {
  Calculator,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Search,
  Info,
  X,
  Plus,
  ChevronDown,
  CheckCircle2,
  CalendarDays,
  Save,
} from "lucide-react";
import toast from "react-hot-toast";

// ---------------------------------------------------------------------------
// Styling notes
// ---------------------------------------------------------------------------
// This app handles dark mode via global !important overrides in globals.css
// (the override list covers `bg-white`, `bg-gray-50`, `bg-gray-100`,
// `border-gray-100/200`, `text-gray-400/500/600/700/900`, and inputs / selects
// / textareas wholesale). So DO NOT add `dark:` Tailwind variants here -- they
// would either be redundant or, worse, use shades the global rules don't know
// how to invert (e.g. text-gray-800, border-gray-300), leaving invisible text.
// Stick to the override-friendly palette below.
// ---------------------------------------------------------------------------

const COMMON_SECTIONS = [
  { code: "80C", label: "80C — PPF / ELSS / LIC / Principal" },
  { code: "80CCD_1B", label: "80CCD(1B) — NPS additional" },
  { code: "80D", label: "80D — Medical Insurance" },
  { code: "80E", label: "80E — Education Loan Interest" },
  { code: "80G", label: "80G — Donations" },
  { code: "80TTA", label: "80TTA — Savings Interest" },
];

interface DeclarationRow {
  section: string;
  amount: number;
}

interface CalcInputs {
  regime: "new" | "old";
  annualGross: number;
  basicAnnual: number;
  hraAnnual: number;
  rentPaidAnnual: number;
  isMetroCity: boolean;
  employeePfAnnual: number;
  declarations: DeclarationRow[];
  pan: string;
  // Form-12B / prior-employer additions. Editable in the calculator so
  // HR can run what-if scenarios without committing the values, and
  // persisted via a separate Save button.
  priorEmployerGross: number;
  priorEmployerTds: number;
  priorEmployerSource: string;
}

const DEFAULT_INPUTS: CalcInputs = {
  regime: "new",
  annualGross: 0,
  basicAnnual: 0,
  hraAnnual: 0,
  rentPaidAnnual: 0,
  isMetroCity: false,
  employeePfAnnual: 0,
  declarations: [],
  pan: "",
  priorEmployerGross: 0,
  priorEmployerTds: 0,
  priorEmployerSource: "",
};

// Standard input style used across the form -- mirrors what other pages use
// so global dark-mode rules apply.
const INPUT_CLS =
  "block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
const LABEL_CLS = "mb-1 block text-xs font-medium text-gray-600";

function initials(name?: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
}

function formatJoinDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function TaxCalculatorPage() {
  // -----------------------------------------------------------------------
  // Employee picker — a polished combobox: pill that opens a search panel.
  // Resolves the "long inline list eats the whole left column" problem from
  // the earlier version and behaves like the rest of the app's pickers.
  // -----------------------------------------------------------------------
  const [pickerOpen, setPickerOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Close picker on outside click
  useEffect(() => {
    if (!pickerOpen) return;
    function onClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [pickerOpen]);

  const { data: empRes, isLoading: empLoading } = useEmployees(
    search ? { q: search, limit: 25, page: 1 } : { limit: 25, page: 1 },
  );
  const employees: any[] = Array.isArray(empRes?.data?.data) ? empRes.data.data : [];
  const selectedEmployee = employees.find((e: any) => e.id === selectedId);

  // -----------------------------------------------------------------------
  // Prefill
  // -----------------------------------------------------------------------
  const { data: prefillRes, isFetching: prefillLoading } = useTaxCalculatorPrefill(selectedId);

  const [inputs, setInputs] = useState<CalcInputs>(DEFAULT_INPUTS);
  const [hasActiveSalary, setHasActiveSalary] = useState<boolean | null>(null);
  // Joining-date-aware context surfaced in the picker pill + an alert when
  // the employee is a mid-FY joiner (in which case Form 12B becomes a
  // material input, not just a nice-to-have).
  const [joiningDate, setJoiningDate] = useState<string | null>(null);
  const [isMidFyJoiner, setIsMidFyJoiner] = useState(false);
  const [monthsRemainingInFy, setMonthsRemainingInFy] = useState(0);
  const [financialYear, setFinancialYear] = useState("");

  const savePriorTds = useSavePriorEmployerTds(selectedId);

  useEffect(() => {
    if (prefillRes?.data) {
      const p = prefillRes.data;
      setInputs({
        regime: p.regime === "old" ? "old" : "new",
        annualGross: Number(p.annualGross || 0),
        basicAnnual: Number(p.basicAnnual || 0),
        hraAnnual: Number(p.hraAnnual || 0),
        rentPaidAnnual: Number(p.rentPaidAnnual || 0),
        isMetroCity: !!p.isMetroCity,
        employeePfAnnual: Number(p.employeePfAnnual || 0),
        declarations: Array.isArray(p.declarations)
          ? p.declarations.map((d: any) => ({
              section: String(d.section || ""),
              amount: Number(d.amount || 0),
            }))
          : [],
        pan: String(p.pan || ""),
        priorEmployerGross: Number(p.priorEmployerGross || 0),
        priorEmployerTds: Number(p.priorEmployerTds || 0),
        priorEmployerSource: String(p.priorEmployerSource || ""),
      });
      setHasActiveSalary(!!p.hasActiveSalary);
      setJoiningDate(p.joiningDate || null);
      setIsMidFyJoiner(!!p.isMidFyJoiner);
      setMonthsRemainingInFy(Number(p.monthsRemainingInFy || 0));
      setFinancialYear(String(p.financialYear || ""));
    } else if (!selectedId) {
      setInputs(DEFAULT_INPUTS);
      setHasActiveSalary(null);
      setJoiningDate(null);
      setIsMidFyJoiner(false);
      setMonthsRemainingInFy(0);
      setFinancialYear("");
    }
  }, [prefillRes, selectedId]);

  // -----------------------------------------------------------------------
  // Simulation
  // -----------------------------------------------------------------------
  const simulate = useSimulateTax();
  const [result, setResult] = useState<any>(null);
  const [simError, setSimError] = useState<string | null>(null);

  useEffect(() => {
    setResult(null);
    setSimError(null);
  }, [selectedId]);

  const runSimulation = () => {
    if (!selectedId) return;
    setSimError(null);
    simulate.mutate(
      {
        employeeId: selectedId,
        regime: inputs.regime,
        annualGross: inputs.annualGross,
        basicAnnual: inputs.basicAnnual,
        hraAnnual: inputs.hraAnnual,
        rentPaidAnnual: inputs.rentPaidAnnual,
        isMetroCity: inputs.isMetroCity,
        declarations: inputs.declarations.filter((d) => d.section && d.amount > 0),
        employeePfAnnual: inputs.employeePfAnnual,
        panNumber: inputs.pan || null,
        priorEmployerGross: inputs.priorEmployerGross,
        priorEmployerTds: inputs.priorEmployerTds,
      },
      {
        onSuccess: (res: any) => setResult(res?.data || null),
        onError: (err: any) =>
          setSimError(err?.message || "Failed to compute tax. Please try again."),
      },
    );
  };

  // Auto-run only when there's a non-zero gross to compute against. Without
  // this guard the page used to flash a Section-206AA warning before the
  // user had typed anything.
  useEffect(() => {
    if (
      selectedId &&
      prefillRes?.data &&
      !prefillLoading &&
      Number(prefillRes.data.annualGross || 0) > 0
    ) {
      runSimulation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, prefillRes?.data, prefillLoading]);

  const updateDeclaration = (idx: number, patch: Partial<DeclarationRow>) => {
    setInputs((prev) => ({
      ...prev,
      declarations: prev.declarations.map((d, i) => (i === idx ? { ...d, ...patch } : d)),
    }));
  };
  const addDeclaration = () => {
    setInputs((prev) => ({
      ...prev,
      declarations: [...prev.declarations, { section: "80C", amount: 0 }],
    }));
  };
  const removeDeclaration = (idx: number) => {
    setInputs((prev) => ({
      ...prev,
      declarations: prev.declarations.filter((_, i) => i !== idx),
    }));
  };
  const resetToSaved = () => {
    if (prefillRes?.data) {
      const p = prefillRes.data;
      setInputs({
        regime: p.regime === "old" ? "old" : "new",
        annualGross: Number(p.annualGross || 0),
        basicAnnual: Number(p.basicAnnual || 0),
        hraAnnual: Number(p.hraAnnual || 0),
        rentPaidAnnual: Number(p.rentPaidAnnual || 0),
        isMetroCity: !!p.isMetroCity,
        employeePfAnnual: Number(p.employeePfAnnual || 0),
        declarations: Array.isArray(p.declarations)
          ? p.declarations.map((d: any) => ({
              section: String(d.section || ""),
              amount: Number(d.amount || 0),
            }))
          : [],
        pan: String(p.pan || ""),
        priorEmployerGross: Number(p.priorEmployerGross || 0),
        priorEmployerTds: Number(p.priorEmployerTds || 0),
        priorEmployerSource: String(p.priorEmployerSource || ""),
      });
    }
  };

  const handleSelectEmployee = (id: string) => {
    setSelectedId(id);
    setPickerOpen(false);
    setSearchInput("");
  };

  // -----------------------------------------------------------------------
  // Breakdown rows
  // -----------------------------------------------------------------------
  const breakdownRows = useMemo(() => {
    if (!result)
      return [] as Array<{ label: string; value: number; bold?: boolean; neg?: boolean }>;
    const rows: Array<{ label: string; value: number; bold?: boolean; neg?: boolean }> = [
      { label: "Gross Annual Income", value: Number(result.grossIncome || 0) },
    ];
    if (Array.isArray(result.exemptions)) {
      for (const ex of result.exemptions) {
        rows.push({
          label: `Less: ${ex.description || ex.code}`,
          value: -Number(ex.amount || 0),
          neg: true,
        });
      }
    }
    if (Array.isArray(result.deductions)) {
      for (const d of result.deductions) {
        rows.push({
          label: `Less: ${d.section}${d.description ? ` (${d.description})` : ""}`,
          value: -Number(d.allowedAmount || 0),
          neg: true,
        });
      }
    }
    rows.push({
      label: "Taxable Income",
      value: Number(result.taxableIncome || 0),
      bold: true,
    });
    rows.push({
      label: "Tax on Income (post-rebate 87A)",
      value: Number(result.taxOnIncome || 0),
    });
    if (Number(result.surcharge || 0) > 0) {
      rows.push({ label: "Surcharge", value: Number(result.surcharge || 0) });
    }
    rows.push({
      label: "Health & Education Cess (4%)",
      value: Number(result.healthAndEducationCess || 0),
    });
    return rows;
  }, [result]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tax Calculator"
        description="What-if income tax projection — pick any employee and recompute with custom inputs"
      />

      {/* ============================================================
           Step 1 — Employee combobox (always visible at the top)
         ============================================================ */}
      <Card>
        <CardContent className="space-y-2 py-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Step 1 · Employee
          </p>

          <div ref={pickerRef} className="relative">
            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              className="hover:border-brand-300 focus:border-brand-500 focus:ring-brand-500 flex w-full items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left text-sm transition-colors focus:outline-none focus:ring-1"
            >
              {selectedEmployee ? (
                <div className="flex min-w-0 items-center gap-3">
                  <div className="bg-brand-50 text-brand-700 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                    {initials(`${selectedEmployee.first_name} ${selectedEmployee.last_name}`)}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-gray-900">
                      {selectedEmployee.first_name} {selectedEmployee.last_name}
                    </p>
                    <p className="truncate text-xs text-gray-500">
                      {selectedEmployee.employee_code || selectedEmployee.emp_code || "—"}
                      {" · "}
                      CTC {formatCurrency(Number(selectedEmployee.ctc || 0))}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-gray-500">
                  <Search className="h-4 w-4" />
                  <span>Search and select an employee…</span>
                </div>
              )}
              <ChevronDown
                className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${
                  pickerOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            {/* Joining-date / FY context strip. Surfaced here (not behind a
                tooltip) so HR sees exactly how many months remain at this
                employer in the current FY -- the divisor used by the
                engine to compute monthly TDS. */}
            {selectedEmployee && (joiningDate || financialYear) && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                {joiningDate && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-gray-700">
                    <CalendarDays className="h-3 w-3" />
                    Joined {formatJoinDate(joiningDate)}
                  </span>
                )}
                {financialYear && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-gray-700">
                    FY {financialYear}
                  </span>
                )}
                {monthsRemainingInFy > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-gray-700">
                    {monthsRemainingInFy} month{monthsRemainingInFy === 1 ? "" : "s"} left this FY
                  </span>
                )}
                {isMidFyJoiner && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 font-medium text-amber-800">
                    <AlertTriangle className="h-3 w-3" />
                    Mid-FY joiner
                  </span>
                )}
              </div>
            )}

            {pickerOpen && (
              <div className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
                <div className="relative border-b border-gray-100">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    autoFocus
                    placeholder="Search name, email, code…"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    className="w-full bg-white py-2.5 pl-10 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
                  />
                </div>

                <div className="max-h-80 overflow-y-auto">
                  {empLoading ? (
                    <div className="flex h-20 items-center justify-center">
                      <Loader2 className="text-brand-600 h-5 w-5 animate-spin" />
                    </div>
                  ) : employees.length === 0 ? (
                    <p className="px-3 py-6 text-center text-sm text-gray-400">
                      No employees match "{search}"
                    </p>
                  ) : (
                    <ul className="divide-y divide-gray-100">
                      {employees.map((e: any) => {
                        const active = selectedId === e.id;
                        return (
                          <li key={e.id}>
                            <button
                              type="button"
                              onClick={() => handleSelectEmployee(e.id)}
                              className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-gray-50"
                            >
                              <div className="flex min-w-0 items-center gap-3">
                                <div className="bg-brand-50 text-brand-700 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold">
                                  {initials(`${e.first_name} ${e.last_name}`)}
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-gray-900">
                                    {e.first_name} {e.last_name}
                                  </p>
                                  <p className="truncate text-xs text-gray-500">
                                    {e.employee_code || e.emp_code || "—"} · CTC{" "}
                                    {formatCurrency(Number(e.ctc || 0))}
                                  </p>
                                </div>
                              </div>
                              {active && (
                                <CheckCircle2 className="text-brand-600 h-4 w-4 flex-shrink-0" />
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ============================================================
           Empty state when no employee picked
         ============================================================ */}
      {!selectedId && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            <div className="bg-brand-50 text-brand-600 flex h-14 w-14 items-center justify-center rounded-full">
              <Calculator className="h-7 w-7" />
            </div>
            <p className="text-base font-semibold text-gray-900">Pick an employee to begin</p>
            <p className="max-w-md text-sm text-gray-500">
              The calculator loads their current salary, regime, and approved declarations so you
              can tweak any input and see the resulting monthly TDS.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ============================================================
           Step 2 + 3 — Inputs & Breakdown side by side
         ============================================================ */}
      {selectedId && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_minmax(380px,440px)]">
          {/* ----- Inputs ----- */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>Step 2 · Inputs</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={resetToSaved}
                  disabled={prefillLoading || !prefillRes?.data}
                >
                  <RefreshCw className="h-4 w-4" /> Reset to saved
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {prefillLoading && (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Loader2 className="text-brand-600 h-4 w-4 animate-spin" />
                  Loading saved values…
                </div>
              )}

              {hasActiveSalary === false && !prefillLoading && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                  <span>
                    No active salary structure assigned. All fields start at zero — enter figures
                    manually to project tax.
                  </span>
                </div>
              )}

              {isMidFyJoiner && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                  <div>
                    <p className="font-medium">Mid-FY joiner — capture Form 12B below</p>
                    <p className="mt-0.5 text-amber-800">
                      This employee joined in the middle of FY {financialYear}. Without their prior
                      employer's income + TDS, the engine will spread the full annual tax over only{" "}
                      {monthsRemainingInFy} month{monthsRemainingInFy === 1 ? "" : "s"} and
                      over-deduct.
                    </p>
                  </div>
                </div>
              )}

              {/* Regime toggle as segmented control */}
              <div>
                <span className={LABEL_CLS}>Regime</span>
                <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
                  {(["new", "old"] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setInputs({ ...inputs, regime: r })}
                      className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                        inputs.regime === r
                          ? "bg-brand-600 text-white shadow-sm"
                          : "text-gray-600 hover:text-gray-900"
                      }`}
                    >
                      {r === "new" ? "New Regime" : "Old Regime"}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className={LABEL_CLS}>
                  PAN <span className="text-gray-400">· 206AA flat 20% if blank</span>
                </span>
                <input
                  type="text"
                  value={inputs.pan}
                  onChange={(e) => setInputs({ ...inputs, pan: e.target.value.toUpperCase() })}
                  placeholder="ABCDE1234F"
                  maxLength={10}
                  className={`${INPUT_CLS} max-w-xs font-mono uppercase tracking-wider`}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <NumberField
                  label="Annual Gross"
                  value={inputs.annualGross}
                  onChange={(v) => setInputs({ ...inputs, annualGross: v })}
                />
                <NumberField
                  label="Annual Basic"
                  value={inputs.basicAnnual}
                  onChange={(v) => setInputs({ ...inputs, basicAnnual: v })}
                />
                <NumberField
                  label="Annual HRA"
                  value={inputs.hraAnnual}
                  onChange={(v) => setInputs({ ...inputs, hraAnnual: v })}
                />
                <NumberField
                  label="Employee PF (annual)"
                  value={inputs.employeePfAnnual}
                  onChange={(v) => setInputs({ ...inputs, employeePfAnnual: v })}
                />
              </div>

              {/* Form-12B / prior-employer block. Available unconditionally
                  (since an employee can change jobs anytime), but visually
                  emphasised when the engine flagged a mid-FY joiner. The
                  Save button persists onto tax_info.priorEmployerTds[fy]
                  so future payroll runs net it out automatically. */}
              <div
                className={`space-y-3 rounded-lg border p-4 ${
                  isMidFyJoiner ? "border-amber-300 bg-amber-50" : "border-gray-100 bg-gray-50"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Prior Employer (Form 12B){" "}
                    {financialYear && <span className="text-gray-400">· FY {financialYear}</span>}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    loading={savePriorTds.isPending}
                    disabled={!selectedId || !financialYear}
                    onClick={() =>
                      savePriorTds.mutate(
                        {
                          financialYear,
                          grossPaid: inputs.priorEmployerGross,
                          tdsDeducted: inputs.priorEmployerTds,
                          source: inputs.priorEmployerSource,
                        },
                        {
                          onSuccess: () => {
                            toast.success("Prior-employer TDS saved");
                            runSimulation();
                          },
                          onError: (err: any) =>
                            toast.error(err?.message || "Failed to save prior TDS"),
                        },
                      )
                    }
                  >
                    <Save className="h-3.5 w-3.5" /> Save to profile
                  </Button>
                </div>
                <p className="text-xs text-gray-600">
                  Income the employee earned + TDS deducted at their previous employer this FY.
                  Saved values flow into the next payroll run so the engine doesn't re-collect this
                  employer's share against the prior employer's withholding.
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <NumberField
                    label="Prior employer gross (this FY)"
                    value={inputs.priorEmployerGross}
                    onChange={(v) => setInputs({ ...inputs, priorEmployerGross: v })}
                  />
                  <NumberField
                    label="Prior employer TDS"
                    value={inputs.priorEmployerTds}
                    onChange={(v) => setInputs({ ...inputs, priorEmployerTds: v })}
                  />
                </div>
                <label className="block">
                  <span className={LABEL_CLS}>Source / notes (optional)</span>
                  <input
                    type="text"
                    value={inputs.priorEmployerSource}
                    onChange={(e) => setInputs({ ...inputs, priorEmployerSource: e.target.value })}
                    placeholder='e.g. "Form 12B uploaded 2026-09-01"'
                    className={INPUT_CLS}
                  />
                </label>
              </div>

              {inputs.regime === "old" && (
                <div className="space-y-4 rounded-lg border border-gray-100 bg-gray-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Old-regime extras
                  </p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <NumberField
                      label="Annual Rent Paid"
                      value={inputs.rentPaidAnnual}
                      onChange={(v) => setInputs({ ...inputs, rentPaidAnnual: v })}
                    />
                    <label className="flex items-end gap-2 pb-2">
                      <input
                        id="metro"
                        type="checkbox"
                        checked={inputs.isMetroCity}
                        onChange={(e) => setInputs({ ...inputs, isMetroCity: e.target.checked })}
                        className="text-brand-600 focus:ring-brand-500 h-4 w-4 rounded border-gray-300"
                      />
                      <span className="text-sm text-gray-700">Metro city (50% basic HRA cap)</span>
                    </label>
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-600">
                        Chapter VI-A Declarations
                      </span>
                      <Button variant="ghost" size="sm" onClick={addDeclaration}>
                        <Plus className="h-3.5 w-3.5" /> Add
                      </Button>
                    </div>
                    <div className="space-y-2">
                      {inputs.declarations.length === 0 && (
                        <p className="text-xs text-gray-400">
                          No declarations. Click "Add" to model 80C / 80D / 80CCD(1B) etc.
                        </p>
                      )}
                      {inputs.declarations.map((d, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <select
                            value={d.section}
                            onChange={(e) => updateDeclaration(idx, { section: e.target.value })}
                            className={`${INPUT_CLS} flex-1`}
                          >
                            {COMMON_SECTIONS.map((s) => (
                              <option key={s.code} value={s.code}>
                                {s.label}
                              </option>
                            ))}
                            {!COMMON_SECTIONS.some((s) => s.code === d.section) && (
                              <option value={d.section}>{d.section}</option>
                            )}
                          </select>
                          <div className="relative w-36">
                            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">
                              ₹
                            </span>
                            <input
                              type="number"
                              value={d.amount}
                              onChange={(e) =>
                                updateDeclaration(idx, { amount: Number(e.target.value) || 0 })
                              }
                              className={`${INPUT_CLS} pl-7 text-right tabular-nums`}
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => removeDeclaration(idx)}
                            className="rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                            title="Remove"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {inputs.regime === "new" && (
                <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                  <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span>
                    New regime — only the ₹75,000 standard deduction applies. HRA, 80C, 80D and
                    other Chapter VI-A deductions are not available.
                  </span>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4">
                <Button onClick={runSimulation} loading={simulate.isPending} disabled={!selectedId}>
                  <Calculator className="h-4 w-4" /> Calculate
                </Button>
                {simError && <span className="text-sm text-red-600">{simError}</span>}
              </div>
            </CardContent>
          </Card>

          {/* ----- Result ----- */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Step 3 · Tax Breakdown</CardTitle>
                <Badge variant={inputs.regime === "new" ? "approved" : "pending"}>
                  {inputs.regime === "new" ? "New Regime" : "Old Regime"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {!result ? (
                <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                  {simulate.isPending ? (
                    <>
                      <Loader2 className="text-brand-600 h-6 w-6 animate-spin" />
                      <p className="text-sm text-gray-500">Calculating…</p>
                    </>
                  ) : (
                    <>
                      <Calculator className="h-8 w-8 text-gray-400" />
                      <p className="text-sm text-gray-500">
                        {inputs.annualGross > 0
                          ? "Click Calculate to project tax"
                          : "Enter an Annual Gross to project tax"}
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <>
                  {result.panMissing206AA && (
                    <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                      <span>
                        <strong>Section 206AA applied</strong> — PAN is missing, so a flat 20% of
                        annual gross is being deducted regardless of regime / declarations.
                      </span>
                    </div>
                  )}

                  <dl className="space-y-2.5">
                    {breakdownRows.map((row, i) => (
                      <div
                        key={i}
                        className={`flex items-center justify-between text-sm ${
                          row.bold
                            ? "border-t border-gray-200 pt-2.5 font-semibold text-gray-900"
                            : "text-gray-700"
                        }`}
                      >
                        <dt>{row.label}</dt>
                        <dd
                          className={`tabular-nums ${
                            row.neg ? "text-red-600" : row.bold ? "text-gray-900" : "text-gray-700"
                          }`}
                        >
                          {row.value < 0
                            ? `−${formatCurrency(Math.abs(row.value))}`
                            : formatCurrency(row.value)}
                        </dd>
                      </div>
                    ))}

                    {/* Hero — Total Annual Tax */}
                    <div className="bg-brand-50 mt-3 flex items-center justify-between rounded-lg px-4 py-3">
                      <dt className="text-brand-700 text-sm font-semibold">Total Annual Tax</dt>
                      <dd className="text-brand-700 text-xl font-bold tabular-nums">
                        {formatCurrency(Number(result.totalTax || 0))}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-5 grid grid-cols-1 gap-3 border-t border-gray-100 pt-4 sm:grid-cols-3">
                    <SummaryStat label="TDS Paid YTD" value={Number(result.taxAlreadyPaid || 0)} />
                    <SummaryStat
                      label="Remaining Tax"
                      value={Number(result.remainingTax || 0)}
                      accent="orange"
                    />
                    <SummaryStat
                      label="Monthly TDS"
                      value={Number(result.monthlyTds || 0)}
                      accent="brand"
                    />
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className={LABEL_CLS}>{label}</span>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">
          ₹
        </span>
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          className={`${INPUT_CLS} pl-7 text-right tabular-nums`}
        />
      </div>
    </label>
  );
}

function SummaryStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "brand" | "orange";
}) {
  // Stick with classes globals.css overrides know about; orange is left as-is
  // since it never appears on dark surfaces (rendered inside the card body).
  const bg =
    accent === "brand" ? "bg-brand-50" : accent === "orange" ? "bg-orange-50" : "bg-gray-50";
  const color =
    accent === "brand"
      ? "text-brand-700"
      : accent === "orange"
        ? "text-orange-600"
        : "text-gray-900";
  return (
    <div className={`rounded-lg px-4 py-3 ${bg}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`mt-1 text-lg font-bold tabular-nums ${color}`}>{formatCurrency(value)}</p>
    </div>
  );
}
