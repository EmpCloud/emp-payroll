import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { getDB } from "../db/adapters";
import { AppError } from "../api/middleware/error.middleware";
import { AuthPayload } from "../api/middleware/auth.middleware";

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export class AuthService {
  private db = getDB();

  async login(email: string, password: string): Promise<{ user: any; tokens: TokenPair }> {
    const employee = await this.db.findOne<any>("employees", { email, is_active: true });
    if (!employee) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
    }

    if (!employee.password_hash) {
      throw new AppError(401, "NO_PASSWORD", "Account has no password set. Contact your HR admin.");
    }

    const valid = await bcrypt.compare(password, employee.password_hash);
    if (!valid) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
    }

    const tokens = this.generateTokens({
      userId: employee.id,
      orgId: employee.org_id,
      role: employee.role,
      email: employee.email,
    });

    const { password_hash, ...user } = employee;
    return { user, tokens };
  }

  async register(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    orgId?: string;
  }): Promise<{ user: any; tokens: TokenPair }> {
    const existing = await this.db.findOne<any>("employees", { email: data.email });
    if (existing) {
      throw new AppError(409, "EMAIL_EXISTS", "An account with this email already exists");
    }

    const passwordHash = await bcrypt.hash(data.password, 12);

    // If no orgId provided, this is the first user — they'll need an org created via /organizations
    const employee = await this.db.create<any>("employees", {
      org_id: data.orgId || "00000000-0000-0000-0000-000000000000",
      employee_code: `EMP-${Date.now()}`,
      first_name: data.firstName,
      last_name: data.lastName,
      email: data.email,
      date_of_birth: "1990-01-01",
      gender: "other",
      date_of_joining: new Date().toISOString().slice(0, 10),
      department: "General",
      designation: "Employee",
      bank_details: JSON.stringify({}),
      tax_info: JSON.stringify({ pan: "", regime: "new" }),
      pf_details: JSON.stringify({}),
      password_hash: passwordHash,
      role: data.orgId ? "employee" : "hr_admin",
    });

    const tokens = this.generateTokens({
      userId: employee.id,
      orgId: employee.org_id,
      role: employee.role,
      email: employee.email,
    });

    const { password_hash: _, ...user } = employee;
    return { user, tokens };
  }

  async refreshToken(token: string): Promise<TokenPair> {
    try {
      const payload = jwt.verify(token, config.jwt.secret) as AuthPayload & { type: string };
      if (payload.type !== "refresh") {
        throw new AppError(401, "INVALID_TOKEN", "Not a refresh token");
      }

      const employee = await this.db.findById<any>("employees", payload.userId);
      if (!employee || !employee.is_active) {
        throw new AppError(401, "USER_NOT_FOUND", "User account is inactive or deleted");
      }

      return this.generateTokens({
        userId: employee.id,
        orgId: employee.org_id,
        role: employee.role,
        email: employee.email,
      });
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError(401, "INVALID_TOKEN", "Invalid or expired refresh token");
    }
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const employee = await this.db.findById<any>("employees", userId);
    if (!employee) throw new AppError(404, "NOT_FOUND", "User not found");

    if (employee.password_hash) {
      const valid = await bcrypt.compare(currentPassword, employee.password_hash);
      if (!valid) throw new AppError(401, "INVALID_PASSWORD", "Current password is incorrect");
    }

    if (newPassword.length < 8) {
      throw new AppError(400, "WEAK_PASSWORD", "Password must be at least 8 characters");
    }

    const hash = await bcrypt.hash(newPassword, 12);
    await this.db.update("employees", userId, { password_hash: hash });
  }

  async adminResetPassword(employeeId: string, newPassword: string): Promise<void> {
    const employee = await this.db.findById<any>("employees", employeeId);
    if (!employee) throw new AppError(404, "NOT_FOUND", "Employee not found");

    const hash = await bcrypt.hash(newPassword || "Welcome@123", 12);
    await this.db.update("employees", employeeId, { password_hash: hash });
  }

  // In-memory OTP store (use Redis in production)
  private otpStore = new Map<string, { otp: string; expiresAt: number }>();

  async forgotPassword(email: string): Promise<{ message: string }> {
    const employee = await this.db.findOne<any>("employees", { email, is_active: true });
    // Always return success to prevent email enumeration
    if (!employee) return { message: "If the email exists, a reset OTP has been sent" };

    const otp = String(Math.floor(100000 + Math.random() * 900000)); // 6-digit OTP
    this.otpStore.set(email, { otp, expiresAt: Date.now() + 15 * 60 * 1000 }); // 15 min

    // Try to send email, but don't fail if SMTP is not configured
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
      // SMTP not configured — log OTP for development
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

    const employee = await this.db.findOne<any>("employees", { email, is_active: true });
    if (!employee) throw new AppError(404, "NOT_FOUND", "User not found");

    const hash = await bcrypt.hash(newPassword, 12);
    await this.db.update("employees", employee.id, { password_hash: hash });
    this.otpStore.delete(email);
  }

  private generateTokens(payload: AuthPayload): TokenPair {
    const accessToken = jwt.sign(
      { ...payload, type: "access" },
      config.jwt.secret,
      { expiresIn: config.jwt.accessExpiry as any }
    );

    const refreshToken = jwt.sign(
      { ...payload, type: "refresh" },
      config.jwt.secret,
      { expiresIn: config.jwt.refreshExpiry as any }
    );

    return { accessToken, refreshToken, expiresIn: String(config.jwt.accessExpiry) };
  }
}
