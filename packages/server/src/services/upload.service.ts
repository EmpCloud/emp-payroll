import path from "path";
import fs from "fs";
import { v4 as uuid } from "uuid";
import { getDB } from "../db/adapters";
import { AppError } from "../api/middleware/error.middleware";

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export class UploadService {
  private db = getDB();

  getUploadDir() {
    return UPLOAD_DIR;
  }

  async saveDocument(params: {
    orgId: string;
    employeeId: string;
    uploadedBy: string;
    name: string;
    type: string;
    file: { filename: string; originalname: string; mimetype: string; size: number };
    expiryDate?: string;
  }) {
    const id = uuid();
    const fileUrl = `/uploads/${params.file.filename}`;

    await this.db.create("employee_documents", {
      id,
      org_id: params.orgId,
      employee_id: params.employeeId,
      name: params.name,
      type: params.type,
      file_url: fileUrl,
      mime_type: params.file.mimetype,
      expiry_date: params.expiryDate || null,
      is_verified: 0,
      uploaded_by: params.uploadedBy,
    });

    return { id, fileUrl, name: params.name, type: params.type };
  }

  async getDocuments(employeeId: string, orgId: string) {
    return this.db.findMany<any>("employee_documents", {
      filters: { employee_id: employeeId, org_id: orgId },
      sort: { field: "created_at", order: "desc" },
      limit: 100,
    });
  }

  async deleteDocument(docId: string, orgId: string) {
    const doc = await this.db.findById<any>("employee_documents", docId);
    if (!doc || doc.org_id !== orgId) {
      throw new AppError(404, "NOT_FOUND", "Document not found");
    }

    // Delete file from disk
    if (doc.file_url) {
      const filePath = path.join(UPLOAD_DIR, path.basename(doc.file_url));
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    await this.db.delete("employee_documents", docId);
    return { deleted: true };
  }

  async verifyDocument(docId: string, orgId: string) {
    const doc = await this.db.findById<any>("employee_documents", docId);
    if (!doc || doc.org_id !== orgId) {
      throw new AppError(404, "NOT_FOUND", "Document not found");
    }
    return this.db.update("employee_documents", docId, { is_verified: 1 });
  }

  async saveDeclarationProof(params: {
    orgId: string;
    employeeId: string;
    declarationId: string;
    file: { filename: string; originalname: string; mimetype: string };
  }) {
    const fileUrl = `/uploads/${params.file.filename}`;

    // Update the declaration with proof info
    const result = await this.db.raw<any>(
      `UPDATE tax_declarations SET proof_submitted = 1, proof_url = ? WHERE id = ? AND employee_id = ?`,
      [fileUrl, params.declarationId, params.employeeId]
    );

    return { fileUrl, declarationId: params.declarationId };
  }
}
