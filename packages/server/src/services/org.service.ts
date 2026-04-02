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
    };
  }

  /**
   * Update payroll-specific settings.
   */
  async updateSettings(empcloudOrgId: number, data: any) {
    const payrollSettings = await this.payrollDb.findOne<any>("organization_payroll_settings", {
      empcloud_org_id: empcloudOrgId,
    });

    if (!payrollSettings) {
      throw new AppError(404, "NOT_FOUND", "Payroll settings not found for this organization");
    }

    const updates: any = {};
    if (data.payFrequency) updates.pay_frequency = data.payFrequency;
    if (data.payDay !== undefined) updates.pay_day = data.payDay;
    if (data.state) updates.state = data.state;
    if (data.pfEstablishmentCode) updates.pf_establishment_code = data.pfEstablishmentCode;
    if (data.esiEstablishmentCode) updates.esi_establishment_code = data.esiEstablishmentCode;
    if (data.ptRegistrationNumber) updates.pt_registration_number = data.ptRegistrationNumber;

    if (Object.keys(updates).length > 0) {
      await this.payrollDb.update("organization_payroll_settings", payrollSettings.id, updates);
    }

    return this.getSettings(empcloudOrgId);
  }
}
