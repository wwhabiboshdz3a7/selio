import type { Config } from "@netlify/functions";
import sharp from "sharp";
import { requireUser, json } from "./_shared/auth";

// Retouche automatique GRATUITE (traitement local, pas d'IA generative) :
// recadrage carre centre, luminosite/contraste/nettete ameliores, fond
// legerement eclairci pour un rendu plus "pro". C'est un point de depart —
// une vraie generation IA (fond studio recree, mise en scene) necessitera
// une cle API payante (ex: OpenAI, Replicate) a connecter plus tard.
export default async (request: Request): Promise<Response> => {
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return json({ ok: false, error: "missing_file" }, 400);

  const bytes = Buffer.from(await file.arrayBuffer());

  try {
    const image = sharp(bytes).rotate();
    const metadata = await image.metadata();
    const size = Math.min(metadata.width ?? 1000, metadata.height ?? 1000);

    const output = await image
      .resize(size, size, { fit: "cover", position: "attention" })
      .modulate({ brightness: 1.06, saturation: 1.08 })
      .linear(1.08, -8) // leger gain de contraste
      .sharpen({ sigma: 1.1 })
      .jpeg({ quality: 92 })
      .toBuffer();

    return new Response(new Uint8Array(output), {
      status: 200,
      headers: { "content-type": "image/jpeg", "cache-control": "no-store" },
    });
  } catch {
    return json({ ok: false, error: "processing_failed" }, 500);
  }
};

export const config: Config = { path: "/api/pro/photo-enhance" };
