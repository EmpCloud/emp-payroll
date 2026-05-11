import { Router } from "express";
import multer from "multer";
import path from "path";
import { v4 as uuid } from "uuid";
import { UploadService } from "../../services/upload.service";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { wrap, param } from "../helpers";

const router = Router();
const svc = new UploadService();

// Configure multer storage
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, svc.getUploadDir());
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuid()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowed = [".pdf", ".jpg", ".jpeg", ".png", ".doc", ".docx", ".xls", ".xlsx"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${ext} not allowed. Allowed: ${allowed.join(", ")}`));
    }
  },
});

router.use(authenticate);

// Upload employee document
router.post(
  "/employees/:empId/documents",
  authorize("hr_admin", "hr_manager"),
  upload.single("file"),
  wrap(async (req, res) => {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, error: { code: "NO_FILE", message: "No file uploaded" } });
    }
    const data = await svc.saveDocument({
      orgId: String(req.user!.empcloudOrgId),
      employeeId: param(req, "empId"),
      uploadedBy: String(req.user!.empcloudUserId),
      name: req.body.name || req.file.originalname,
      type: req.body.type || "other",
      file: req.file as any,
      expiryDate: req.body.expiryDate,
    });
    res.status(201).json({ success: true, data });
  }),
);

// List employee documents
router.get(
  "/employees/:empId/documents",
  wrap(async (req, res) => {
    const data = await svc.getDocuments(param(req, "empId"), String(req.user!.empcloudOrgId));
    res.json({ success: true, data });
  }),
);

// Delete document
router.delete(
  "/employees/:empId/documents/:docId",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await svc.deleteDocument(
      req.params.docId as string,
      String(req.user!.empcloudOrgId),
    );
    res.json({ success: true, data });
  }),
);

// Verify document
router.post(
  "/employees/:empId/documents/:docId/verify",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await svc.verifyDocument(
      req.params.docId as string,
      String(req.user!.empcloudOrgId),
    );
    res.json({ success: true, data });
  }),
);

// Upload declaration proof (self-service)
router.post(
  "/declarations/:declId/proof",
  upload.single("file"),
  wrap(async (req, res) => {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, error: { code: "NO_FILE", message: "No file uploaded" } });
    }
    const data = await svc.saveDeclarationProof({
      orgId: String(req.user!.empcloudOrgId),
      empcloudUserId: req.user!.empcloudUserId,
      declarationId: param(req, "declId"),
      file: req.file as any,
    });
    res.json({ success: true, data });
  }),
);

export { router as uploadRoutes };
