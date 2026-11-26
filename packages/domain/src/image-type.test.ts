import { describe, expect, it } from "vitest";
import { dataUrlHead, detectFileType, photoContentProblem } from "./image-type";

const bytes = (...parts: (number[] | string)[]) => new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? Array.from(p).map((c) => c.charCodeAt(0)) : p)));

describe("type réel d'une photo (octets magiques)", () => {
  it("reconnaît JPEG, PNG, WebP, GIF, PDF, HEIC, AVIF, SVG, vide et inconnu", () => {
    expect(detectFileType(bytes([0xff, 0xd8, 0xff, 0xe1]))).toBe("image/jpeg");
    expect(detectFileType(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(detectFileType(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 "))).toBe("image/webp");
    expect(detectFileType(bytes("GIF89a"))).toBe("image/gif");
    expect(detectFileType(bytes("%PDF-1.7"))).toBe("application/pdf");
    expect(detectFileType(bytes([0, 0, 0, 0x18], "ftypheic"))).toBe("image/heic");
    expect(detectFileType(bytes([0, 0, 0, 0x18], "ftypmif1"))).toBe("image/heic");
    expect(detectFileType(bytes([0, 0, 0, 0x18], "ftypavif"))).toBe("image/avif");
    expect(detectFileType(bytes([0xef, 0xbb, 0xbf], "  <?xml version='1.0'?><svg>"))).toBe("image/svg+xml");
    expect(detectFileType(bytes([]))).toBe("empty");
    expect(detectFileType(bytes("bonjour"))).toBe("unknown");
  });

  it("message clair pour chaque refus, null pour une image acceptée", () => {
    expect(photoContentProblem(bytes("%PDF-1.4"), { name: "facture.jpg" })).toBe("« facture.jpg » est un document PDF, pas une photo : JPEG, PNG ou WebP attendu.");
    expect(photoContentProblem(bytes([0, 0, 0, 0x18], "ftypheic"))).toMatch(/HEIC \(iPhone\)/);
    expect(photoContentProblem(bytes([]))).toMatch(/vide/);
    expect(photoContentProblem(bytes([0xff, 0xd8, 0xff]))).toBeNull();
  });

  it("lit l'en-tête d'une data URL sans décoder toute l'image", () => {
    const url = `data:image/jpeg;base64,${Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]).toString("base64")}${"A".repeat(1_000_000)}`;
    const head = dataUrlHead(url);
    expect(head?.declared).toBe("image/jpeg");
    expect(head!.bytes.length).toBeLessThanOrEqual(70);
    expect(detectFileType(head!.bytes)).toBe("application/pdf");
    expect(dataUrlHead("https://exemple.test/a.jpg")).toBeNull();
  });
});
