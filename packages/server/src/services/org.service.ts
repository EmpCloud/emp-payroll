// ============================================================================
// ORG SERVICE — Dual-DB model
// Org identity from EmpCloud. Payroll-specific settings from payroll DB.
// ============================================================================

import { getDB } from "../db/adapters";
import { AppError } from "../api/middleware/error.middleware";
import { findOrgById, getEmpCloudDB, EmpCloudOrganization } from "../db/empcloud";
import { v4 as uuidv4 } from "uuid";

export class OrgService {
  private payrollDb = getDB();

  /**
   * List organizations from EmpCloud (active only).
   */
  async list() {
    const db = getEmpCloudDB();
    const orgs = await db("organizations").where({ is_active: true });
    return {
      data: orgs,
      total: orgs.length,
      page: 1,
      limit: orgs.length,
      totalPages: 1,
    };
  }

  /**
   * Get org by EmpCloud ID — merges EmpCloud org with payroll settings.
   */
  async getById(empcloudOrgId: number) {
    const ecOrg = await findOrgById(empcloudOrgId);
    if (!ecOrg) throw new AppError(404, "NOT_FOUND", "Organization not found");

    // Get payroll-specific settings
    const payrollSettings = await this.payrollDb.findOne<any>("organization_payroll_settings", {
      empcloud_org_id: empcloudOrgId,
    });

    return {
      // EmpCloud identity
      empcloudOrgId: ecOrg.id,
      name: ecOrg.name,
      legalName: ecOrg.legal_name,
      email: ecOrg.email,
      contactNumber: ecOrg.contact_number,
      timezone: ecOrg.timezone,
      country: ecOrg.country,
      state: ecOrg.state,
      city: ecOrg.city,
      isActive: ecOrg.is_active,
      // Payroll settings
      payrollSettingsId: payrollSettings?.id || null,
      pan: payrollSettings?.pan || null,
      tan: payrollSettings?.tan || null,
      gstin: payrollSettings?.gstin || null,
      pfEstablishmentCode: payrollSettings?.pf_establishment_code || null,
      esiEstablishmentCode: payrollSettings?.esi_establishment_code || null,
      ptRegistrationNumber: payrollSettings?.pt_registration_number || null,
      registeredAddress: payrollSettings?.registered_address
        ? typeof payrollSettings.registered_address === "string"
          ? JSON.parse(payrollSettings.registered_address)
          : payrollSettings.registered_address
        : null,
      payFrequency: payrollSettings?.pay_frequency || "monthly",
      payDay: payrollSettings?.pay_day ?? 7,
      financialYearStart: payrollSettings?.financial_year_start || 4,
      currency: payrollSettings?.currency || "INR",
      // Company logo (migration 037) — relative upload path; the client
      // builds a display URL and the payslip renderer inlines the file.
      logoPath: payrollSettings?.logo_path || null,
    };
  }

  /**
   * Create org — creates in EmpCloud + payroll settings.
   */
  async create(data: any) {
    const db = getEmpCloudDB();

    // Create in EmpCloud
    const [orgId] = await db("organizations").insert({
      name: data.name,
      legal_name: data.legalName || data.name,
      email: data.email || null,
      contact_number: data.contactNumber || null,
      timezone: data.timezone || null,
      country: data.country || "IN",
      state: data.state || null,
      city: data.city || null,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    });

    // Create payroll settings
    await this.payrollDb.create("organization_payroll_settings", {
      id: uuidv4(),
      empcloud_org_id: orgId,
      name: data.name,
      legal_name: data.legalName || data.name,
      pan: data.pan || null,
      tan: data.tan || null,
      gstin: data.gstin || null,
      pf_establishment_code: data.pfEstablishmentCode || null,
      esi_establishment_code: data.esiEstablishmentCode || null,
      pt_registration_number: data.ptRegistrationNumber || null,
      registered_address: data.registeredAddress ? JSON.stringify(data.registeredAddress) : null,
      state: data.state || null,
      currency: data.currency || "INR",
      country: data.country || "IN",
      pay_frequency: "monthly",
      financial_year_start: 4,
      is_active: true,
    });

    return this.getById(orgId);
  }

  /**
   * Update org — updates EmpCloud org + payroll settings.
   */
  async update(empcloudOrgId: number, data: any) {
    const ecOrg = await findOrgById(empcloudOrgId);
    if (!ecOrg) throw new AppError(404, "NOT_FOUND", "Organization not found");

    const db = getEmpCloudDB();

    // Update EmpCloud fields
    const ecUpdates: any = {};
    if (data.name) ecUpdates.name = data.name;
    if (data.legalName) ecUpdates.legal_name = data.legalName;
    if (data.email) ecUpdates.email = data.email;
    if (data.state) ecUpdates.state = data.state;
    if (data.timezone) ecUpdates.timezone = data.timezone;

    if (Object.keys(ecUpdates).length > 0) {
      ecUpdates.updated_at = new Date();
      await db("organizations").where({ id: empcloudOrgId }).update(ecUpdates);
    }

    // Update payroll settings
    const payrollSettings = await this.payrollDb.findOne<any>("organization_payroll_settings", {
      empcloud_org_id: empcloudOrgId,
    });

    if (payrollSettings) {
      const prUpdates: any = {};
      if (data.name) prUpdates.name = data.name;
      if (data.legalName) prUpdates.legal_name = data.legalName;
      // #194 — pan and tan were silently dropped on update (only create
      // wrote them), so the Settings page toasted "saved" but the values
      // disappeared on the next refresh. Persist them here too.
      if (data.pan) prUpdates.pan = data.pan;
      if (data.tan) prUpdates.tan = data.tan;
      if (data.gstin) prUpdates.gstin = data.gstin;
      if (data.pfEstablishmentCode) prUpdates.pf_establishment_code = data.pfEstablishmentCode;
      if (data.esiEstablishmentCode) prUpdates.esi_establishment_code = data.esiEstablishmentCode;
      if (data.ptRegistrationNumber) prUpdates.pt_registration_number = data.ptRegistrationNumber;
      if (data.registeredAddress)
        prUpdates.registered_address = JSON.stringify(data.registeredAddress);
      if (data.state) prUpdates.state = data.state;

      if (Object.keys(prUpdates).length > 0) {
        await this.payrollDb.update("organization_payroll_settings", payrollSettings.id, prUpdates);
      }
    }

    return this.getById(empcloudOrgId);
  }

  /**
   * Get payroll-specific settings for an org.
   */
  async getSettings(empcloudOrgId: number) {
    const org = await this.getById(empcloudOrgId);
    // Pull the migration-029 statutory override columns from the raw row
    // (camelCase serialiser doesn't always surface new columns until the
    // model is regenerated, and the values are nullable opt-ins anyway).
    const raw = await this.payrollDb.findOne<any>("organization_payroll_settings", {
      empcloud_org_id: empcloudOrgId,
    });
    const num = (v: unknown): number | null =>
      v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null;
    return {
      payFrequency: org.payFrequency,
      payDay: (org as any).payDay ?? 7,
      financialYearStart: org.financialYearStart,
      currency: org.currency,
      country: org.country,
      state: org.state,
      pfEstablishmentCode: org.pfEstablishmentCode,
      esiEstablishmentCode: org.esiEstablishmentCode,
      ptRegistrationNumber: org.ptRegistrationNumber,
      // Migration 029 — org-level statutory overrides. NULL means "use
      // the India default constant" so the form can render an "inherit
      // default" state.
      pfApplyFullBasic: raw?.pf_apply_full_basic == null ? null : !!Number(raw.pf_apply_full_basic),
      pfMaxEmployeeContribution: num(raw?.pf_max_employee_contribution),
      pfDefaultEmployeeRate: num(raw?.pf_default_employee_rate),
      esiWageCeiling: num(raw?.esi_wage_ceiling),
      roundingPolicy: raw?.rounding_policy ?? null,
      // Migration 032 — when true, the offer-letter CTC already includes
      // employer PF / ESI / EDLI / admin (typical Indian IT employers).
      // Default false = additive ("CTC = Gross, employer cost on top").
      employerPfInCtc: !!Number(raw?.employer_pf_in_ctc),
      // Migration 034 — employer EDLI / PF Admin charge toggles. Column is
      // NOT NULL DEFAULT true; a missing row (null raw) also defaults true.
      pfEdliEnabled: raw?.pf_edli_enabled == null ? true : !!Number(raw.pf_edli_enabled),
      pfAdminEnabled: raw?.pf_admin_enabled == null ? true : !!Number(raw.pf_admin_enabled),
      // Migration 035 — count weekends as working days in payroll. Column is
      // NOT NULL DEFAULT false; a missing row also defaults false (the
      // long-standing weekday-only behaviour).
      includeWeekendsInWorkingDays: !!Number(raw?.include_weekends_in_working_days),
      // Migration 036 — org-wide kill-switch for Professional Tax. Column is
      // NOT NULL DEFAULT false; a missing row also defaults false (PT
      // computes normally per the per-employee gate + state slab).
      ptDisabled: !!Number(raw?.pt_disabled),
      // Migration 037 — company logo path for payslips.
      logoPath: raw?.logo_path || null,
    };
  }

  /**
   * Set (or replace) the org's payslip logo. `logoPath` is the relative
   * upload path (e.g. `/uploads/<uuid>.png`); pass null to clear it.
   * Auto-provisions the settings row if missing.
   */
  async setLogo(empcloudOrgId: number, logoPath: string | null) {
    const settings = await this.ensureSettings(empcloudOrgId);
    await this.payrollDb.update("organization_payroll_settings", settings.id, {
      logo_path: logoPath,
    });
    return { logoPath };
  }

  /**
   * Update payroll-specific settings.
   */
  async updateSettings(empcloudOrgId: number, data: any) {
    // Auto-provision the settings row when it's missing instead of 404'ing.
    // Orgs created before the SSO auto-provision (auth.service
    // ensureOrgPayrollSettings) existed — or any org whose first interaction
    // with payroll is the Settings page — have no organization_payroll_settings
    // row yet, and saving settings should just work rather than fail with
    // "Payroll settings not found for this organization".
    const payrollSettings = await this.ensureSettings(empcloudOrgId);

    const updates: any = {};
    if (data.payFrequency) updates.pay_frequency = data.payFrequency;
    if (data.payDay !== undefined) updates.pay_day = data.payDay;
    if (data.state) updates.state = data.state;
    if (data.pfEstablishmentCode) updates.pf_establishment_code = data.pfEstablishmentCode;
    if (data.esiEstablishmentCode) updates.esi_establishment_code = data.esiEstablishmentCode;
    if (data.ptRegistrationNumber) updates.pt_registration_number = data.ptRegistrationNumber;

    // Migration 029 — explicit `null` clears the override so the org
    // returns to the India default. `undefined` means "don't touch".
    if (data.pfApplyFullBasic !== undefined) {
      updates.pf_apply_full_basic = data.pfApplyFullBasic == null ? null : !!data.pfApplyFullBasic;
    }
    if (data.pfMaxEmployeeContribution !== undefined) {
      updates.pf_max_employee_contribution =
        data.pfMaxEmployeeContribution == null ? null : Number(data.pfMaxEmployeeContribution);
    }
    if (data.pfDefaultEmployeeRate !== undefined) {
      updates.pf_default_employee_rate =
        data.pfDefaultEmployeeRate == null ? null : Number(data.pfDefaultEmployeeRate);
    }
    if (data.esiWageCeiling !== undefined) {
      updates.esi_wage_ceiling = data.esiWageCeiling == null ? null : Number(data.esiWageCeiling);
    }
    if (data.roundingPolicy !== undefined) {
      updates.rounding_policy = data.roundingPolicy || null;
    }
    if (data.employerPfInCtc !== undefined) {
      updates.employer_pf_in_ctc = !!data.employerPfInCtc;
    }

    // Migration 034 — EDLI / PF Admin charge toggles. Plain booleans, no
    // "clear to default" state: the column is NOT NULL, so we coerce.
    if (data.pfEdliEnabled !== undefined) {
      updates.pf_edli_enabled = !!data.pfEdliEnabled;
    }
    if (data.pfAdminEnabled !== undefined) {
      updates.pf_admin_enabled = !!data.pfAdminEnabled;
    }

    // Migration 035 — include weekends in payroll working days.
    if (data.includeWeekendsInWorkingDays !== undefined) {
      updates.include_weekends_in_working_days = !!data.includeWeekendsInWorkingDays;
    }

    // Migration 036 — disable Professional Tax org-wide.
    if (data.ptDisabled !== undefined) {
      updates.pt_disabled = !!data.ptDisabled;
    }

    if (Object.keys(updates).length > 0) {
      await this.payrollDb.update("organization_payroll_settings", payrollSettings.id, updates);
    }

    return this.getSettings(empcloudOrgId);
  }

  // -----------------------------------------------------------------------
  // RAZORPAYX integration (Phase 1A — config + Test Connection)
  // -----------------------------------------------------------------------

  /**
   * Return the org's Razorpay config in a UI-safe shape. Secrets never leave
   * the server — only "do you have one?" booleans + a masked key id come
   * back. The client uses this to render the Razorpay card with a write-only
   * Secret / Webhook Secret field.
   */
  async getRazorpayConfig(empcloudOrgId: number) {
    const { maskKeyId } = await import("../utils/secrets");
    const row = await this.payrollDb.findOne<any>("organization_payroll_settings", {
      empcloud_org_id: empcloudOrgId,
    });
    return {
      enabled: !!Number(row?.razorpay_enabled),
      keyId: row?.razorpay_key_id || "",
      keyIdMasked: maskKeyId(row?.razorpay_key_id),
      accountNumber: row?.razorpay_account_number || "",
      defaultMode: row?.razorpay_default_mode || "IMPS",
      hasKeySecret: !!row?.razorpay_key_secret_enc,
      hasWebhookSecret: !!row?.razorpay_webhook_secret_enc,
      verifiedAt: row?.razorpay_verified_at || null,
    };
  }

  /**
   * Write Razorpay config. Secrets supplied as `null` / `undefined` are
   * preserved (so the admin can update Key ID without re-entering the secret
   * each time). A non-empty secret string overwrites; an explicit empty
   * string `""` clears the stored value.
   *
   * Auto-provisions the settings row when missing (same pattern as setLogo).
   */
  async setRazorpayConfig(
    empcloudOrgId: number,
    data: {
      enabled?: boolean;
      keyId?: string | null;
      keySecret?: string | null;
      accountNumber?: string | null;
      webhookSecret?: string | null;
      defaultMode?: string | null;
    },
  ) {
    const { encryptSecret, isSecretsKeyConfigured } = await import("../utils/secrets");
    // If the operator is touching any encrypted field, the master key must be
    // present. Refuse the write up-front with a clear message rather than
    // failing at the encrypt step.
    const needsKey = data.keySecret || data.webhookSecret;
    if (needsKey && !isSecretsKeyConfigured()) {
      throw new AppError(
        500,
        "SECRETS_KEY_MISSING",
        "PAYROLL_SECRETS_KEY is not set on the server. Generate one with `openssl rand -hex 32` and add it to the payroll .env before saving Razorpay credentials.",
      );
    }
    const settings = await this.ensureSettings(empcloudOrgId);
    const updates: Record<string, any> = {};
    if (data.enabled !== undefined) updates.razorpay_enabled = !!data.enabled;
    if (data.keyId !== undefined) updates.razorpay_key_id = (data.keyId || "").trim() || null;
    if (data.accountNumber !== undefined)
      updates.razorpay_account_number = (data.accountNumber || "").trim() || null;
    if (data.defaultMode !== undefined)
      updates.razorpay_default_mode = (data.defaultMode || "").trim() || null;
    if (typeof data.keySecret === "string") {
      updates.razorpay_key_secret_enc = data.keySecret ? encryptSecret(data.keySecret) : null;
      // Rotating the secret invalidates any prior "verified" stamp.
      updates.razorpay_verified_at = null;
    }
    if (typeof data.webhookSecret === "string") {
      updates.razorpay_webhook_secret_enc = data.webhookSecret
        ? encryptSecret(data.webhookSecret)
        : null;
    }
    if (Object.keys(updates).length > 0) {
      await this.payrollDb.update("organization_payroll_settings", settings.id, updates);
    }
    return this.getRazorpayConfig(empcloudOrgId);
  }

  /**
   * Probe the connection with the currently-saved credentials. Returns the
   * Razorpay mode (test/live) so the UI can warn on a mode mismatch. Stamps
   * `razorpay_verified_at` on success.
   */
  async testRazorpayConnection(empcloudOrgId: number) {
    const { decryptSecret, isSecretsKeyConfigured } = await import("../utils/secrets");
    if (!isSecretsKeyConfigured()) {
      throw new AppError(
        500,
        "SECRETS_KEY_MISSING",
        "PAYROLL_SECRETS_KEY is not set on the server.",
      );
    }
    const row = await this.payrollDb.findOne<any>("organization_payroll_settings", {
      empcloud_org_id: empcloudOrgId,
    });
    if (!row?.razorpay_key_id || !row?.razorpay_key_secret_enc || !row?.razorpay_account_number) {
      throw new AppError(
        400,
        "RAZORPAY_INCOMPLETE",
        "Save Key ID, Key Secret and Source Account Number before testing the connection.",
      );
    }
    let keySecret: string;
    try {
      keySecret = decryptSecret(row.razorpay_key_secret_enc);
    } catch {
      throw new AppError(
        500,
        "SECRET_DECRYPT_FAILED",
        "Could not decrypt the stored Key Secret — the server's PAYROLL_SECRETS_KEY may have changed since the secret was saved. Re-enter the Key Secret and try again.",
      );
    }
    const { RazorpayClient } = await import("./razorpay.service");
    const client = new RazorpayClient({
      keyId: row.razorpay_key_id,
      keySecret,
      accountNumber: row.razorpay_account_number,
    });
    try {
      const result = await client.testConnection();
      await this.payrollDb.update("organization_payroll_settings", row.id, {
        razorpay_verified_at: new Date(),
      });
      return { ok: true, mode: result.mode, verifiedAt: new Date().toISOString() };
    } catch (err: any) {
      const status = Number(err?.status) || 502;
      const code = err?.code || "RAZORPAY_ERROR";
      const message = err?.description || err?.message || "Razorpay connection test failed.";
      throw new AppError(status >= 400 && status < 600 ? status : 502, code, message);
    }
  }

  /**
   * Return the org's payroll settings row, creating a default one (keyed by
   * empcloud_org_id, seeded from the EmpCloud org) when none exists. Mirrors
   * auth.service.ensureOrgPayrollSettings so the Settings page works for orgs
   * provisioned before that auto-create existed.
   */
  private async ensureSettings(empcloudOrgId: number): Promise<any> {
    const existing = await this.payrollDb.findOne<any>("organization_payroll_settings", {
      empcloud_org_id: empcloudOrgId,
    });
    if (existing) return existing;

    const ecOrg = await findOrgById(empcloudOrgId);
    if (!ecOrg) throw new AppError(404, "NOT_FOUND", "Organization not found");

    try {
      return await this.payrollDb.create<any>("organization_payroll_settings", {
        id: uuidv4(),
        empcloud_org_id: empcloudOrgId,
        name: ecOrg.name,
        legal_name: ecOrg.legal_name || ecOrg.name,
        country: ecOrg.country || "IN",
        state: ecOrg.state || null,
        currency: "INR",
        pay_frequency: "monthly",
        financial_year_start: 4,
        is_active: true,
      });
    } catch (err: any) {
      // Race: another request created the row first (empcloud_org_id is unique).
      if (err?.code === "ER_DUP_ENTRY" || err?.errno === 1062) {
        const row = await this.payrollDb.findOne<any>("organization_payroll_settings", {
          empcloud_org_id: empcloudOrgId,
        });
        if (row) return row;
      }
      throw err;
    }
  }
}
