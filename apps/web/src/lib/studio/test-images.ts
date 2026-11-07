/**
 * Images factices pour les tests (jamais importées par l'application) : un en-tête JPEG minimal (SOI,
 * APP0, SOF0 avec les dimensions), complété jusqu'au poids voulu. Assez pour la vérification des en-têtes
 * faite par le navigateur, la démonstration et le serveur (`checkModelImage`).
 */
export function fakeJpeg(width: number, height: number, total = 2_000): Uint8Array {
  const head = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
  const out = new Uint8Array(Math.max(total, head.length + 2));
  out.set(head);
  out[out.length - 2] = 0xff;
  out[out.length - 1] = 0xd9;
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** Data URL JPEG factice de `width` × `height` px. */
export function fakeJpegDataUrl(width = 1024, height = 768, total = 2_000): string {
  return `data:image/jpeg;base64,${toBase64(fakeJpeg(width, height, total))}`;
}
