import { Router } from "express";
import { AuthService } from "../../services/auth.service";
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

export { router as authRoutes };
