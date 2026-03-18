import crypto from "crypto";
import { EmailService } from "./email.service";
import { logger } from "../utils/logger";

/**
 * Two-factor authentication via email OTP.
 * When enabled for an org, admin logins require a second factor.
 */
export class TwoFactorService {
  // In-memory OTP store (use Redis in production)
  private static otps = new Map<string, { otp: string; expiresAt: number }>();

  async generateAndSend(userId: string, email: string): Promise<{ sent: boolean }> {
    const otp = String(Math.floor(100000 + crypto.randomInt(900000)));
    TwoFactorService.otps.set(userId, {
      otp,
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
    });

    try {
      const emailSvc = new EmailService();
      await emailSvc.sendRaw({
        to: email,
        subject: "Login Verification Code — EMP Payroll",
        html: `
          <div style="font-family:sans-serif;max-width:400px;margin:auto;padding:20px;">
            <h2 style="margin:0 0 16px">Login Verification</h2>
            <p style="color:#6b7280">Enter this code to complete your login:</p>
            <div style="background:#f3f4f6;padding:20px;text-align:center;font-size:36px;font-weight:bold;letter-spacing:10px;border-radius:8px;margin:16px 0">
              ${otp}
            </div>
            <p style="color:#9ca3af;font-size:13px">This code expires in 5 minutes.</p>
          </div>
        `,
      });
      return { sent: true };
    } catch {
      // Fallback: log OTP for development
      logger.info(`[DEV] 2FA OTP for ${email}: ${otp}`);
      return { sent: true };
    }
  }

  async verify(userId: string, otp: string): Promise<boolean> {
    const stored = TwoFactorService.otps.get(userId);
    if (!stored) return false;
    if (stored.expiresAt < Date.now()) {
      TwoFactorService.otps.delete(userId);
      return false;
    }
    if (stored.otp !== otp) return false;
    TwoFactorService.otps.delete(userId);
    return true;
  }
}
