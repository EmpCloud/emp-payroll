import { Router } from "express";
import { AuthService } from "../../services/auth.service";
import { TwoFactorService } from "../../services/twofa.service";
import { ApiKeyService } from "../../services/apikey.service";
import { validate, loginSchema, registerSchema } from "../validators";
import { wrap } from "../helpers";
import { authenticate, authorize } from "../middleware/auth.middleware";

const router = Router();
const auth = new AuthService();

router.post("/login", validate(loginSchema), wrap(async (req, res) => {
  const { email, password } = req.body;
  const result = await auth.login(email, password);
  res.json({ success: true, data: result });
}));

router.post("/register", validate(registerSchema), wrap(async (req, res) => {
  const result = await auth.register(req.body);
  res.status(201).json({ success: true, data: result });
}));

router.post("/refresh-token", wrap(async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ success: false, error: { code: "MISSING_TOKEN", message: "refreshToken is required" } });
  }
  const tokens = await auth.refreshToken(refreshToken);
  res.json({ success: true, data: tokens });
}));

router.post("/logout", (_req, res) => {
  res.json({ success: true, data: { message: "Logged out" } });
});

router.post("/forgot-password", wrap(async (req, res) => {
  const result = await auth.forgotPassword(req.body.email);
  res.json({ success: true, data: result });
}));

router.post("/reset-password", wrap(async (req, res) => {
  await auth.resetPasswordWithOTP(req.body.email, req.body.otp, req.body.newPassword);
  res.json({ success: true, data: { message: "Password reset successful" } });
}));

// Password change (self-service)
router.post("/change-password", authenticate, wrap(async (req, res) => {
  await auth.changePassword(req.user!.userId, req.body.currentPassword, req.body.newPassword);
  res.json({ success: true, data: { message: "Password changed successfully" } });
}));

// Admin reset password
router.post("/reset-employee-password", authenticate, authorize("hr_admin"), wrap(async (req, res) => {
  await auth.adminResetPassword(req.body.employeeId, req.body.newPassword);
  res.json({ success: true, data: { message: "Password reset successfully" } });
}));

// Two-factor auth
router.post("/2fa/send", authenticate, wrap(async (req, res) => {
  const twofa = new TwoFactorService();
  const result = await twofa.generateAndSend(req.user!.userId, req.user!.email);
  res.json({ success: true, data: { message: "Verification code sent", ...result } });
}));

router.post("/2fa/verify", authenticate, wrap(async (req, res) => {
  const twofa = new TwoFactorService();
  const valid = await twofa.verify(req.user!.userId, req.body.otp);
  if (!valid) {
    return res.status(401).json({ success: false, error: { code: "INVALID_OTP", message: "Invalid or expired verification code" } });
  }
  res.json({ success: true, data: { verified: true, message: "Two-factor authentication successful" } });
}));

// API Keys
router.get("/api-keys", authenticate, authorize("hr_admin"), wrap(async (req, res) => {
  const svc = new ApiKeyService();
  const keys = await svc.list(req.user!.orgId);
  res.json({ success: true, data: keys });
}));

router.post("/api-keys", authenticate, authorize("hr_admin"), wrap(async (req, res) => {
  const svc = new ApiKeyService();
  const data = await svc.create(req.user!.orgId, {
    name: req.body.name,
    permissions: req.body.permissions,
  });
  res.status(201).json({ success: true, data });
}));

router.delete("/api-keys/:hash", authenticate, authorize("hr_admin"), wrap(async (req, res) => {
  const svc = new ApiKeyService();
  const data = await svc.revoke(req.user!.orgId, req.params.hash as string);
  res.json({ success: true, data });
}));

export { router as authRoutes };
