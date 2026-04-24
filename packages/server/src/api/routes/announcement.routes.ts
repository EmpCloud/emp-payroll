import { Router } from "express";
import { listAnnouncements, getAnnouncement } from "../../services/announcement.service";
import { authenticate } from "../middleware/auth.middleware";
import { wrap } from "../helpers";

// Read-only: announcements are owned by EmpCloud. Manage them at
// app.empcloud.com/announcements; the payroll page is just a viewer.

const router = Router();
router.use(authenticate);

router.get(
  "/",
  wrap(async (req, res) => {
    const activeOnly = req.query.all !== "true";
    const limit = Number(req.query.limit) || 50;
    const data = await listAnnouncements(req.user!.empcloudOrgId, { activeOnly, limit });
    res.json({ success: true, data });
  }),
);

router.get(
  "/:id",
  wrap(async (req, res) => {
    const data = await getAnnouncement(String(req.params.id), req.user!.empcloudOrgId);
    if (!data) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Announcement not found" },
      });
    }
    res.json({ success: true, data });
  }),
);

export { router as announcementRoutes };
