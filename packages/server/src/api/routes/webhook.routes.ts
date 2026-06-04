import { Router } from "express";
import { WebhookService } from "../../services/webhook.service";
import { PayoutService } from "../../services/payout.service";
import { RazorpayClient } from "../../services/razorpay.service";
import { decryptSecret, isSecretsKeyConfigured } from "../../utils/secrets";
import { getDB } from "../../db/adapters";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { wrap, param } from "../helpers";
import { logger } from "../../utils/logger";

const router = Router();
const svc = new WebhookService();
const payoutSvc = new PayoutService();
const db = getDB();

// --- Razorpay incoming webhook (Phase 2) -------------------------------------
// MUST be declared BEFORE the `router.use(authenticate, ...)` line below so
// Razorpay's unauthenticated POSTs reach it. Signature is verified per-tenant
// against the webhook secret configured in payroll Settings.
//
// Tenant routing: the event payload includes our payout in
// payload.payout.entity. We look up the matching `payroll_payouts` row by
// razorpay_payout_id, pull that row's org, decrypt the org's webhook secret,
// then HMAC-SHA256 the raw body and constant-time compare with the
// X-Razorpay-Signature header. Only on match do we let `applyWebhookEvent`
// touch the DB.
router.post(
  "/razorpay",
  wrap(async (req, res) => {
    const signature = String(req.header("x-razorpay-signature") || "");
    const rawBody: Buffer | undefined = (req as any).rawBody;
    if (!signature || !rawBody) {
      // 400 (not 401) — Razorpay retries on 5xx and 408 but not on 4xx, which
      // is what we want for a clearly malformed request.
      return res.status(400).json({ error: "missing signature or body" });
    }
    const event = req.body || {};
    const rzpPayoutId = event?.payload?.payout?.entity?.id;
    if (!rzpPayoutId) {
      return res.status(400).json({ error: "no payout id in event" });
    }
    // Find the org via our local payout row.
    const matchRes = await db.findMany<any>("payroll_payouts", {
      filters: { razorpay_payout_id: rzpPayoutId },
      limit: 1,
    });
    const row = matchRes.data[0];
    if (!row) {
      // Unknown payout id — could be a replay or a payout we didn't create.
      // Acknowledge so Razorpay doesn't retry endlessly; just don't touch the
      // DB.
      logger.warn(`razorpay webhook: unknown payout id ${rzpPayoutId}`);
      return res.status(200).json({ received: true, handled: false });
    }
    const settings = await db.findOne<any>("organization_payroll_settings", {
      empcloud_org_id: row.empcloud_org_id,
    });
    if (!settings?.razorpay_webhook_secret_enc) {
      // No webhook secret configured — refuse to process the event rather
      // than trust it blind.
      return res.status(400).json({ error: "webhook secret not configured for org" });
    }
    if (!isSecretsKeyConfigured()) {
      return res.status(500).json({ error: "secrets master key not configured" });
    }
    let webhookSecret: string;
    try {
      webhookSecret = decryptSecret(settings.razorpay_webhook_secret_enc);
    } catch {
      return res.status(500).json({ error: "webhook secret could not be decrypted" });
    }
    const valid = RazorpayClient.verifyWebhookSignature(rawBody, signature, webhookSecret);
    if (!valid) {
      logger.warn(
        `razorpay webhook: signature mismatch for payout ${rzpPayoutId} (org ${row.empcloud_org_id})`,
      );
      return res.status(401).json({ error: "invalid signature" });
    }
    const result = await payoutSvc.applyWebhookEvent(event);
    logger.info(
      `razorpay webhook: ${event.event} payout=${rzpPayoutId} -> status=${result.status || "n/a"} handled=${result.handled}`,
    );
    return res.status(200).json({ received: true, handled: result.handled });
  }),
);

router.use(authenticate, authorize("hr_admin"));

router.get(
  "/",
  wrap(async (req, res) => {
    const data = await svc.list(String(req.user!.empcloudOrgId));
    res.json({ success: true, data });
  }),
);

router.post(
  "/",
  wrap(async (req, res) => {
    const data = await svc.register(String(req.user!.empcloudOrgId), {
      url: req.body.url,
      events: req.body.events || ["*"],
      secret: req.body.secret,
    });
    res.status(201).json({ success: true, data });
  }),
);

router.delete(
  "/:id",
  wrap(async (req, res) => {
    const deleted = await svc.delete(String(req.user!.empcloudOrgId), param(req, "id"));
    res.json({ success: true, data: { deleted } });
  }),
);

router.post(
  "/:id/toggle",
  wrap(async (req, res) => {
    const data = await svc.toggle(String(req.user!.empcloudOrgId), param(req, "id"));
    res.json({ success: true, data });
  }),
);

router.get(
  "/deliveries",
  wrap(async (req, res) => {
    const data = await svc.getDeliveries(
      String(req.user!.empcloudOrgId),
      Number(req.query.limit) || 20,
    );
    res.json({ success: true, data });
  }),
);

// Test endpoint: send a test event
router.post(
  "/test",
  wrap(async (req, res) => {
    const delivered = await svc.dispatch(String(req.user!.empcloudOrgId), "test.ping", {
      message: "This is a test webhook event",
      timestamp: new Date().toISOString(),
    });
    res.json({ success: true, data: { delivered, message: `Sent to ${delivered} webhook(s)` } });
  }),
);

export { router as webhookRoutes };
