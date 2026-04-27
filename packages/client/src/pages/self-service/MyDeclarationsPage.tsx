import { useRef, useState } from "react";
import { z } from "zod";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SelectField } from "@/components/ui/SelectField";
import { Modal } from "@/components/ui/Modal";
import { formatCurrency } from "@/lib/utils";
import { apiGet, apiPost } from "@/api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Upload, FileCheck, Loader2 } from "lucide-react";
import toast from "react-hot-toast";

const SECTIONS = [
  { value: "80C", label: "80C — PPF, ELSS, LIC, etc." },
  { value: "80CCD_1B", label: "80CCD(1B) — NPS" },
  { value: "80D", label: "80D — Medical Insurance" },
  { value: "80E", label: "80E — Education Loan Interest" },
  { value: "80G", label: "80G — Donations" },
  { value: "80TTA", label: "80TTA — Savings Interest" },
  { value: "HRA", label: "HRA — House Rent" },
];

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_FILE_TYPES = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];

// Per-item validation — non-negative amount per bug #31
const declarationItemSchema = z.object({
  section: z.string().min(1, "Please select a section"),
  description: z.string().trim().min(1, "Please fill this field"),
  declaredAmount: z
    .number({ invalid_type_error: "Please enter a valid amount" })
    .nonnegative("Amount cannot be negative"),
});

// Wizard validation — non-negative amounts per bug #34
const wizardAmountSchema = z
  .number({ invalid_type_error: "Please enter a valid amount" })
  .nonnegative("Amount cannot be negative");

type FieldErrors = Partial<Record<"section" | "description" | "amount" | "proof", string>>;

export function MyDeclarationsPage() {
  const [showAdd, setShowAdd] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const { data: res, isLoading } = useQuery({
    queryKey: ["my-declarations"],
    queryFn: () => apiGet<any>("/self-service/tax/declarations"),
  });

  const declarations = res?.data?.data || [];
  const totalDeclared = declarations.reduce(
    (s: number, d: any) => s + Number(d.declared_amount || 0),
    0,
  );
  const totalApproved = declarations.reduce(
    (s: number, d: any) => s + Number(d.approved_amount || 0),
    0,
  );

  function resetAddForm() {
    setFieldErrors({});
    setProofFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function closeAdd() {
    resetAddForm();
    setShowAdd(false);
  }

  function closeWizard() {
    setFieldErrors({});
    setShowWizard(false);
  }

  function validateFile(file: File): string | null {
    if (file.size > MAX_FILE_BYTES) return "File is larger than 5MB";
    if (!ALLOWED_FILE_TYPES.includes(file.type)) return "Only PDF, JPG or PNG files are allowed";
    return null;
  }

  function handleFileSelected(file: File | null) {
    if (!file) {
      setProofFile(null);
      return;
    }
    const err = validateFile(file);
    if (err) {
      toast.error(err);
      setFieldErrors((prev) => ({ ...prev, proof: err }));
      setProofFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setProofFile(file);
    setFieldErrors((prev) => ({ ...prev, proof: undefined }));
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelected(file);
  }

  function onDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  }

  function onDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function onDropzoneKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openFilePicker();
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    // Coerce amount — empty string → NaN so zod catches it
    const amountRaw = fd.get("amount");
    const amountNum = amountRaw === null || amountRaw === "" ? NaN : Number(amountRaw);

    const payload = {
      section: (fd.get("section") as string) || "",
      description: ((fd.get("description") as string) || "").trim(),
      declaredAmount: amountNum,
    };

    // Client-side validation (#33 — clear per-field errors instead of throw)
    const parsed = declarationItemSchema.safeParse(payload);
    const errors: FieldErrors = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === "section") errors.section = issue.message;
        else if (field === "description") errors.description = issue.message;
        else if (field === "declaredAmount") errors.amount = issue.message;
      }
    }
    // Proof upload is not yet wired up server-side (the route just returns
    // a placeholder), so don't block submission on missing proof — that
    // was preventing employees from submitting declarations at all (#201).
    // We still validate the file's type/size at selection time.

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      const firstMsg = errors.section || errors.description || errors.amount || errors.proof;
      if (firstMsg) toast.error(firstMsg);
      return;
    }

    setFieldErrors({});
    setSubmitting(true);

    try {
      const now = new Date();
      const fy =
        now.getMonth() >= 3
          ? `${now.getFullYear()}-${now.getFullYear() + 1}`
          : `${now.getFullYear() - 1}-${now.getFullYear()}`;

      await apiPost("/self-service/tax/declarations", {
        financialYear: fy,
        declarations: [payload],
      });
      toast.success("Declaration submitted");
      resetAddForm();
      setShowAdd(false);
      qc.invalidateQueries({ queryKey: ["my-declarations"] });
    } catch (err: any) {
      // #137 — surface server validation detail messages (e.g. per-field zod
      // errors from the submitDeclarationSchema middleware) instead of just
      // the generic top-level message, so the user can actually fix their input.
      const resp = err?.response?.data?.error;
      const detailMsgs = resp?.details
        ? Object.values(resp.details as Record<string, string[]>)
            .flat()
            .join(", ")
        : "";
      const msg = detailMsgs || resp?.message || err?.message || "Failed to submit declaration";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleWizardSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const now = new Date();
    const fy =
      now.getMonth() >= 3
        ? `${now.getFullYear()}-${now.getFullYear() + 1}`
        : `${now.getFullYear() - 1}-${now.getFullYear()}`;

    const decs: { section: string; description: string; declaredAmount: number }[] = [];
    const wizardErrors: Record<string, string> = {};

    for (const s of SECTIONS) {
      const raw = fd.get(`wizard_${s.value}`);
      if (raw === null || raw === "") continue; // blank is allowed — skip
      const amt = Number(raw);
      const parsed = wizardAmountSchema.safeParse(amt);
      if (!parsed.success) {
        wizardErrors[s.value] = parsed.error.issues[0]?.message || "Invalid amount";
        continue;
      }
      if (amt > 0) {
        decs.push({
          section: s.value,
          description: s.label.split("—")[1]?.trim() || s.value,
          declaredAmount: amt,
        });
      }
    }

    if (Object.keys(wizardErrors).length > 0) {
      const firstKey = Object.keys(wizardErrors)[0];
      toast.error(`${firstKey}: ${wizardErrors[firstKey]}`);
      return;
    }
    if (decs.length === 0) {
      toast.error("Enter at least one amount");
      return;
    }

    setSubmitting(true);
    try {
      await apiPost("/self-service/tax/declarations", {
        financialYear: fy,
        declarations: decs,
      });
      toast.success(`${decs.length} declaration${decs.length === 1 ? "" : "s"} submitted`);
      setShowWizard(false);
      qc.invalidateQueries({ queryKey: ["my-declarations"] });
    } catch (err: any) {
      // #35 — surface the real server error instead of swallowing it
      const resp = err?.response?.data?.error;
      const detailMsgs = resp?.details
        ? Object.values(resp.details as Record<string, string[]>)
            .flat()
            .join(", ")
        : "";
      const msg = detailMsgs || resp?.message || err?.message || "Failed to submit declarations";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tax Declarations"
        description="FY 2025-26 — Submit investment proofs and claims"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowWizard(true)}>
              Quick Declare All
            </Button>
            <Button size="sm" onClick={() => setShowAdd(true)}>
              <Plus className="h-4 w-4" /> New Declaration
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-gray-500">Total Declared</p>
            <p className="text-xl font-bold text-gray-900">{formatCurrency(totalDeclared)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-gray-500">Total Approved</p>
            <p className="text-xl font-bold text-green-600">{formatCurrency(totalApproved)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-gray-500">Pending Approval</p>
            <p className="text-xl font-bold text-orange-600">
              {formatCurrency(totalDeclared - totalApproved)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Declarations</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="text-brand-600 h-6 w-6 animate-spin" />
            </div>
          ) : declarations.length === 0 ? (
            <div className="py-12 text-center text-gray-400">
              No declarations yet. Click "New Declaration" to submit your first investment proof.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left">
                  <th className="px-6 py-3 font-medium text-gray-500">Section</th>
                  <th className="px-6 py-3 font-medium text-gray-500">Description</th>
                  <th className="px-6 py-3 font-medium text-gray-500">Declared</th>
                  <th className="px-6 py-3 font-medium text-gray-500">Approved</th>
                  <th className="px-6 py-3 font-medium text-gray-500">Proof</th>
                  <th className="px-6 py-3 font-medium text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {declarations.map((d: any) => (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-mono text-xs text-gray-500">{d.section}</td>
                    <td className="px-6 py-3 text-gray-900">{d.description}</td>
                    <td className="px-6 py-3">{formatCurrency(d.declared_amount)}</td>
                    <td className="px-6 py-3">
                      {Number(d.approved_amount) > 0 ? formatCurrency(d.approved_amount) : "—"}
                    </td>
                    <td className="px-6 py-3">
                      {d.proof_submitted ? (
                        <FileCheck className="h-4 w-4 text-green-500" />
                      ) : (
                        <Button variant="ghost" size="sm">
                          <Upload className="h-3 w-3" /> Upload
                        </Button>
                      )}
                    </td>
                    <td className="px-6 py-3">
                      <Badge variant={d.approval_status}>{d.approval_status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Quick Declare Wizard */}
      <Modal
        open={showWizard}
        onClose={closeWizard}
        title="Quick Tax Declaration"
        description="Declare all your investments in one go"
        className="max-w-2xl"
      >
        <form className="space-y-4" onSubmit={handleWizardSubmit}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {SECTIONS.map((s) => (
              <div key={s.value} className="rounded-lg border border-gray-200 p-3">
                <label
                  className="mb-1 block text-xs font-medium text-gray-500"
                  htmlFor={`wizard_${s.value}`}
                >
                  {s.label}
                </label>
                <input
                  id={`wizard_${s.value}`}
                  type="number"
                  name={`wizard_${s.value}`}
                  placeholder="0"
                  min="0"
                  step="1"
                  className="focus:border-brand-500 focus:ring-brand-500 w-full rounded border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-1"
                />
              </div>
            ))}
          </div>
          <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-700 dark:bg-blue-950 dark:text-blue-300">
            Tip: Under Section 80C you can claim up to ₹1,50,000 for PPF, ELSS, LIC, etc. NPS under
            80CCD(1B) gives an additional ₹50,000 deduction.
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="outline" type="button" onClick={closeWizard}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Submit All Declarations
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={showAdd} onClose={closeAdd} title="New Declaration">
        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          <SelectField
            id="section"
            name="section"
            label="Section"
            options={SECTIONS}
            error={fieldErrors.section}
          />
          <Input
            id="description"
            name="description"
            label="Description"
            placeholder="e.g. PPF Contribution"
            error={fieldErrors.description}
          />
          <Input
            id="amount"
            name="amount"
            label="Amount"
            type="number"
            min="0"
            step="1"
            placeholder="150000"
            error={fieldErrors.amount}
          />
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Proof Document <span className="text-xs font-normal text-gray-400">(optional)</span>
            </label>
            <div
              role="button"
              tabIndex={0}
              aria-label="Upload proof document"
              onClick={openFilePicker}
              onKeyDown={onDropzoneKeyDown}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onDragEnter={onDragOver}
              onDragLeave={onDragLeave}
              className={`mt-1 flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors ${
                dragging
                  ? "border-brand-500 bg-brand-50"
                  : fieldErrors.proof
                    ? "border-red-500 bg-red-50"
                    : "hover:border-brand-400 border-gray-300 hover:bg-gray-50"
              }`}
            >
              <div className="text-center">
                <Upload className="mx-auto h-8 w-8 text-gray-400" />
                {proofFile ? (
                  <>
                    <p className="mt-1 text-sm font-medium text-gray-700">{proofFile.name}</p>
                    <p className="text-xs text-gray-400">
                      {(proofFile.size / 1024).toFixed(1)} KB — click to change
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-sm text-gray-500">Click to upload or drag and drop</p>
                    <p className="text-xs text-gray-400">PDF, JPG up to 5MB</p>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                name="proof"
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                className="hidden"
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => handleFileSelected(e.target.files?.[0] || null)}
              />
            </div>
            {fieldErrors.proof && <p className="mt-1 text-sm text-red-600">{fieldErrors.proof}</p>}
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="outline" type="button" onClick={closeAdd}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Submit Declaration
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
