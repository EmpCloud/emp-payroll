import { generateUaeSif, UaeReportingError, type UaeSifInput } from "./uae-reporting";

const STANDARD_SOURCE = "https://habibbank.com/uae/downloads/HBZwps_crg.pdf";
const DIB_SOURCE =
  "https://dib.ae/docs/default-source/wps-guidelines/wps-file-format-reference-guide_v1-1.pdf";
const ENBD_SOURCE =
  "https://www.emiratesislamic.ae/-/media/ei/pdfs/business-online/salary-and-utility-payments/ei_businessonline_salary_wps_file_creation_user_guide.pdf";
const RAK_SOURCE = "https://www.rakbank.ae/en/help-centre/support/downloadable-forms";
const HSBC_SOURCE = "https://connect-content.us.hsbc.com/hsbc_pcm/onetime/15_r45_uae_wps_flu.html";

export const UAE_BANK_FORMAT_IDS = [
  "dib-v1.1",
  "mohre-sif",
  "rakbank-sif",
  "emirates-nbd-sif",
  "hsbc-xlsx",
] as const;
export type UaeBankFormat = (typeof UAE_BANK_FORMAT_IDS)[number];

export const UAE_BANK_FORMATS = [
  {
    id: "dib-v1.1",
    label: "Dubai Islamic Bank — SIF v1.1",
    available: true,
    requirement:
      "Published DIB v1.1 layout. Confirm current bank acceptance; EVP is included when variable pay is present.",
    source: DIB_SOURCE,
  },
  {
    id: "mohre-sif",
    label: "MoHRE standard SIF",
    available: true,
    requirement:
      "CBUAE WPS-CRG01 v3.0.0 naming and EDR/SCR layout: 13-digit employer, 14-digit employee, 25-character filename stem. Enable EVP only if accepted by the receiving bank.",
    source: STANDARD_SOURCE,
  },
  {
    id: "rakbank-sif",
    label: "RAKBANK — standard SIF",
    available: true,
    requirement:
      "Standard CBUAE SIF with 14-digit employee IDs. Confirm this standard layout with RAKBANK; a proprietary converter header or filename has not been verified.",
    source: RAK_SOURCE,
  },
  {
    id: "emirates-nbd-sif",
    label: "Emirates NBD — CSV / SIF",
    available: true,
    requirement:
      "Emirates NBD group published SIF guide: CSV records, .sif extension, 13-digit employer, mandatory EVP when variable pay is present. Confirm current bank acceptance.",
    source: ENBD_SOURCE,
  },
  {
    id: "hsbc-xlsx",
    label: "HSBC — XLSX (template required)",
    available: false,
    requirement:
      "Export disabled. Supply the current bank-approved HSBC 44-column XLSX template and complete field mapping, including required fields, sheet/header names, formats, filename rules and notification recipients. The public HSBC guide verifies only the seven EVP allowance fields; it does not define the complete workbook.",
    source: HSBC_SOURCE,
  },
] as const satisfies ReadonlyArray<{
  id: UaeBankFormat;
  label: string;
  available: boolean;
  requirement: string;
  source: string;
}>;

export interface UaeBankExportInput extends Omit<UaeSifInput, "version"> {
  bankFormat: UaeBankFormat;
}

export interface UaeBankExportResult {
  filename: string;
  content: string | Buffer;
  contentType: string;
  bankFormat: UaeBankFormat;
  employeeCount: number;
  totalPayment: number;
  currency: "AED";
  excluded: { employeeId: string; reason: string }[];
  warnings: string[];
  paymentStatus: "not_confirmed";
}

function paddedIdentifier(value: unknown, width: number, label: string): string {
  if (typeof value !== "string" || !new RegExp(`^[0-9]{1,${width}}$`).test(value)) {
    throw new UaeReportingError(
      "UAE_BANK_IDENTIFIER_INVALID",
      `${label} must contain 1 to ${width} digits; shorter identifiers are padded with leading zeros. Do not truncate an identifier or convert it through a numeric spreadsheet cell.`,
    );
  }
  return value.padStart(width, "0");
}

/**
 * Bank selection changes only the published interchange profile, never approved pay amounts.
 * Sources are versioned historical specifications, not a promise of current portal acceptance.
 * WPS-CRG01 §§6.3.1/6.6 specifies ASCII CSV + CRLF and a 13+6+6 filename stem.
 * The group guide requires EVP only with variable pay; HSBC's 2015 notice documents the
 * seven EVP categories but is insufficient to implement a 44-column XLSX workbook.
 */
export function exportUaeBankFile(input: UaeBankExportInput): UaeBankExportResult {
  const profile = UAE_BANK_FORMATS.find((entry) => entry.id === input.bankFormat);
  if (!profile)
    throw new UaeReportingError(
      "UAE_BANK_FORMAT_INVALID",
      "Select a supported UAE bank export profile.",
    );
  if (!profile.available)
    throw new UaeReportingError("UAE_BANK_TEMPLATE_REQUIRED", profile.requirement);
  if (input.includeEvp !== undefined && typeof input.includeEvp !== "boolean") {
    throw new UaeReportingError("UAE_BANK_EVP_INVALID", "The EVP selection must be a boolean.");
  }
  const strictIds = input.bankFormat !== "dib-v1.1";
  const employerId = strictIds
    ? paddedIdentifier(input.employerId, 13, "Employer labour-authority ID")
    : input.employerId;
  const items = strictIds
    ? input.items.map((snapshot) =>
        snapshot.wps?.scope === "mohre"
          ? {
              ...snapshot,
              wps: {
                ...snapshot.wps,
                employeeId: paddedIdentifier(
                  snapshot.wps.employeeId,
                  14,
                  "Employee labour-authority ID",
                ),
              },
            }
          : snapshot,
      )
    : input.items;
  const requireEvp = input.bankFormat === "dib-v1.1" || input.bankFormat === "emirates-nbd-sif";
  if (
    requireEvp &&
    input.includeEvp === false &&
    items.some((item) => item.wps?.scope === "mohre" && item.wps.variableIncome > 0)
  ) {
    throw new UaeReportingError(
      "UAE_BANK_EVP_REQUIRED",
      "This selected bank profile requires an EVP record when an employee has variable pay.",
    );
  }
  const includeEvp = input.includeEvp ?? requireEvp;
  if (
    input.bankFormat === "emirates-nbd-sif" &&
    !["302620122", "703420114"].includes(input.employerRoutingCode)
  ) {
    throw new UaeReportingError(
      "UAE_BANK_ROUTING_MISMATCH",
      "The Emirates NBD group profile requires employer routing 302620122 (Emirates NBD) or 703420114 (Emirates Islamic). Employee routing codes may belong to other banks.",
    );
  }
  if (input.bankFormat === "rakbank-sif" && input.employerRoutingCode !== "604060101") {
    throw new UaeReportingError(
      "UAE_BANK_ROUTING_MISMATCH",
      "The RAKBANK profile requires employer routing 604060101. Confirm the registered routing code with the bank.",
    );
  }
  const file = generateUaeSif({ ...input, employerId, items, includeEvp, version: "dib-v1.1" });
  const warnings: string[] = [
    profile.requirement,
    "Downloading this file does not submit it to a bank or confirm payment. Reconcile the bank's actual disbursement evidence.",
  ];
  if (file.excluded.length)
    warnings.push(
      `${file.excluded.length} employee(s) excluded from WPS: see the export exclusions for documented exemptions or employment outside MoHRE.`,
    );
  if (includeEvp && !requireEvp)
    warnings.push(
      "EVP extension selected; confirm the receiving bank accepts these additional records.",
    );
  return {
    filename: strictIds ? file.filename.replace(/\.SIF$/, ".sif") : file.filename,
    content: file.content,
    contentType: "text/plain; charset=us-ascii",
    bankFormat: input.bankFormat,
    employeeCount: file.employeeCount,
    totalPayment: file.totalPayment,
    currency: file.currency,
    excluded: file.excluded,
    warnings,
    paymentStatus: file.paymentStatus,
  };
}
