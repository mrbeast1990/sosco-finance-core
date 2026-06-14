import { supabase } from "@/integrations/supabase/client";

export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
export const IMAGE_DOCUMENT_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "pdf"];
export const EXCEL_EXTENSIONS = ["xlsx", "xls", "csv"];
export const IMAGE_DOCUMENT_ACCEPT = ".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf";
export const EXCEL_ACCEPT = ".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv";

export class AttachmentError extends Error {
  constructor(public userMessage: string, message?: string) {
    super(message ?? userMessage);
  }
}

function extensionOf(file: File) {
  return file.name.split(".").pop()?.toLowerCase() ?? "";
}

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel", csv: "text/csv",
};

export function validateAttachment(file: File, allowedExtensions: string[]) {
  if (!allowedExtensions.includes(extensionOf(file))) {
    throw new AttachmentError("نوع الملف غير مدعوم");
  }
  if (file.size > MAX_ATTACHMENT_SIZE) {
    throw new AttachmentError("الملف أكبر من الحجم المسموح");
  }
}

export async function uploadAttachment(bucket: string, userId: string, file: File, allowedExtensions: string[], prefix = "") {
  validateAttachment(file, allowedExtensions);
  const extension = extensionOf(file);
  const path = `${userId}/${prefix}${Date.now()}-${crypto.randomUUID()}.${extension}`;
  const result = await supabase.storage.from(bucket).upload(path, file, { contentType: CONTENT_TYPES[extension] });
  if (result.error) {
    console.error("Attachment upload failed", { bucket, path, fileName: file.name, error: result.error });
    const permissionDenied = result.error.message?.toLowerCase().includes("row-level security")
      || result.error.message?.toLowerCase().includes("not authorized")
      || (result.error as any).statusCode === "403";
    throw new AttachmentError(permissionDenied ? "لا تملك صلاحية رفع الملفات" : "فشل رفع المرفق", result.error.message);
  }
  return result.data.path;
}

export async function getAttachmentSignedUrl(bucket: string, path: string) {
  const result = await supabase.storage.from(bucket).createSignedUrl(path, 60);
  if (result.error || !result.data) {
    console.error("Attachment download failed", { bucket, path, error: result.error });
    throw new AttachmentError("تعذر تحميل الملف", result.error?.message);
  }
  return result.data.signedUrl;
}
