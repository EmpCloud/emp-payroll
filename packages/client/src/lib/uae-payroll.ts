import type { UaeEmployeeProfile } from "@emp-payroll/shared";

/** UAE API amounts are integer fils; form amounts are decimal AED. */
export function aedToFils(value: string, label = "Amount"): number {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`${label} must be a non-negative AED amount with up to two decimal places.`);
  }
  const [whole, fraction = ""] = normalized.split(".");
  const fils = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(fils)) throw new Error(`${label} is too large.`);
  return fils;
}

export function filsToAed(value: number | null | undefined): string {
  return value == null ? "" : (value / 100).toFixed(2);
}

export function assertUaeFormValues(value: unknown, path = "UAE payroll") {
  if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) {
    throw new Error(`${path}: enter a valid non-negative number.`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertUaeFormValues(item, `${path} ${index + 1}`));
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => {
      const label = key.replace(/([A-Z])/g, " $1").toLowerCase();
      if (typeof item === "string" && /(?:Date|On|From|To|asOf)$/.test(key) && item) {
        const date = new Date(`${item}T00:00:00Z`);
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(item) ||
          !Number.isFinite(date.getTime()) ||
          date.toISOString().slice(0, 10) !== item
        ) {
          throw new Error(`${label}: enter a valid date.`);
        }
      }
      assertUaeFormValues(item, `${path}: ${label}`);
    });
  }
}

export function assertUaeProfile(profile: UaeEmployeeProfile) {
  assertUaeFormValues(profile);
  if (!profile.effectiveFrom) throw new Error("Enter the UAE profile’s effective date.");
  if (!/^[A-Z]{2}$/.test(profile.nationality))
    throw new Error("Enter the employee’s two-letter nationality country code.");
  if (profile.basicSalary <= 0) throw new Error("Monthly basic salary must be greater than zero.");
  if (profile.normalDailyHours <= 0 || profile.normalDailyHours > 12)
    throw new Error("Normal daily working hours must be greater than 0 and no more than 12.");
  if (profile.allowances.some((allowance) => !allowance.name.trim()))
    throw new Error("Enter a name for each fixed allowance.");
}

export function isUaeEmployeeForPeriod(
  employee: {
    status: string;
    employment_type: string;
    start_date: string;
    end_date?: string | null;
  },
  month: number,
  year: number,
): boolean {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return (
    ["eor", "direct_hire"].includes(employee.employment_type) &&
    ["active", "offboarding", "terminated"].includes(employee.status) &&
    employee.start_date?.slice(0, 10) <= end &&
    (!employee.end_date || employee.end_date.slice(0, 10) >= start)
  );
}

export function uaeEvidenceAmount(
  status: string,
  netSalary: number,
  previousPaidAmount = 0,
): number {
  return status === "paid" ? netSalary : status === "refunded" ? previousPaidAmount : 0;
}

export function uaeDownloadFilename(header: string | undefined, fallback: string): string {
  const match = header?.match(/filename="?([^";]+)"?/i);
  const filename = match?.[1]?.trim();
  return filename && !/[\\/\r\n]/.test(filename) ? filename : fallback;
}

export function saveUaeDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function uaeRequestError(error: unknown): Promise<string> {
  const response = (error as { response?: { data?: unknown } })?.response?.data;
  if (response instanceof Blob) {
    try {
      const body = JSON.parse(await response.text());
      return body?.error?.message || "Unable to download this payroll document.";
    } catch {
      return "Unable to download this payroll document.";
    }
  }
  const body = response as { error?: { message?: string } } | undefined;
  return (
    body?.error?.message || (error instanceof Error ? error.message : "Unable to save UAE payroll.")
  );
}
