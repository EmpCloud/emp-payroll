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
