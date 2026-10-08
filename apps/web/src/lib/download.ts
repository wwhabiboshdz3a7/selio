/** Télécharge un contenu texte ou Blob côté navigateur. */
export function downloadFile(name: string, content: string | Blob, type = "text/csv;charset=utf-8"): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
