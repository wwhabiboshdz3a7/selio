import { useState } from "react";

export type UploadedPhoto = { key: string; url: string };

export function PhotoUploader({ photos, onChange, max = 8 }: { photos: UploadedPhoto[]; onChange: (photos: UploadedPhoto[]) => void; max?: number }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      const next = [...photos];
      for (const file of Array.from(files)) {
        if (next.length >= max) break;
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/media/upload", { method: "POST", body: form, credentials: "include" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}) as { error?: string });
          throw new Error(data.error === "unauthorized" ? "Connectez-vous pour ajouter des photos" : "Echec de l'envoi d'une photo");
        }
        const data = (await res.json()) as UploadedPhoto;
        next.push({ key: data.key, url: data.url });
      }
      onChange(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur d'upload");
    } finally {
      setUploading(false);
    }
  }

  function remove(key: string) {
    onChange(photos.filter((p) => p.key !== key));
  }

  return (
    <div>
      <div className="flex flex-wrap gap-3">
        {photos.map((p) => (
          <div key={p.key} className="relative h-24 w-24 overflow-hidden rounded-lg border border-[var(--color-selio-border)]">
            <img src={p.url} alt="" className="h-full w-full object-cover" />
            <button type="button" onClick={() => remove(p.key)} className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-xs text-white" aria-label="Supprimer la photo">×</button>
          </div>
        ))}
        {photos.length < max && (
          <label className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-[var(--color-selio-border)] text-xs text-[var(--color-selio-text-muted)] hover:border-[var(--color-selio-primary)]">
            {uploading ? "Envoi..." : "+ Photo"}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} disabled={uploading} />
          </label>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-[var(--color-selio-danger)]">{error}</p>}
      <p className="mt-1 text-xs text-[var(--color-selio-text-muted)]">{photos.length}/{max} photos</p>
    </div>
  );
}
