import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../../config";
import { AppError } from "./error.middleware";

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
