import { Router } from "express";
import { AuthService } from "../../services/auth.service";
import { validate, loginSchema, registerSchema } from "../validators";
import { wrap } from "../helpers";

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

router.post("/forgot-password", (_req, res) => {
  res.json({ success: true, data: { message: "If the email exists, a reset link has been sent" } });
});

router.post("/reset-password", (_req, res) => {
  res.json({ success: true, data: { message: "Password reset successful" } });
});

export { router as authRoutes };
