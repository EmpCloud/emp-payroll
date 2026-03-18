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
