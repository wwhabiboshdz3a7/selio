import { describe, expect, it } from "vitest";
import { amzDate, presignUrl, signingKey, uriEncode } from "./sigv4";

// Vecteur officiel du guide SigV4 d'AWS (Amazon S3, « Authenticating Requests: Using Query Parameters »,
// exemple « GET presigned URL »).
const AWS_EXAMPLE = {
  method: "GET" as const,
  url: "https://examplebucket.s3.amazonaws.com/test.txt",
  region: "us-east-1",
  accessKey: "AKIAIOSFODNN7EXAMPLE",
  secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  date: new Date("2013-05-24T00:00:00Z"),
  expiresSeconds: 86400,
};

describe("uriEncode", () => {
  it("laisse les caractères non réservés et encode le reste en majuscules", () => {
    expect(uriEncode("abc-_.~09")).toBe("abc-_.~09");
    expect(uriEncode("a b/é")).toBe("a%20b%2F%C3%A9");
    expect(uriEncode("a b/é", false)).toBe("a%20b/%C3%A9");
    expect(uriEncode("AKIA/2013/us-east-1/s3/aws4_request")).toBe("AKIA%2F2013%2Fus-east-1%2Fs3%2Faws4_request");
  });
});

describe("amzDate", () => {
  it("produit la forme basique ISO 8601", () => {
    expect(amzDate(new Date("2013-05-24T00:00:00Z"))).toBe("20130524T000000Z");
    expect(amzDate(new Date("2026-10-28T13:05:09.123Z"))).toBe("20261028T130509Z");
  });
});

describe("signingKey", () => {
  it("dérive une clé de 32 octets, déterministe, propre à la date, la région et le service", () => {
    const k = signingKey(AWS_EXAMPLE.secretKey, "20130524", "us-east-1", "s3");
    expect(k).toHaveLength(32);
    expect(k.equals(signingKey(AWS_EXAMPLE.secretKey, "20130524", "us-east-1", "s3"))).toBe(true);
    expect(k.equals(signingKey(AWS_EXAMPLE.secretKey, "20130525", "us-east-1", "s3"))).toBe(false);
    expect(k.equals(signingKey(AWS_EXAMPLE.secretKey, "20130524", "fr-mrs-1", "s3"))).toBe(false);
    expect(k.equals(signingKey(AWS_EXAMPLE.secretKey, "20130524", "us-east-1", "iam"))).toBe(false);
    expect(k.equals(signingKey("autre-secret", "20130524", "us-east-1", "s3"))).toBe(false);
  });
});

describe("presignUrl", () => {
  it("reproduit la signature officielle AWS « GET presigned URL »", () => {
    const res = presignUrl(AWS_EXAMPLE);
    expect(res.canonicalRequest).toBe(
      [
        "GET",
        "/test.txt",
        "X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host",
        "host:examplebucket.s3.amazonaws.com\n",
        "host",
        "UNSIGNED-PAYLOAD",
      ].join("\n"),
    );
    expect(res.stringToSign).toBe(["AWS4-HMAC-SHA256", "20130524T000000Z", "20130524/us-east-1/s3/aws4_request", "3bfa292879f6447bbcda7001decf97f4a54dc650c8942174ae0a9121cf58ad04"].join("\n"));
    expect(res.signature).toBe("aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
    expect(res.url).toBe(
      "https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
    expect(res.expiresAt.toISOString()).toBe("2013-05-25T00:00:00.000Z");
  });

  it("signe les en-têtes supplémentaires (PUT avec type et taille) et les trie", () => {
    const res = presignUrl({ ...AWS_EXAMPLE, method: "PUT", headers: { "Content-Type": "image/jpeg", "content-length": " 1234 " } });
    expect(res.signedHeaders).toBe("content-length;content-type;host");
    expect(res.canonicalRequest).toContain("content-length:1234\ncontent-type:image/jpeg\nhost:examplebucket.s3.amazonaws.com\n");
    expect(res.url).toContain("X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost");
    expect(res.signature).not.toBe("aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
    expect(res.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it("intègre les paramètres de requête supplémentaires dans l'ordre canonique", () => {
    const res = presignUrl({ ...AWS_EXAMPLE, query: { "response-content-disposition": "inline" } });
    expect(res.canonicalRequest.split("\n")[2]).toBe(
      "X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&response-content-disposition=inline",
    );
  });

  it("garde l'hôte avec son port non standard (MinIO en local) et un chemin de style path", () => {
    const res = presignUrl({ ...AWS_EXAMPLE, url: "http://127.0.0.1:9000/selio-photos/org/o1/item-photo/i1.jpg" });
    expect(res.canonicalRequest).toContain("host:127.0.0.1:9000\n");
    expect(res.canonicalRequest.split("\n")[1]).toBe("/selio-photos/org/o1/item-photo/i1.jpg");
    expect(res.url.startsWith("http://127.0.0.1:9000/selio-photos/org/o1/item-photo/i1.jpg?X-Amz-Algorithm=")).toBe(true);
  });

  it("change de signature quand le secret, la méthode ou la date changent", () => {
    const base = presignUrl(AWS_EXAMPLE).signature;
    expect(presignUrl({ ...AWS_EXAMPLE, secretKey: "autre" }).signature).not.toBe(base);
    expect(presignUrl({ ...AWS_EXAMPLE, method: "PUT" }).signature).not.toBe(base);
    expect(presignUrl({ ...AWS_EXAMPLE, date: new Date("2013-05-24T00:00:01Z") }).signature).not.toBe(base);
  });

  it("refuse une durée hors bornes et une URL déjà paramétrée", () => {
    expect(() => presignUrl({ ...AWS_EXAMPLE, expiresSeconds: 0 })).toThrow(RangeError);
    expect(() => presignUrl({ ...AWS_EXAMPLE, expiresSeconds: 604_801 })).toThrow(RangeError);
    expect(() => presignUrl({ ...AWS_EXAMPLE, expiresSeconds: 1.5 })).toThrow(RangeError);
    expect(() => presignUrl({ ...AWS_EXAMPLE, url: "https://examplebucket.s3.amazonaws.com/test.txt?x=1" })).toThrow(/paramètres/);
  });
});
