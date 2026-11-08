import {
  SAFE_GLASS_CAPABILITIES,
  detectGlassCapabilities,
  glassCapabilitiesKey,
  glassModeFor,
  isChromiumEngine,
  type GlassEnvironment,
} from "./glass";

/** Environnement simulé : propriétés CSS gérées et requêtes média vraies. */
function env({
  supported = [] as string[],
  media = [] as string[],
  chromium = false,
}: { supported?: string[]; media?: string[]; chromium?: boolean } = {}): GlassEnvironment {
  return {
    CSS: {
      supports: (property: string, value: string) =>
        supported.some((s) => `${property}:${value}`.startsWith(s)),
    },
    matchMedia: (query: string) => ({ matches: media.includes(query) }),
    navigator: chromium
      ? { userAgentData: { brands: [] }, userAgent: "ignoré" }
      : { userAgent: "Chrome/999 (ne doit pas compter)" },
  };
}

const GLASS = ["backdrop-filter:blur", "background-color:color-mix"];
const WEBKIT_GLASS = ["-webkit-backdrop-filter:blur", "background-color:color-mix"];
const URL_FILTERS = ["filter:url(", "backdrop-filter:url("];

describe("detectGlassCapabilities", () => {
  it("renvoie des valeurs sûres sans navigateur (opaque, sans animation, sans réfraction)", () => {
    expect(SAFE_GLASS_CAPABILITIES).toEqual({
      backdrop: false,
      reducedTransparency: false,
      reducedMotion: true,
      moreContrast: false,
      refraction: false,
    });
    expect(detectGlassCapabilities({})).toMatchObject({ backdrop: false, refraction: false });
    expect(glassModeFor(SAFE_GLASS_CAPABILITIES).mode).toBe("opaque");
  });

  it("détecte backdrop-filter, avec ou sans préfixe -webkit-, et exige color-mix()", () => {
    expect(detectGlassCapabilities(env({ supported: GLASS })).backdrop).toBe(true);
    expect(detectGlassCapabilities(env({ supported: WEBKIT_GLASS })).backdrop).toBe(true);
    expect(detectGlassCapabilities(env({ supported: ["backdrop-filter:blur"] })).backdrop).toBe(
      false,
    );
    expect(detectGlassCapabilities(env()).backdrop).toBe(false);
  });

  it("lit les préférences système par matchMedia", () => {
    const caps = detectGlassCapabilities(
      env({
        supported: GLASS,
        media: [
          "(prefers-reduced-transparency: reduce)",
          "(prefers-reduced-motion: reduce)",
          "(prefers-contrast: more)",
        ],
      }),
    );
    expect(caps).toMatchObject({
      reducedTransparency: true,
      reducedMotion: true,
      moreContrast: true,
    });
    expect(detectGlassCapabilities(env({ supported: GLASS }))).toMatchObject({
      reducedTransparency: false,
      reducedMotion: false,
      moreContrast: false,
    });
  });

  it("ne permet la réfraction qu'avec filtres SVG en CSS ET moteur Chromium (par capacité, pas par User-Agent)", () => {
    expect(
      detectGlassCapabilities(env({ supported: [...GLASS, ...URL_FILTERS], chromium: true }))
        .refraction,
    ).toBe(true);
    // Chaîne User-Agent « Chrome » mais sans l'API Client Hints : pas de réfraction.
    expect(
      detectGlassCapabilities(env({ supported: [...GLASS, ...URL_FILTERS], chromium: false }))
        .refraction,
    ).toBe(false);
    // Chromium mais filtre url() refusé : pas de réfraction.
    expect(detectGlassCapabilities(env({ supported: GLASS, chromium: true })).refraction).toBe(
      false,
    );
    // Sans flou d'arrière-plan, jamais de réfraction.
    expect(
      detectGlassCapabilities(env({ supported: URL_FILTERS, chromium: true })).refraction,
    ).toBe(false);
    expect(isChromiumEngine({ navigator: { userAgent: "Mozilla/5.0 Chrome/130" } })).toBe(false);
  });

  it("survit à un CSS.supports ou un matchMedia qui lève une erreur", () => {
    const broken: GlassEnvironment = {
      CSS: {
        supports: () => {
          throw new Error("boum");
        },
      },
      matchMedia: () => {
        throw new Error("boum");
      },
    };
    expect(detectGlassCapabilities(broken)).toMatchObject({
      backdrop: false,
      reducedMotion: false,
      refraction: false,
    });
  });
});

describe("glassModeFor", () => {
  const base = {
    backdrop: true,
    reducedTransparency: false,
    reducedMotion: false,
    moreContrast: false,
    refraction: false,
  };

  it("choisit le verre quand tout le permet", () => {
    expect(glassModeFor(base)).toEqual({ mode: "glass", reason: null });
  });

  it("revient à l'opaque sans backdrop-filter, avec transparence réduite ou contraste renforcé", () => {
    expect(glassModeFor({ ...base, backdrop: false })).toEqual({
      mode: "opaque",
      reason: "no-backdrop",
    });
    expect(glassModeFor({ ...base, reducedTransparency: true })).toEqual({
      mode: "opaque",
      reason: "reduced-transparency",
    });
    expect(glassModeFor({ ...base, moreContrast: true })).toEqual({
      mode: "opaque",
      reason: "more-contrast",
    });
  });

  it("le mouvement réduit ne coupe pas le verre (seulement l'animation)", () => {
    expect(glassModeFor({ ...base, reducedMotion: true }).mode).toBe("glass");
  });

  it("fournit une clé stable par jeu de capacités", () => {
    expect(glassCapabilitiesKey(base)).toBe(glassCapabilitiesKey({ ...base }));
    expect(glassCapabilitiesKey(base)).not.toBe(
      glassCapabilitiesKey({ ...base, moreContrast: true }),
    );
  });
});
