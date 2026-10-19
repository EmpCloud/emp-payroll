import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { useSalaryStructures } from "@/api/hooks";
import { apiGet, apiPost, apiPut, apiDelete } from "@/api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  ChevronDown,
  ChevronUp,
  Loader2,
  Trash2,
  Pencil,
  Copy,
  GripVertical,
  Info,
  Layers,
} from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

interface ComponentRow {
  name: string;
  code: string;
  type: "earning" | "deduction" | "reimbursement";
  calculationType:
    | "percentage"
    | "fixed"
    | "balance"
    | "per_night"
    | "per_night_daily"
    | "per_night_pct"
    | "per_ot"
    | "per_ot_daily";
  value: number;
  percentageOf: string;
}

const DEFAULT_COMPONENTS: ComponentRow[] = [
  {
    name: "Basic Salary",
    code: "BASIC",
    type: "earning",
    calculationType: "percentage",
    value: 40,
    percentageOf: "CTC",
  },
  {
    name: "House Rent Allowance",
    code: "HRA",
    type: "earning",
    calculationType: "percentage",
    value: 50,
    percentageOf: "BASIC",
  },
  {
    name: "Special Allowance",
    code: "SA",
    type: "earning",
    calculationType: "balance",
    value: 0,
    percentageOf: "",
  },
];

// Preset metadata — `calculationType` is optional and applied when the
// user picks the preset, so per-night additions auto-flag with the right
// calc type (otherwise admins would have to manually flip the dropdown
// every time and likely forget, paying it as a fixed monthly instead).
const PRESET_COMPONENTS: Array<{
  name: string;
  code: string;
  type: "earning" | "deduction" | "reimbursement";
  calculationType?: ComponentRow["calculationType"];
}> = [
  { name: "Basic Salary", code: "BASIC", type: "earning" },
  { name: "House Rent Allowance", code: "HRA", type: "earning" },
  { name: "Special Allowance", code: "SA", type: "earning" },
  { name: "Conveyance Allowance", code: "CA", type: "earning" },
  { name: "Medical Allowance", code: "MA", type: "earning" },
  { name: "Leave Travel Allowance", code: "LTA", type: "earning" },
  { name: "Performance Bonus", code: "BONUS", type: "earning" },
  // Single Night Allowance preset. Defaults to flat ₹/night; the
  // calc-type dropdown on the row itself lets admin switch to × Day
  // Pay (multiplier of daily salary) without adding a second row.
  { name: "Night Allowance", code: "NIGHT_ALLOW", type: "earning", calculationType: "per_night" },
  // Overtime preset — pays per OT day (a week-off / holiday worked, which
  // the Attendance Grid auto-marks WOT/HOT). Defaults to × Day Pay; the
  // row dropdown lets admin switch to a flat ₹/day instead.
  { name: "Overtime", code: "OVERTIME", type: "earning", calculationType: "per_ot_daily" },
  { name: "Canteen Deduction", code: "CANTEEN", type: "deduction" },
  { name: "Welfare Fund", code: "WELFARE", type: "deduction" },
  { name: "Advance Recovery", code: "ADV_REC", type: "deduction" },
];

export function SalaryStructuresPage() {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingStructure, setEditingStructure] = useState<any>(null);
  const [components, setComponents] = useState<ComponentRow[]>(DEFAULT_COMPONENTS);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [showNightHelp, setShowNightHelp] = useState(false);
  const { data: res, isLoading } = useSalaryStructures();
  const qc = useQueryClient();

  // The salary-structures endpoint returns a paginated envelope:
  //   { success, data: { data: [...], total, page, limit, totalPages } }
  // `apiGet` unwraps axios's outer body, leaving `res = { success, data }`
  // where `res.data` is the pagination object and `res.data.data` is the
  // actual array. Tolerate a flat `data: [...]` shape too in case the
  // endpoint is ever simplified — the array can live at either level.
  const payload: any = res?.data;
  const structures: any[] = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : [];

  function addComponent(preset?: (typeof PRESET_COMPONENTS)[0]) {
    setComponents([
      ...components,
      {
        name: preset?.name || "",
        code: preset?.code || "",
        type: preset?.type || "earning",
        // Honour the preset's `calculationType` when set (e.g. Night
        // Allowance defaults to "per_night" so the admin doesn't have to
        // flip the dropdown after picking it).
        calculationType: preset?.calculationType || "fixed",
        // Sensible default for the × Day Pay multiplier presets (Night /
        // Overtime) -- 2 = double pay, the canonical case. Admins can tweak
        // it. Other presets stay at 0 so the admin enters the rate.
        value:
          preset?.calculationType === "per_night_daily" ||
          preset?.calculationType === "per_ot_daily"
            ? 2
            : 0,
        percentageOf: "",
      },
    ]);
  }

  function removeComponent(i: number) {
    setComponents(components.filter((_, idx) => idx !== i));
  }

  function updateComponent(i: number, field: string, value: any) {
    const updated = [...components];
    const prev = updated[i].calculationType;
    (updated[i] as any)[field] = value;
    // Balance / Night / Overtime variants only make sense for earnings;
    // if user switches type to a non-earning, demote to fixed so the row
    // stays valid.
    if (
      field === "type" &&
      value !== "earning" &&
      (updated[i].calculationType === "balance" ||
        updated[i].calculationType === "per_night" ||
        updated[i].calculationType === "per_night_daily" ||
        updated[i].calculationType === "per_night_pct" ||
        updated[i].calculationType === "per_ot" ||
        updated[i].calculationType === "per_ot_daily")
    ) {
      updated[i].calculationType = "fixed";
    }
    // When flipping between the flat ↔ multiplier modes (Night or Overtime),
    // reset `value` because its MEANING changes:
    //   per_night / per_ot        : value = ₹ rate per night/OT day  (e.g. 250)
    //   per_night_daily / per_ot_daily : value = multiplier of day pay (e.g. 2)
    // Leaving 250 in place after a flip would silently turn "₹250/day" into
    // "250× day pay" and pay out absurd amounts. Seed × Day Pay with 2
    // (double); flat clears to 0 so admin types the rate.
    if (field === "calculationType" && prev !== value) {
      const nightModes = ["per_night", "per_night_daily", "per_night_pct"];
      if (
        (value === "per_night_daily" && prev === "per_night") ||
        (value === "per_ot_daily" && prev === "per_ot")
      ) {
        updated[i].value = 2;
      } else if (value === "per_night_pct" && nightModes.includes(prev)) {
        // % of net — seed a sensible 10%.
        updated[i].value = 10;
      } else if (
        (value === "per_night" && prev === "per_night_daily") ||
        (value === "per_ot" && prev === "per_ot_daily") ||
        (nightModes.includes(value) && prev === "per_night_pct")
      ) {
        updated[i].value = 0;
      }
    }
    setComponents(updated);
  }

  function openCreate() {
    setEditingStructure(null);
    setComponents(DEFAULT_COMPONENTS);
    setShowCreate(true);
  }

  function openEdit(ss: any, comps: any[]) {
    setEditingStructure(ss);
    setComponents(
      comps.map((c: any) => ({
        name: c.name,
        code: c.code,
        type: c.type || "earning",
        calculationType: c.calculation_type || "fixed",
        value: Number(c.value) || 0,
        percentageOf: c.percentage_of || "",
      })),
    );
    setShowCreate(true);
  }

  function closeModal() {
    setShowCreate(false);
    setEditingStructure(null);
    setComponents(DEFAULT_COMPONENTS);
  }

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    // Only one component may use Balance calculation, and only earnings can.
    const balanceRows = components.filter(
      (c) => c.calculationType === "balance" && c.name && c.code,
    );
    if (balanceRows.length > 1) {
      toast.error(t("salaryStructures.validation.singleBalance"));
      return;
    }
    const badBalance = balanceRows.find((c) => c.type !== "earning");
    if (badBalance) {
      toast.error(t("salaryStructures.validation.balanceEarning", { code: badBalance.code }));
      return;
    }

    // Value validation. Reject saves that would silently produce ₹0:
    //  - percentage rows need a value in (0, 100]
    //  - fixed earnings need a positive amount (deductions can be 0)
    //  - per_night needs a positive ₹/night
    //  - per_night_daily needs a positive multiplier (1 = same as day pay,
    //    2 = double, etc. -- 0 would zero out the line)
    //  - balance value is ignored (auto-filled)
    for (const c of components) {
      if (!c.name || !c.code) continue;
      const val = Number(c.value);
      if (c.calculationType === "percentage") {
        if (!Number.isFinite(val) || val <= 0 || val > 100) {
          toast.error(t("salaryStructures.validation.percentage", { code: c.code }));
          return;
        }
        if (!c.percentageOf) {
          toast.error(t("salaryStructures.validation.percentageBase", { code: c.code }));
          return;
        }
      } else if (c.calculationType === "fixed" && c.type === "earning") {
        if (!Number.isFinite(val) || val <= 0) {
          toast.error(t("salaryStructures.validation.fixedEarning", { code: c.code }));
          return;
        }
      } else if (c.calculationType === "per_night") {
        if (!Number.isFinite(val) || val <= 0) {
          toast.error(t("salaryStructures.validation.nightRate", { code: c.code }));
          return;
        }
      } else if (c.calculationType === "per_night_daily") {
        // Must be ≥ 1: the allowance tops base up to (multiplier ×) pay,
        // so a multiplier below 1 would mean paying LESS than normal for
        // night work (a negative allowance), which never makes sense.
        if (!Number.isFinite(val) || val < 1) {
          toast.error(t("salaryStructures.validation.nightMultiplier", { code: c.code }));
          return;
        }
      } else if (c.calculationType === "per_night_pct") {
        if (!Number.isFinite(val) || val <= 0 || val > 100) {
          toast.error(t("salaryStructures.validation.netPercentage", { code: c.code }));
          return;
        }
      } else if (c.calculationType === "per_ot") {
        if (!Number.isFinite(val) || val <= 0) {
          toast.error(t("salaryStructures.validation.overtimeRate", { code: c.code }));
          return;
        }
      } else if (c.calculationType === "per_ot_daily") {
        if (!Number.isFinite(val) || val < 1) {
          toast.error(t("salaryStructures.validation.overtimeMultiplier", { code: c.code }));
          return;
        }
      }
    }

    const fd = new FormData(e.currentTarget);
    setSaving(true);

    const payload = {
      name: fd.get("name") as string,
      description: fd.get("description") as string,
      isDefault: false,
      components: components
        .filter((c) => c.name && c.code)
        .map((c, i) => ({
          name: c.name,
          code: c.code,
          type: c.type,
          calculationType: c.calculationType,
          value: c.calculationType === "balance" ? 0 : c.value,
          percentageOf:
            c.calculationType === "percentage" ? c.percentageOf || undefined : undefined,
          isTaxable: c.type === "earning",
          isStatutory: false,
          isProratable: true,
          sortOrder: i,
        })),
    };

    try {
      if (editingStructure) {
        await apiPut(`/salary-structures/${editingStructure.id}`, payload);
        toast.success(t("salaryStructures.updated"));
      } else {
        await apiPost("/salary-structures", payload);
        toast.success(t("salaryStructures.created"));
      }
      closeModal();
      // #186 — also invalidate the per-structure components cache; the
      // expanded card below the list reads from ["structure-components", id]
      // and was rendering stale rows after Update because only the list
      // cache was being invalidated. Prefix-only key matches every
      // structure's component cache so the user sees the new rows
      // immediately, no page reload required.
      qc.invalidateQueries({ queryKey: ["salary-structures"] });
      qc.invalidateQueries({ queryKey: ["structure-components"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || t("salaryStructures.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(deleteTarget.id);
    try {
      await apiDelete(`/salary-structures/${deleteTarget.id}`);
      toast.success(t("salaryStructures.deleted"));
      qc.invalidateQueries({ queryKey: ["salary-structures"] });
      qc.invalidateQueries({ queryKey: ["structure-components"] });
      setDeleteTarget(null);
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || t("salaryStructures.deleteFailed"));
    } finally {
      setDeleting(null);
    }
  }

  async function handleDuplicate(ss: any) {
    try {
      await apiPost(`/salary-structures/${ss.id}/duplicate`, {
        name: t("salaryStructures.copyName", { name: ss.name }),
      });
      toast.success(t("salaryStructures.duplicated"));
      qc.invalidateQueries({ queryKey: ["salary-structures"] });
      qc.invalidateQueries({ queryKey: ["structure-components"] });
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || t("salaryStructures.duplicateFailed"));
    }
  }

  // Compute preview totals for the modal
  const earningTotal = components
    .filter((c) => c.type !== "deduction")
    .reduce((s, c) => s + c.value, 0);
  const deductionTotal = components
    .filter((c) => c.type === "deduction")
    .reduce((s, c) => s + c.value, 0);
  const unusedPresets = PRESET_COMPONENTS.filter((p) => !components.find((c) => c.code === p.code));

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-brand-600 h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("salaryStructures.title")}
        description={t("salaryStructures.configured", { count: structures.length })}
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" /> {t("salaryStructures.newStructure")}
          </Button>
        }
      />

      {structures.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-20 text-center">
          <div className="rounded-full bg-gray-50 p-3">
            <Layers className="h-6 w-6 text-gray-300" />
          </div>
          <p className="text-sm text-gray-500">{t("salaryStructures.noStructures")}</p>
          <Button size="sm" variant="outline" onClick={openCreate}>
            <Plus className="h-4 w-4" /> {t("salaryStructures.createFirst")}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {structures.map((ss: any) => (
            <StructureCard
              key={ss.id}
              structure={ss}
              expanded={expanded === ss.id}
              onToggle={() => setExpanded(expanded === ss.id ? null : ss.id)}
              onEdit={openEdit}
              onDelete={(s) => setDeleteTarget(s)}
              onDuplicate={handleDuplicate}
              isDeleting={deleting === ss.id}
            />
          ))}
        </div>
      )}

      {/* Create / Edit Modal */}
      <Modal
        open={showCreate}
        onClose={closeModal}
        title={editingStructure ? t("salaryStructures.editTitle") : t("salaryStructures.newTitle")}
        className="max-w-3xl"
      >
        <form className="flex h-full min-h-0 flex-col" onSubmit={handleSave}>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-4">
              <Input
                id="name"
                name="name"
                label={t("salaryStructures.structureName")}
                placeholder={t("salaryStructures.structureNamePlaceholder")}
                defaultValue={editingStructure?.name || ""}
                required
              />
              <Input
                id="description"
                name="description"
                label={t("salaryStructures.description")}
                placeholder={t("salaryStructures.descriptionPlaceholder")}
                defaultValue={editingStructure?.description || ""}
              />
            </div>

            {/* Components */}
            <div>
              {/* #104 — Use flex-wrap + gap so the header row doesn't smush
                  the preset dropdown on top of the "Components" label when
                  the modal content is narrow, and shrink-0 on the actions so
                  they don't collapse onto a single pixel. */}
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1.5">
                  <h4 className="text-sm font-semibold text-gray-700">
                    {t("salaryStructures.components")}
                  </h4>
                  <button
                    type="button"
                    onClick={() => setShowNightHelp(true)}
                    className="rounded-full p-0.5 text-gray-400 hover:bg-gray-100 hover:text-blue-600"
                    aria-label={t("salaryStructures.nightHelpAria")}
                    title={t("salaryStructures.nightHelpTitle")}
                  >
                    <Info className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {unusedPresets.length > 0 && (
                    <select
                      aria-label={t("salaryStructures.addPresetAria")}
                      className="focus:border-brand-500 focus:ring-brand-500 h-8 rounded-md border border-gray-300 px-2 text-xs focus:outline-none focus:ring-1"
                      value=""
                      onChange={(e) => {
                        const preset = PRESET_COMPONENTS.find((p) => p.code === e.target.value);
                        if (preset) addComponent(preset);
                        e.target.value = "";
                      }}
                    >
                      <option value="">{t("salaryStructures.addPreset")}</option>
                      {unusedPresets.map((p) => (
                        <option key={p.code} value={p.code}>
                          {t(`salaryStructures.presetNames.${p.code}`, {
                            defaultValue: p.name,
                          })}{" "}
                          ({t(`salaryStructures.types.${p.type}`)})
                        </option>
                      ))}
                    </select>
                  )}
                  <Button type="button" variant="outline" size="sm" onClick={() => addComponent()}>
                    <Plus className="h-3.5 w-3.5" /> {t("salaryStructures.custom")}
                  </Button>
                </div>
              </div>

              <div className="overflow-hidden rounded-lg border border-gray-200">
                {/* Header */}
                <div className="grid grid-cols-[1fr_80px_100px_90px_120px_90px_36px] gap-2 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500">
                  <span>{t("salaryStructures.columns.name")}</span>
                  <span>{t("salaryStructures.columns.code")}</span>
                  <span>{t("salaryStructures.columns.type")}</span>
                  <span>{t("salaryStructures.columns.calc")}</span>
                  <span>{t("salaryStructures.columns.value")}</span>
                  <span>{t("salaryStructures.columns.percentOf")}</span>
                  <span></span>
                </div>

                {/* Rows */}
                <div className="divide-y divide-gray-100">
                  {components.map((c, i) => (
                    <div
                      key={i}
                      className="grid grid-cols-[1fr_80px_100px_90px_120px_90px_36px] items-center gap-2 px-3 py-2"
                    >
                      <input
                        className="focus:border-brand-500 focus:ring-brand-500 w-full rounded border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1"
                        placeholder={t("salaryStructures.componentName")}
                        value={c.name}
                        onChange={(e) => updateComponent(i, "name", e.target.value)}
                        required
                      />
                      <input
                        className="focus:border-brand-500 focus:ring-brand-500 w-full rounded border border-gray-200 px-2 py-1.5 font-mono text-sm focus:outline-none focus:ring-1"
                        placeholder="CODE"
                        value={c.code}
                        onChange={(e) => updateComponent(i, "code", e.target.value.toUpperCase())}
                        required
                      />
                      <select
                        className="focus:border-brand-500 focus:ring-brand-500 w-full rounded border border-gray-200 px-1 py-1.5 text-sm focus:outline-none focus:ring-1"
                        value={c.type}
                        onChange={(e) => updateComponent(i, "type", e.target.value)}
                      >
                        <option value="earning">{t("salaryStructures.types.earning")}</option>
                        <option value="deduction">{t("salaryStructures.types.deduction")}</option>
                        <option value="reimbursement">
                          {t("salaryStructures.types.reimbursementShort")}
                        </option>
                      </select>
                      <select
                        className="focus:border-brand-500 focus:ring-brand-500 w-full rounded border border-gray-200 px-1 py-1.5 text-sm focus:outline-none focus:ring-1"
                        value={c.calculationType}
                        onChange={(e) => updateComponent(i, "calculationType", e.target.value)}
                      >
                        {/* Night / Overtime rows: only their two modes.
                            Regular rows: only the three regular modes.
                            Switching kinds requires deleting the row and
                            re-adding via the right preset -- a row's nature
                            shouldn't flip between "regular earning" and a
                            night/overtime line via a dropdown click. */}
                        {c.calculationType === "per_night" ||
                        c.calculationType === "per_night_daily" ||
                        c.calculationType === "per_night_pct" ? (
                          <>
                            <option value="per_night">
                              {t("salaryStructures.calcs.perNight")}
                            </option>
                            <option value="per_night_daily">
                              {t("salaryStructures.calcs.dayPay")}
                            </option>
                            <option value="per_night_pct">
                              {t("salaryStructures.calcs.netPayPercent")}
                            </option>
                          </>
                        ) : c.calculationType === "per_ot" ||
                          c.calculationType === "per_ot_daily" ? (
                          <>
                            <option value="per_ot">{t("salaryStructures.calcs.perOtDay")}</option>
                            <option value="per_ot_daily">
                              {t("salaryStructures.calcs.dayPay")}
                            </option>
                          </>
                        ) : (
                          <>
                            <option value="percentage">%</option>
                            <option value="fixed">{t("salaryStructures.calcs.fixed")}</option>
                            {c.type === "earning" && (
                              <option value="balance">{t("salaryStructures.calcs.balance")}</option>
                            )}
                          </>
                        )}
                      </select>
                      <input
                        className="focus:border-brand-500 focus:ring-brand-500 w-full rounded border border-gray-200 px-2 py-1.5 text-right text-sm focus:outline-none focus:ring-1 disabled:bg-gray-50 disabled:text-gray-300"
                        type="number"
                        min={0}
                        step={
                          c.calculationType === "per_night_daily" ||
                          c.calculationType === "per_ot_daily"
                            ? 0.5
                            : 1
                        }
                        value={c.calculationType === "balance" ? "" : c.value === 0 ? "" : c.value}
                        placeholder={
                          c.calculationType === "balance"
                            ? t("salaryStructures.auto")
                            : c.calculationType === "per_night"
                              ? t("salaryStructures.nightRatePlaceholder")
                              : c.calculationType === "per_ot"
                                ? t("salaryStructures.dayRatePlaceholder")
                                : c.calculationType === "per_night_pct"
                                  ? t("salaryStructures.percentPlaceholder")
                                  : c.calculationType === "per_night_daily" ||
                                      c.calculationType === "per_ot_daily"
                                    ? t("salaryStructures.multiplierPlaceholder")
                                    : "0"
                        }
                        // #316 — pre-select the contents on focus so typing
                        // overwrites the leading 0 instead of producing "01",
                        // "012", etc. Users were having to manually delete
                        // the 0 before every entry.
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (raw === "") {
                            updateComponent(i, "value", 0);
                            updateComponent(i, "_cleared", true);
                            return;
                          }
                          const n = Number(raw);
                          updateComponent(i, "value", Number.isFinite(n) && n >= 0 ? n : 0);
                          updateComponent(i, "_cleared", false);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "-" || e.key === "+" || e.key === "e") {
                            e.preventDefault();
                          }
                        }}
                        disabled={c.calculationType === "balance"}
                        title={
                          c.calculationType === "balance"
                            ? t("salaryStructures.autoTitle")
                            : undefined
                        }
                      />
                      {c.calculationType === "per_night" ||
                      c.calculationType === "per_night_daily" ||
                      c.calculationType === "per_night_pct" ||
                      c.calculationType === "per_ot" ||
                      c.calculationType === "per_ot_daily" ? (
                        // For night / overtime rows the "% Of" column is
                        // unused -- give it back to the admin as a clickable
                        // Info button that opens the help modal, so the math
                        // is one click away next to the row being edited.
                        <button
                          type="button"
                          onClick={() => setShowNightHelp(true)}
                          className="flex h-[34px] w-full items-center justify-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 text-xs font-medium text-blue-700 hover:bg-blue-100"
                          title={t("salaryStructures.nightOvertimeHelp")}
                        >
                          <Info className="h-3.5 w-3.5" />
                          {t("salaryStructures.info")}
                        </button>
                      ) : (
                        <input
                          className="focus:border-brand-500 focus:ring-brand-500 w-full rounded border border-gray-200 px-2 py-1.5 font-mono text-sm focus:outline-none focus:ring-1 disabled:bg-gray-50 disabled:text-gray-300"
                          placeholder={c.calculationType === "balance" ? "—" : "CTC"}
                          value={c.calculationType === "balance" ? "" : c.percentageOf}
                          onChange={(e) =>
                            updateComponent(i, "percentageOf", e.target.value.toUpperCase())
                          }
                          disabled={c.calculationType !== "percentage"}
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => removeComponent(i)}
                        className="flex h-8 w-8 items-center justify-center rounded text-red-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Summary */}
              {components.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                    {t("salaryStructures.counts.earning", {
                      count: components.filter((c) => c.type === "earning").length,
                    })}
                  </span>
                  {components.filter((c) => c.type === "deduction").length > 0 && (
                    <span className="rounded-full bg-rose-50 px-2 py-0.5 font-medium text-rose-700">
                      {t("salaryStructures.counts.deduction", {
                        count: components.filter((c) => c.type === "deduction").length,
                      })}
                    </span>
                  )}
                  {components.filter((c) => c.type === "reimbursement").length > 0 && (
                    <span className="rounded-full bg-sky-50 px-2 py-0.5 font-medium text-sky-700">
                      {t("salaryStructures.counts.reimbursement", {
                        count: components.filter((c) => c.type === "reimbursement").length,
                      })}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Info box */}
            <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-700 dark:bg-blue-950 dark:text-blue-300">
              <strong>{t("salaryStructures.noteTitle")}</strong> {t("salaryStructures.noteText")}
            </div>
          </div>

          <div className="mt-4 flex shrink-0 justify-end gap-3 border-t border-gray-100 bg-white pt-4 dark:border-gray-800 dark:bg-gray-900">
            <Button variant="outline" type="button" onClick={closeModal}>
              {t("salaryStructures.cancel")}
            </Button>
            <Button type="submit" loading={saving}>
              {editingStructure
                ? t("salaryStructures.updateStructure")
                : t("salaryStructures.createStructure")}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Night Allowance help — surfaces the rate × nights vs.
          daily-pay × multiplier math so HR can pick the right mode
          without re-reading the PR description. */}
      <Modal
        open={showNightHelp}
        onClose={() => setShowNightHelp(false)}
        title={t("salaryStructures.help.title")}
        className="max-w-2xl"
      >
        <div className="space-y-4 px-1 py-2 text-sm text-gray-700">
          <p>{t("salaryStructures.help.intro")}</p>

          <div className="rounded-md border border-gray-200">
            <div className="grid grid-cols-[90px_1fr_110px] gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500">
              <div>{t("salaryStructures.help.modeValue")}</div>
              <div>{t("salaryStructures.columns.calculation")}</div>
              <div className="text-right">{t("salaryStructures.help.allowanceAdded")}</div>
            </div>
            <div className="divide-y divide-gray-100 text-xs">
              <div className="grid grid-cols-[90px_1fr_110px] gap-2 px-3 py-2">
                <div>
                  <span className="font-medium text-gray-800">
                    {t("salaryStructures.help.perNight")}
                  </span>{" "}
                  · {t("salaryStructures.columns.value")} <span className="font-mono">250</span>
                </div>
                <div className="font-mono">
                  {t("salaryStructures.help.flatExample")}
                  <div className="text-gray-500">{t("salaryStructures.help.addedOnBase")}</div>
                </div>
                <div className="text-right font-mono font-semibold text-gray-900">₹5,500</div>
              </div>
              <div className="grid grid-cols-[90px_1fr_110px] gap-2 px-3 py-2">
                <div>
                  <span className="font-medium text-gray-800">
                    {t("salaryStructures.calcs.dayPay")}
                  </span>{" "}
                  · {t("salaryStructures.columns.value")} <span className="font-mono">2</span>{" "}
                  <span className="text-gray-500">({t("salaryStructures.help.double")})</span>
                </div>
                <div className="font-mono">
                  {t("salaryStructures.help.doubleFormula")}
                  <div className="text-gray-500">{t("salaryStructures.help.doubleTotal")}</div>
                </div>
                <div className="text-right font-mono font-semibold text-gray-900">₹166,666</div>
              </div>
              <div className="grid grid-cols-[90px_1fr_110px] gap-2 px-3 py-2">
                <div>
                  <span className="font-medium text-gray-800">
                    {t("salaryStructures.calcs.dayPay")}
                  </span>{" "}
                  · {t("salaryStructures.columns.value")} <span className="font-mono">1.5</span>
                </div>
                <div className="font-mono">
                  {t("salaryStructures.help.oneHalfFormula")}
                  <div className="text-gray-500">{t("salaryStructures.help.oneHalfTotal")}</div>
                </div>
                <div className="text-right font-mono font-semibold text-gray-900">₹83,333</div>
              </div>
            </div>
          </div>

          <div className="rounded-md bg-blue-50 p-3 text-xs leading-relaxed text-blue-800">
            <div className="mb-1 font-semibold">{t("salaryStructures.help.howModesWork")}</div>
            <ul className="ml-4 list-disc space-y-0.5">
              <li>{t("salaryStructures.help.perNightExplanation")}</li>
              <li>{t("salaryStructures.help.dayPayExplanation")}</li>
            </ul>
            <div className="mt-1 text-blue-700">{t("salaryStructures.help.exampleBase")}</div>
          </div>

          <div className="rounded-md bg-emerald-50 p-3 text-xs leading-relaxed text-emerald-800">
            <div className="mb-1 font-semibold">{t("salaryStructures.help.overtimeTitle")}</div>
            <ul className="ml-4 list-disc space-y-0.5">
              <li>{t("salaryStructures.help.overtimeCount")}</li>
              <li>{t("salaryStructures.help.perOtExplanation")}</li>
              <li>{t("salaryStructures.help.otDayPayExplanation")}</li>
            </ul>
          </div>

          <div className="rounded-md bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
            <span className="font-semibold">{t("salaryStructures.help.notesTitle")}</span>{" "}
            {t("salaryStructures.help.notesText")}
          </div>
        </div>

        <div className="flex justify-end border-t border-gray-200 px-1 pt-3">
          <Button type="button" onClick={() => setShowNightHelp(false)}>
            {t("salaryStructures.gotIt")}
          </Button>
        </div>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={!!deleteTarget}
        onClose={() => deleting == null && setDeleteTarget(null)}
        title={t("salaryStructures.deleteTitle")}
        description={
          deleteTarget
            ? t("salaryStructures.deleteDescription", { name: deleteTarget.name })
            : undefined
        }
        className="max-w-md"
      >
        <div className="flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={() => setDeleteTarget(null)}
            disabled={deleting != null}
          >
            {t("salaryStructures.cancel")}
          </Button>
          <Button
            variant="danger"
            onClick={confirmDelete}
            loading={deleteTarget != null && deleting === deleteTarget.id}
          >
            <Trash2 className="h-4 w-4" /> {t("salaryStructures.delete")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function CountPill({ n, label, className }: { n: number; label: string; className: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums ${className}`}>
      {n} {label}
    </span>
  );
}

function StructureCard({
  structure: ss,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  onDuplicate,
  isDeleting,
}: {
  structure: any;
  expanded: boolean;
  onToggle: () => void;
  onEdit: (ss: any, comps: any[]) => void;
  onDelete: (ss: any) => void;
  onDuplicate: (ss: any) => void;
  isDeleting: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { data: compRes } = useQuery({
    queryKey: ["structure-components", ss.id],
    queryFn: () => apiGet<any>(`/salary-structures/${ss.id}/components`),
    // Load eagerly so each card can show its earning/deduction counts even
    // when collapsed (and expanding is then instant from cache).
    enabled: !!ss.id,
  });

  const components = compRes?.data?.data || [];
  const earningCount = components.filter((c: any) => c.type === "earning").length;
  const deductionCount = components.filter((c: any) => c.type === "deduction").length;
  // #362 — show reimbursement count when the structure has any.
  const reimbursementCount = components.filter((c: any) => c.type === "reimbursement").length;
  const locale = i18n.resolvedLanguage || i18n.language || "en";
  const structureName = ss.is_default
    ? t("salaryStructures.defaultStructureName", { defaultValue: ss.name })
    : ss.name;
  const structureDescription = ss.is_default
    ? t("salaryStructures.defaultStructureDescription", { defaultValue: ss.description })
    : ss.description;
  const componentName = (component: any) =>
    t(`salaryStructures.presetNames.${component.code}`, { defaultValue: component.name });

  return (
    <Card className="overflow-hidden transition-shadow hover:shadow-md">
      <CardHeader className="cursor-pointer" onClick={onToggle}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="bg-brand-50 text-brand-600 mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
              <Layers className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="truncate">{structureName}</CardTitle>
                <Badge variant={ss.is_active ? "active" : "inactive"}>
                  {ss.is_active ? t("salaryStructures.active") : t("salaryStructures.inactive")}
                </Badge>
                {/* #162 — coerce tinyint(1) to boolean so a literal "0" never renders. */}
                {!!ss.is_default && (
                  <Badge variant="approved">{t("salaryStructures.default")}</Badge>
                )}
              </div>
              {structureDescription && (
                <p className="mt-0.5 truncate text-sm text-gray-500">{structureDescription}</p>
              )}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {components.length === 0 ? (
                  <span className="text-xs text-gray-400">
                    {t("salaryStructures.noComponents")}
                  </span>
                ) : (
                  <>
                    {earningCount > 0 && (
                      <CountPill
                        n={earningCount}
                        label={t("salaryStructures.counts.earningLabel", {
                          count: earningCount,
                        })}
                        className="bg-emerald-50 text-emerald-700"
                      />
                    )}
                    {deductionCount > 0 && (
                      <CountPill
                        n={deductionCount}
                        label={t("salaryStructures.counts.deductionLabel", {
                          count: deductionCount,
                        })}
                        className="bg-rose-50 text-rose-700"
                      />
                    )}
                    {reimbursementCount > 0 && (
                      <CountPill
                        n={reimbursementCount}
                        label={t("salaryStructures.types.reimbursementShort")}
                        className="bg-sky-50 text-sky-700"
                      />
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
            {/* Duplicate works without preloading components — server copies line items */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDuplicate(ss)}
              title={t("salaryStructures.duplicate")}
              aria-label={t("salaryStructures.duplicateAria")}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
            {expanded && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEdit(ss, components)}
                  title={t("salaryStructures.edit")}
                  aria-label={t("salaryStructures.editAria")}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                {!ss.is_default && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDelete(ss)}
                    loading={isDeleting}
                    className="text-red-400 hover:text-red-600"
                    title={t("salaryStructures.delete")}
                    aria-label={t("salaryStructures.deleteAria")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggle}
              aria-label={expanded ? t("salaryStructures.collapse") : t("salaryStructures.expand")}
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent>
          {components.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-gray-100">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
                    <th className="px-4 py-2.5 font-semibold">
                      {t("salaryStructures.columns.component")}
                    </th>
                    <th className="px-4 py-2.5 font-semibold">
                      {t("salaryStructures.columns.code")}
                    </th>
                    <th className="px-4 py-2.5 font-semibold">
                      {t("salaryStructures.columns.type")}
                    </th>
                    <th className="px-4 py-2.5 font-semibold">
                      {t("salaryStructures.columns.calculation")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {components.map((c: any) => (
                    <tr key={c.id} className="transition-colors hover:bg-gray-50/70">
                      <td className="px-4 py-2.5 font-medium text-gray-900">{componentName(c)}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{c.code}</td>
                      <td className="px-4 py-2.5">
                        <Badge
                          variant={
                            c.type === "earning"
                              ? "approved"
                              : c.type === "deduction"
                                ? "pending"
                                : "draft"
                          }
                        >
                          {t(`salaryStructures.types.${c.type}`, { defaultValue: c.type })}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-gray-600">
                        {c.calculation_type === "percentage" && c.percentage_of
                          ? t("salaryStructures.calculationText.percentageOf", {
                              value: c.value,
                              base: c.percentage_of,
                            })
                          : c.calculation_type === "fixed" && Number(c.value) > 0
                            ? t("salaryStructures.calculationText.fixed", {
                                value: Number(c.value).toLocaleString(locale),
                              })
                            : c.calculation_type === "per_night"
                              ? t("salaryStructures.calculationText.perNight", {
                                  value: Number(c.value).toLocaleString(locale),
                                })
                              : c.calculation_type === "per_night_daily"
                                ? t("salaryStructures.calculationText.wholeSalaryNight", {
                                    value: Number(c.value),
                                  })
                                : c.calculation_type === "per_night_pct"
                                  ? t("salaryStructures.calculationText.netPayNight", {
                                      value: Number(c.value),
                                    })
                                  : c.calculation_type === "per_ot"
                                    ? t("salaryStructures.calculationText.perOtDay", {
                                        value: Number(c.value).toLocaleString(locale),
                                      })
                                    : c.calculation_type === "per_ot_daily"
                                      ? t("salaryStructures.calculationText.dayPayOt", {
                                          value: Number(c.value),
                                        })
                                      : t("salaryStructures.calculationText.balancing")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-400">{t("salaryStructures.noComponentsDefined")}</p>
          )}

          {/* Statutory note */}
          <div className="mt-4 rounded bg-gray-50 p-3 text-xs text-gray-500 dark:bg-gray-800">
            {t("salaryStructures.statutoryNote")}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
