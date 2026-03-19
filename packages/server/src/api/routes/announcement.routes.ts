import { Router } from "express";
import {
  createAnnouncement,
  listAnnouncements,
  getAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
} from "../../services/announcement.service";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { wrap } from "../helpers";

const router = Router();
router.use(authenticate);

// List announcements (all employees can see active ones)
router.get(
  "/",
  wrap(async (req, res) => {
    const activeOnly = req.query.all !== "true";
    const limit = Number(req.query.limit) || 50;
    const data = await listAnnouncements(req.user!.empcloudOrgId, { activeOnly, limit });
    res.json({ success: true, data });
  }),
);

// Get single announcement
router.get(
  "/:id",
  wrap(async (req, res) => {
    const data = await getAnnouncement(String(req.params.id), req.user!.empcloudOrgId);
    if (!data)
      return res
        .status(404)
        .json({ success: false, error: { code: "NOT_FOUND", message: "Announcement not found" } });
    res.json({ success: true, data });
  }),
);

// Create announcement (admin only)
router.post(
  "/",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const { title, content, priority, category, isPinned, publishAt, expiresAt } = req.body;
    if (!title || !content) {
      return res
        .status(400)
        .json({
          success: false,
          error: { code: "INVALID_INPUT", message: "title and content are required" },
        });
    }
    const data = await createAnnouncement({
      orgId: req.user!.empcloudOrgId,
      authorId: req.user!.empcloudUserId,
      title,
      content,
      priority,
      category,
      isPinned,
      publishAt,
      expiresAt,
    });
    res.status(201).json({ success: true, data });
  }),
);

// Update announcement
router.put(
  "/:id",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const updated = await updateAnnouncement(
      String(req.params.id),
      req.user!.empcloudOrgId,
      req.body,
    );
    if (!updated)
      return res
        .status(404)
        .json({ success: false, error: { code: "NOT_FOUND", message: "Announcement not found" } });
    res.json({ success: true, data: { updated: true } });
  }),
);

// Delete (soft) announcement
router.delete(
  "/:id",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const deleted = await deleteAnnouncement(String(req.params.id), req.user!.empcloudOrgId);
    if (!deleted)
      return res
        .status(404)
        .json({ success: false, error: { code: "NOT_FOUND", message: "Announcement not found" } });
    res.json({ success: true, data: { deleted: true } });
  }),
);

export { router as announcementRoutes };
