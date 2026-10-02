import type { Config } from "@netlify/functions";
import { randomUUID } from "node:crypto";
import { supabaseAdmin, publicStorageUrl, STORAGE_BUCKET } from "./_shared/supabase";
import { requireUser, json } from "./_shared/auth";

const MAX_BYTES = 8 * 1024 * 1024; // 8 Mo
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function extFor(contentType: string): string {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/gif") return "gif";
  return "jpg";
}

export default async (request: Request): Promise<Response> => {
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return json({ ok: false, error: "missing_file" }, 400);
  if (!ALLOWED_TYPES.has(file.type)) return json({ ok: false, error: "unsupported_type" }, 400);
  if (file.size > MAX_BYTES) return json({ ok: false, error: "file_too_large" }, 400);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const path = `listings/${auth.user.id}/${randomUUID()}.${extFor(file.type)}`;

  const db = supabaseAdmin();
  const { error } = await db.storage.from(STORAGE_BUCKET).upload(path, bytes, { contentType: file.type, upsert: false });
  if (error) return json({ ok: false, error: "upload_failed", details: error.message }, 500);

  return json({ ok: true, key: path, url: publicStorageUrl(path) }, 201);
};

export const config: Config = { path: "/api/media/upload" };
