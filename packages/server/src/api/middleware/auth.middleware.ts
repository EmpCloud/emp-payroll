import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../../config";
import { AppError } from "./error.middleware";
import {
  API_KEY_PREFIX,
  findValidApiKey,
  findUserById,
  findOrgById,
  resolveUserPermissions,
} from "../../db/empcloud";
import { getDB } from "../../db/adapters";

export interface AuthPayload {
  // EmpCloud IDs (source of truth — bigint stored as number)
  empcloudUserId: number;
  empcloudOrgId: number;
  // Payroll profile ID (UUID in payroll DB, null if profile not yet created)
  payrollProfileId: string | null;
  // User info from EmpCloud
  role: "super_admin" | "org_admin" | "hr_admin" | "hr_manager" | "employee";
  email: string;
  firstName: string;
  lastName: string;
  orgName: string;
  // RBAC v1 — effective permissions resolved by EmpCloud at SSO/refresh
  // time, embedded in the EmpCloud RS256 JWT and copied into payroll's
  // HS256 JWT during ssoLogin. May be empty for legacy tokens issued
  // before the RBAC migration; gate routes with requirePermission().
  permissions?: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  // Support token in query param for PDF/download links opened in new tabs
  const queryToken = req.query.token as string | undefined;

  if (!header?.startsWith("Bearer ") && !queryToken) {
    return next(new AppError(401, "UNAUTHORIZED", "Missing or invalid authorization header"));
  }

  const token = queryToken || header!.slice(7);

  // Shared API-key path — an `empc_` token is an opaque key minted in EmpCloud,
  // not a JWT. Validate it against the shared EmpCloud `api_keys` table and
  // build the same AuthPayload an SSO login would, so every downstream
  // requirePermission() / authorize() check works unchanged.
  if (typeof token === "string" && token.startsWith(API_KEY_PREFIX)) {
    void authenticateApiKey(token, req, next);
    return;
  }

  try {
    const payload = jwt.verify(token, config.jwt.secret) as AuthPayload;
    req.user = payload;
    next();
  } catch (err: any) {
    if (err.name === "TokenExpiredError") {
      return next(new AppError(401, "TOKEN_EXPIRED", "Access token has expired"));
    }
    return next(new AppError(401, "INVALID_TOKEN", "Invalid access token"));
  }
}

/**
 * Map an EmpCloud role string to a payroll role. Mirrors AuthService.mapRole:
 * only HR-side admins keep elevated scope; everyone else collapses to employee
 * and unlocks specific actions via the permissions claim.
 */
function mapEmpCloudRole(role: string): AuthPayload["role"] {
  const roleMap: Record<string, AuthPayload["role"]> = {
    super_admin: "super_admin",
    org_admin: "org_admin",
    hr_admin: "hr_admin",
    admin: "hr_admin",
    hr_manager: "employee",
    manager: "employee",
    employee: "employee",
  };
  return roleMap[role?.toLowerCase()] || "employee";
}

/**
 * Validate a shared EmpCloud API key and populate req.user. Resolves the owner
 * user's live RBAC permissions so the key mirrors that admin exactly. Any
 * failure resolves to a 401 via next() — never throws into the event loop.
 */
async function authenticateApiKey(rawKey: string, req: Request, next: NextFunction): Promise<void> {
  try {
    const key = await findValidApiKey(rawKey);
    if (!key) {
      return next(new AppError(401, "INVALID_API_KEY", "Invalid or expired API key"));
    }

    const ecUser = await findUserById(key.user_id);
    if (!ecUser || ecUser.status !== 1) {
      return next(new AppError(401, "INVALID_API_KEY", "API key owner not found or inactive"));
    }

    const ecOrg = await findOrgById(ecUser.organization_id);
    const permissions = await resolveUserPermissions(
      ecUser.id,
      ecUser.role,
      ecUser.organization_id,
    );

    // Existing payroll profile (if any) — not auto-created for key-based access.
    const profile = await getDB()
      .findOne<{ id: string }>("employee_payroll_profiles", { empcloud_user_id: ecUser.id })
      .catch(() => null);

    req.user = {
      empcloudUserId: ecUser.id,
      empcloudOrgId: ecUser.organization_id,
      payrollProfileId: profile?.id ?? null,
      role: mapEmpCloudRole(ecUser.role),
      email: ecUser.email,
      firstName: ecUser.first_name,
      lastName: ecUser.last_name,
      orgName: ecOrg?.name ?? "",
      permissions,
    };
    next();
  } catch {
    next(new AppError(401, "API_KEY_AUTH_FAILED", "API key validation failed"));
  }
}

/**
 * RBAC v1 — gate routes by EmpCloud-issued permission keys (e.g. "payroll:run").
 * The keys travel in the JWT's `permissions` claim, populated during ssoLogin.
 *
 * super_admin bypasses all permission checks (they're a platform-level role
 * outside the per-org RBAC system).
 *
 * If the token has no `permissions` array (legacy login predating RBAC v1),
 * we fall back to the role-based authorize() — `org_admin` and `hr_admin`
 * pass any permission check, mirroring the previous behaviour.
 */
export function requirePermission(...required: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError(401, "UNAUTHORIZED", "Not authenticated"));
    }
    if (req.user.role === "super_admin") return next();

    const granted = req.user.permissions;
    if (!granted || granted.length === 0) {
      // Legacy fallback — pre-RBAC tokens. Treat org-level admins as having
      // every permission so we don't lock out users who haven't re-logged in.
      if (req.user.role === "org_admin" || req.user.role === "hr_admin") {
        return next();
      }
      return next(
        new AppError(403, "FORBIDDEN", `This action requires one of: ${required.join(", ")}`),
      );
    }
    if (required.some((p) => granted.includes(p))) return next();
    return next(
      new AppError(403, "FORBIDDEN", `This action requires one of: ${required.join(", ")}`),
    );
  };
}

/** Same as requirePermission but the user must hold ALL listed keys. */
export function requireAllPermissions(...required: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError(401, "UNAUTHORIZED", "Not authenticated"));
    }
    if (req.user.role === "super_admin") return next();

    const granted = req.user.permissions;
    if (!granted || granted.length === 0) {
      if (req.user.role === "org_admin" || req.user.role === "hr_admin") {
        return next();
      }
      return next(
        new AppError(403, "FORBIDDEN", `This action requires all of: ${required.join(", ")}`),
      );
    }
    if (required.every((p) => granted.includes(p))) return next();
    const missing = required.filter((p) => !granted.includes(p));
    return next(new AppError(403, "FORBIDDEN", `Missing permissions: ${missing.join(", ")}`));
  };
}

export function authorize(...roles: AuthPayload["role"][]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError(401, "UNAUTHORIZED", "Not authenticated"));
    }
    // org_admin / super_admin are supersets of hr_admin — grant access whenever
    // any admin role is allowed. (#313, #302 — admin users with role
    // `super_admin` were getting 403 on reimbursement approve/reject because
    // the middleware only escalated for org_admin.)
    const effectiveRoles = [...roles];
    if (
      (roles.includes("hr_admin") || roles.includes("hr_manager")) &&
      !roles.includes("org_admin")
    ) {
      effectiveRoles.push("org_admin");
    }
    if (roles.length > 0 && !effectiveRoles.includes("super_admin")) {
      effectiveRoles.push("super_admin");
    }
    if (effectiveRoles.length > 0 && !effectiveRoles.includes(req.user.role)) {
      return next(
        new AppError(403, "FORBIDDEN", "You do not have permission to perform this action"),
      );
    }
    next();
  };
}
