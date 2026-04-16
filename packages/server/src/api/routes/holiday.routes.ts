import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { wrap } from "../helpers";
import { getEmpCloudDB } from "../../db/empcloud";

const router = Router();

router.use(authenticate);

// GET /holidays — fetch holidays from EmpCloud's company_events
router.get(
  "/",
  wrap(async (req, res) => {
    const empcloudDb = getEmpCloudDB();
    const orgId = Number(req.user!.empcloudOrgId);
    const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();

    const startOfYear = `${year}-01-01 00:00:00`;
    const endOfYear = `${year}-12-31 23:59:59`;

    const holidays = await empcloudDb("company_events")
      .where("organization_id", orgId)
      .where("event_type", "holiday")
      .whereIn("status", ["upcoming", "ongoing", "completed"])
      .where("start_date", ">=", startOfYear)
      .where("start_date", "<=", endOfYear)
      .select("id", "title as name", "start_date as date", "description", "is_all_day", "status")
      .orderBy("start_date", "asc");

    // #72 — EmpCloud's company_events table has no holiday-subtype column,
    // so we encode the type (national/regional/optional/restricted) inline
    // in the description with a marker the GET parses back out.
    const TYPE_MARKER = /^\[type:(national|regional|optional|restricted)\]\s*/i;
    const enriched = holidays.map((h: any) => {
      const d = new Date(h.date);
      const raw = typeof h.description === "string" ? h.description : "";
      const m = raw.match(TYPE_MARKER);
      const type = m ? m[1].toLowerCase() : "national";
      const description = m ? raw.slice(m[0].length) : raw;
      return {
        id: String(h.id),
        name: h.name,
        date: d.toISOString().slice(0, 10),
        day: d.toLocaleDateString("en-US", { weekday: "long" }),
        type,
        description: description || null,
      };
    });

    res.json({ success: true, data: enriched });
  }),
);

// POST /holidays — create holiday in EmpCloud's company_events
router.post(
  "/",
  authorize("hr_admin", "hr_manager", "org_admin"),
  wrap(async (req, res) => {
    const empcloudDb = getEmpCloudDB();
    const orgId = Number(req.user!.empcloudOrgId);
    const { name, date, type, description } = req.body;

    // #29 — Holiday name must contain at least one alphabet character.
    // Purely-numeric or symbol-only names (e.g. "123", "---") are rejected
    // both here and on the client.
    const trimmedName = typeof name === "string" ? name.trim() : "";
    if (!trimmedName) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_INPUT", message: "Holiday name is required" },
      });
    }
    if (!/[A-Za-z]/.test(trimmedName)) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_INPUT",
          message: "Holiday name must contain at least one letter",
        },
      });
    }
    if (!date || typeof date !== "string") {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_INPUT", message: "Holiday date is required (YYYY-MM-DD)" },
      });
    }

    // #72 — persist holiday sub-type via a description prefix since
    // company_events has no dedicated column for it. See GET handler.
    const ALLOWED_TYPES = new Set(["national", "regional", "optional", "restricted"]);
    const normalizedType = ALLOWED_TYPES.has(String(type).toLowerCase())
      ? String(type).toLowerCase()
      : "national";
    const descPrefix = `[type:${normalizedType}] `;
    const storedDescription = description ? `${descPrefix}${description}` : descPrefix.trim();

    const [id] = await empcloudDb("company_events").insert({
      organization_id: orgId,
      title: trimmedName,
      description: storedDescription,
      event_type: "holiday",
      start_date: `${date} 00:00:00`,
      end_date: `${date} 23:59:59`,
      is_all_day: true,
      target_type: "all",
      is_mandatory: false,
      status: new Date(date) >= new Date() ? "upcoming" : "completed",
      created_by: Number(req.user!.empcloudUserId),
      created_at: new Date(),
      updated_at: new Date(),
    });

    res
      .status(201)
      .json({
        success: true,
        data: { id: String(id), name: trimmedName, date, type: normalizedType },
      });
  }),
);

// DELETE /holidays/:id — remove holiday from EmpCloud
router.delete(
  "/:id",
  authorize("hr_admin", "hr_manager", "org_admin"),
  wrap(async (req, res) => {
    const empcloudDb = getEmpCloudDB();
    const orgId = Number(req.user!.empcloudOrgId);

    await empcloudDb("company_events")
      .where({ id: Number(req.params.id), organization_id: orgId, event_type: "holiday" })
      .delete();

    res.json({ success: true, data: { message: "Holiday deleted" } });
  }),
);

export { router as holidayRoutes };
