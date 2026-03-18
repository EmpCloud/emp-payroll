import { Request, Response, NextFunction } from "express";
import { ApiKeyService } from "../../services/apikey.service";

/**
 * Middleware that authenticates via API key (X-API-Key header).
 * Falls through to next middleware if no API key is provided
 * (allows JWT auth to handle it instead).
 */
export async function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers["x-api-key"] as string;
  if (!apiKey) return next(); // No API key, try JWT

  try {
    const svc = new ApiKeyService();
    const keyData = await svc.validate(apiKey);
    if (!keyData) {
      return res.status(401).json({
        success: false,
        error: { code: "INVALID_API_KEY", message: "Invalid API key" },
      });
    }

    // Set user context from API key
    (req as any).user = {
      userId: "api-key",
      orgId: keyData.orgId,
      role: "api",
      email: `api@${keyData.name}`,
    };
    (req as any).apiKey = keyData;

    next();
  } catch {
    next();
  }
}
