// ============================================================================
// AUTH SERVICE — authenticates against the EmpCloud master database.
// Password, user, and org data live in EmpCloud.
// Payroll-specific profiles are auto-created on first login.
// ============================================================================

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { getDB } from "../db/adapters";
import {
  findUserByEmail,
  findUserById,
  findOrgById,
  getUserDepartmentName,
  updateUserPassword,
  createUser,
  createOrganization,
  EmpCloudUser,
} from "../db/empcloud";
import { AppError } from "../api/middleware/error.middleware";
import { AuthPayload } from "../api/middleware/auth.middleware";
import { v4 as uuidv4 } from "uuid";

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export class AuthService {
  private payrollDb = getDB();

  // -----------------------------------------------------------------------
  // LOGIN — authenticate against EmpCloud users table
  // -----------------------------------------------------------------------
  async login(email: string, password: string): Promise<{ user: any; tokens: TokenPair }> {
    // 1. Find user in EmpCloud
    const ecUser = await findUserByEmail(email);
    if (!ecUser) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
    }

    if (!ecUser.password) {
      throw new AppError(401, "NO_PASSWORD", "Account has no password set. Contact your admin.");
    }

    // 2. Verify password (bcrypt — compatible with PHP $2y$ and Node $2a$/$2b$)
    const valid = await bcrypt.compare(password, ecUser.password);
    if (!valid) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
    }

    // 3. Get org info from EmpCloud
    const ecOrg = await findOrgById(ecUser.organization_id);
    if (!ecOrg || !ecOrg.is_active) {
      throw new AppError(403, "ORG_INACTIVE", "Your organization account is inactive");
    }

    // 4. Ensure payroll profile exists (auto-create on first login)
    const payrollProfile = await this.ensurePayrollProfile(ecUser, ecOrg);

    // 5. Get department name for response
    const departmentName = await getUserDepartmentName(ecUser.department_id);

    // 6. Build auth payload and generate tokens
    const payload: AuthPayload = {
      empcloudUserId: ecUser.id,
      empcloudOrgId: ecUser.organization_id,
      payrollProfileId: payrollProfile?.id || null,
      role: this.mapRole(ecUser.role),
      email: ecUser.email,
      firstName: ecUser.first_name,
      lastName: ecUser.last_name,
      orgName: ecOrg.name,
    };

    const tokens = this.generateTokens(payload);

    // 7. Return user data (no password)
    const user = {
      id: ecUser.id,
      empcloudUserId: ecUser.id,
      empcloudOrgId: ecUser.organization_id,
      payrollProfileId: payrollProfile?.id || null,
      firstName: ecUser.first_name,
      lastName: ecUser.last_name,
      email: ecUser.email,
      empCode: ecUser.emp_code,
      designation: ecUser.designation,
      department: departmentName,
      role: this.mapRole(ecUser.role),
      orgName: ecOrg.name,
      orgId: ecUser.organization_id,
    };

    return { user, tokens };
  }

  // -----------------------------------------------------------------------
  // REGISTER — create org + user in EmpCloud, payroll profile in payroll DB
  // -----------------------------------------------------------------------
  async register(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    orgName?: string;
    orgId?: number;
  }): Promise<{ user: any; tokens: TokenPair }> {
    // Check if email already exists in EmpCloud
    const existing = await findUserByEmail(data.email);
    if (existing) {
      throw new AppError(409, "EMAIL_EXISTS", "An account with this email already exists");
    }

    const passwordHash = await bcrypt.hash(data.password, 12);

    let orgId = data.orgId;
    let orgName = data.orgName || "My Organization";

    // If no orgId, create a new organization in EmpCloud
    if (!orgId) {
      const ecOrg = await createOrganization({
        name: orgName,
        legal_name: orgName,
        email: data.email,
      });
      orgId = ecOrg.id;
      orgName = ecOrg.name;
    } else {
      const ecOrg = await findOrgById(orgId);
      if (!ecOrg) throw new AppError(404, "ORG_NOT_FOUND", "Organization not found");
      orgName = ecOrg.name;
    }

    // Create user in EmpCloud
    const ecUser = await createUser({
      organization_id: orgId,
      first_name: data.firstName,
      last_name: data.lastName,
      email: data.email,
      password: passwordHash,
      role: data.orgId ? "employee" : "hr_admin",
      emp_code: `EMP-${Date.now()}`,
      date_of_joining: new Date().toISOString().slice(0, 10),
    });

    // Create payroll profile
    const payrollProfile = await this.createPayrollProfile(ecUser);

    const payload: AuthPayload = {
      empcloudUserId: ecUser.id,
      empcloudOrgId: ecUser.organization_id,
      payrollProfileId: payrollProfile.id,
      role: this.mapRole(ecUser.role),
      email: ecUser.email,
      firstName: ecUser.first_name,
      lastName: ecUser.last_name,
      orgName,
    };

    const tokens = this.generateTokens(payload);

    const user = {
      id: ecUser.id,
      empcloudUserId: ecUser.id,
      empcloudOrgId: ecUser.organization_id,
      payrollProfileId: payrollProfile.id,
      firstName: ecUser.first_name,
      lastName: ecUser.last_name,
      email: ecUser.email,
      role: this.mapRole(ecUser.role),
      orgName,
      orgId: ecUser.organization_id,
    };

    return { user, tokens };
  }

  // -----------------------------------------------------------------------
  // SSO LOGIN — exchange EMP Cloud RS256 JWT for Payroll HS256 JWT
  // -----------------------------------------------------------------------
  async ssoLogin(empcloudToken: string): Promise<{ user: any; tokens: TokenPair }> {
    // Decode without verification — user arrived via trusted dashboard redirect
    const decoded = jwt.decode(empcloudToken);
    if (!decoded || typeof decoded === "string") {
      throw new AppError(401, "INVALID_SSO_TOKEN", "Invalid SSO token");
    }

    const userId = Number(decoded.sub);
    if (!userId) {
      throw new AppError(401, "INVALID_SSO_TOKEN", "SSO token missing user id");
    }

    const ecUser = await findUserById(userId);
    if (!ecUser || ecUser.status !== 1) {
      throw new AppError(401, "USER_NOT_FOUND", "User not found or inactive");
    }

    const ecOrg = await findOrgById(ecUser.organization_id);
    if (!ecOrg || !ecOrg.is_active) {
      throw new AppError(403, "ORG_INACTIVE", "Organization is inactive");
    }

    // Ensure payroll profile exists (auto-create on first SSO login)
    const payrollProfile = await this.ensurePayrollProfile(ecUser, ecOrg);

    // Get department name for response
    const departmentName = await getUserDepartmentName(ecUser.department_id);

    const payload: AuthPayload = {
      empcloudUserId: ecUser.id,
      empcloudOrgId: ecUser.organization_id,
      payrollProfileId: payrollProfile?.id || null,
      role: this.mapRole(ecUser.role),
      email: ecUser.email,
      firstName: ecUser.first_name,
      lastName: ecUser.last_name,
      orgName: ecOrg.name,
    };

    const tokens = this.generateTokens(payload);

    const user = {
      id: ecUser.id,
      empcloudUserId: ecUser.id,
      empcloudOrgId: ecUser.organization_id,
      payrollProfileId: payrollProfile?.id || null,
      firstName: ecUser.first_name,
      lastName: ecUser.last_name,
      email: ecUser.email,
      empCode: ecUser.emp_code,
      designation: ecUser.designation,
      department: departmentName,
      role: this.mapRole(ecUser.role),
      orgName: ecOrg.name,
      orgId: ecUser.organization_id,
    };

    return { user, tokens };
  }

  // -----------------------------------------------------------------------
  // REFRESH TOKEN
  // -----------------------------------------------------------------------
  async refreshToken(token: string): Promise<TokenPair> {
    try {
      const payload = jwt.verify(token, config.jwt.secret) as AuthPayload & { type: string };
      if (payload.type !== "refresh") {
        throw new AppError(401, "INVALID_TOKEN", "Not a refresh token");
      }

      // Verify user still exists and is active in EmpCloud
      const ecUser = await findUserById(payload.empcloudUserId);
      if (!ecUser || ecUser.status !== 1) {
        throw new AppError(401, "USER_NOT_FOUND", "User account is inactive or deleted");
      }

      const ecOrg = await findOrgById(ecUser.organization_id);
      const payrollProfile = await this.findPayrollProfile(ecUser.id);

      return this.generateTokens({
        empcloudUserId: ecUser.id,
        empcloudOrgId: ecUser.organization_id,
        payrollProfileId: payrollProfile?.id || null,
        role: this.mapRole(ecUser.role),
        email: ecUser.email,
        firstName: ecUser.first_name,
        lastName: ecUser.last_name,
        orgName: ecOrg?.name || "",
      });
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError(401, "INVALID_TOKEN", "Invalid or expired refresh token");
    }
  }

  // -----------------------------------------------------------------------
  // PASSWORD MANAGEMENT — operates on EmpCloud users table
  // -----------------------------------------------------------------------
  async changePassword(
    empcloudUserId: number,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const ecUser = await findUserById(empcloudUserId);
    if (!ecUser) throw new AppError(404, "NOT_FOUND", "User not found");

    if (ecUser.password) {
      const valid = await bcrypt.compare(currentPassword, ecUser.password);
      if (!valid) throw new AppError(401, "INVALID_PASSWORD", "Current password is incorrect");
    }

    if (newPassword.length < 8) {
      throw new AppError(400, "WEAK_PASSWORD", "Password must be at least 8 characters");
    }

    const hash = await bcrypt.hash(newPassword, 12);
    await updateUserPassword(ecUser.id, hash);
  }

  async adminResetPassword(empcloudUserId: number, newPassword: string): Promise<void> {
    const ecUser = await findUserById(empcloudUserId);
    if (!ecUser) throw new AppError(404, "NOT_FOUND", "User not found");

    const hash = await bcrypt.hash(newPassword || "Welcome@123", 12);
    await updateUserPassword(ecUser.id, hash);
  }

  // In-memory OTP store (use Redis in production)
  private otpStore = new Map<string, { otp: string; expiresAt: number }>();

  async forgotPassword(email: string): Promise<{ message: string }> {
    const ecUser = await findUserByEmail(email);
    // Always return success to prevent email enumeration
    if (!ecUser) return { message: "If the email exists, a reset OTP has been sent" };

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    this.otpStore.set(email, { otp, expiresAt: Date.now() + 15 * 60 * 1000 });

    try {
      const { EmailService } = await import("./email.service");
      const emailSvc = new EmailService();
      await emailSvc.sendRaw({
        to: email,
        subject: "Password Reset OTP — EMP Payroll",
        html: `
          <div style="font-family:sans-serif;max-width:400px;margin:auto;padding:20px;">
            <h2>Password Reset</h2>
            <p>Your OTP to reset your password is:</p>
            <div style="background:#f3f4f6;padding:16px;text-align:center;font-size:32px;font-weight:bold;letter-spacing:8px;border-radius:8px;">
              ${otp}
            </div>
            <p style="color:#6b7280;font-size:14px;margin-top:16px;">This OTP expires in 15 minutes. If you didn't request this, ignore this email.</p>
          </div>
        `,
      });
    } catch {
      console.log(`[DEV] Password reset OTP for ${email}: ${otp}`);
    }

    return { message: "If the email exists, a reset OTP has been sent" };
  }

  async resetPasswordWithOTP(email: string, otp: string, newPassword: string): Promise<void> {
    const stored = this.otpStore.get(email);
    if (!stored || stored.otp !== otp) {
      throw new AppError(400, "INVALID_OTP", "Invalid or expired OTP");
    }
    if (stored.expiresAt < Date.now()) {
      this.otpStore.delete(email);
      throw new AppError(400, "EXPIRED_OTP", "OTP has expired. Request a new one.");
    }

    if (newPassword.length < 8) {
      throw new AppError(400, "WEAK_PASSWORD", "Password must be at least 8 characters");
    }

    const ecUser = await findUserByEmail(email);
    if (!ecUser) throw new AppError(404, "NOT_FOUND", "User not found");

    const hash = await bcrypt.hash(newPassword, 12);
    await updateUserPassword(ecUser.id, hash);
    this.otpStore.delete(email);
  }

  // -----------------------------------------------------------------------
  // PAYROLL PROFILE MANAGEMENT
  // Auto-creates payroll-specific records in the payroll DB on first login.
  // -----------------------------------------------------------------------

  private async findPayrollProfile(empcloudUserId: number): Promise<any | null> {
    return this.payrollDb.findOne<any>("employee_payroll_profiles", {
      empcloud_user_id: empcloudUserId,
    });
  }

  private async ensurePayrollProfile(ecUser: EmpCloudUser, ecOrg: any): Promise<any> {
    // Check if profile already exists
    let profile = await this.findPayrollProfile(ecUser.id);
    if (profile) return profile;

    // Auto-create payroll profile
    profile = await this.createPayrollProfile(ecUser);

    // Also ensure org payroll settings exist
    await this.ensureOrgPayrollSettings(ecOrg);

    return profile;
  }

  private async createPayrollProfile(ecUser: EmpCloudUser): Promise<any> {
    return this.payrollDb.create<any>("employee_payroll_profiles", {
      id: uuidv4(),
      empcloud_user_id: ecUser.id,
      empcloud_org_id: ecUser.organization_id,
      employee_code: ecUser.emp_code,
      bank_details: JSON.stringify({}),
      tax_info: JSON.stringify({ pan: "", regime: "new" }),
      pf_details: JSON.stringify({}),
      esi_details: JSON.stringify({}),
      is_active: true,
    });
  }

  private async ensureOrgPayrollSettings(ecOrg: any): Promise<any> {
    const existing = await this.payrollDb.findOne<any>("organization_payroll_settings", {
      empcloud_org_id: ecOrg.id,
    });
    if (existing) return existing;

    return this.payrollDb.create<any>("organization_payroll_settings", {
      id: uuidv4(),
      empcloud_org_id: ecOrg.id,
      name: ecOrg.name,
      legal_name: ecOrg.legal_name || ecOrg.name,
      country: ecOrg.country || "IN",
      state: ecOrg.state || null,
      currency: "INR",
      pay_frequency: "monthly",
      financial_year_start: 4,
      is_active: true,
    });
  }

  // -----------------------------------------------------------------------
  // HELPERS
  // -----------------------------------------------------------------------

  /**
   * Map EmpCloud role string to payroll role.
   * EmpCloud roles may use different naming; normalize here.
   */
  private mapRole(role: string): AuthPayload["role"] {
    const roleMap: Record<string, AuthPayload["role"]> = {
      super_admin: "super_admin",
      org_admin: "org_admin",
      hr_admin: "hr_admin",
      hr_manager: "hr_manager",
      manager: "hr_manager",
      admin: "hr_admin",
      employee: "employee",
    };
    return roleMap[role?.toLowerCase()] || "employee";
  }

  private generateTokens(payload: AuthPayload): TokenPair {
    const accessToken = jwt.sign({ ...payload, type: "access" }, config.jwt.secret, {
      expiresIn: config.jwt.accessExpiry as any,
    });

    const refreshToken = jwt.sign({ ...payload, type: "refresh" }, config.jwt.secret, {
      expiresIn: config.jwt.refreshExpiry as any,
    });

    return { accessToken, refreshToken, expiresIn: String(config.jwt.accessExpiry) };
  }
}
