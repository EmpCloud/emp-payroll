import { getDB } from "../db/adapters";
import { AppError } from "../api/middleware/error.middleware";

export class OrgService {
  private db = getDB();

  async list() {
    return this.db.findMany<any>("organizations", { filters: { is_active: true } });
  }

  async getById(id: string) {
    const org = await this.db.findById<any>("organizations", id);
    if (!org) throw new AppError(404, "NOT_FOUND", "Organization not found");
    return org;
  }

  async create(data: any) {
    return this.db.create("organizations", {
      name: data.name,
      legal_name: data.legalName,
      pan: data.pan,
      tan: data.tan,
      gstin: data.gstin || null,
      pf_establishment_code: data.pfEstablishmentCode || null,
      esi_establishment_code: data.esiEstablishmentCode || null,
      pt_registration_number: data.ptRegistrationNumber || null,
      registered_address: JSON.stringify(data.registeredAddress),
      state: data.state,
      currency: data.currency || "INR",
      country: data.country || "IN",
      pay_frequency: "monthly",
      financial_year_start: 4,
      is_active: true,
    });
  }

  async update(id: string, data: any) {
    await this.getById(id);
    const updates: any = {};
    if (data.name) updates.name = data.name;
    if (data.legalName) updates.legal_name = data.legalName;
    if (data.gstin) updates.gstin = data.gstin;
    if (data.pfEstablishmentCode) updates.pf_establishment_code = data.pfEstablishmentCode;
    if (data.esiEstablishmentCode) updates.esi_establishment_code = data.esiEstablishmentCode;
    if (data.registeredAddress) updates.registered_address = JSON.stringify(data.registeredAddress);
    if (data.state) updates.state = data.state;
    return this.db.update("organizations", id, updates);
  }

  async getSettings(id: string) {
    const org = await this.getById(id);
    return {
      payFrequency: org.pay_frequency,
      financialYearStart: org.financial_year_start,
      currency: org.currency,
      country: org.country,
      state: org.state,
      pfEstablishmentCode: org.pf_establishment_code,
      esiEstablishmentCode: org.esi_establishment_code,
      ptRegistrationNumber: org.pt_registration_number,
    };
  }

  async updateSettings(id: string, data: any) {
    await this.getById(id);
    const updates: any = {};
    if (data.payFrequency) updates.pay_frequency = data.payFrequency;
    if (data.state) updates.state = data.state;
    if (data.pfEstablishmentCode) updates.pf_establishment_code = data.pfEstablishmentCode;
    if (data.esiEstablishmentCode) updates.esi_establishment_code = data.esiEstablishmentCode;
    if (data.ptRegistrationNumber) updates.pt_registration_number = data.ptRegistrationNumber;
    return this.db.update("organizations", id, updates);
  }
}
