import { useEffect } from "react";

/** Titre et description de page (SEO de base, pages indexables de la vitrine). */
export function usePageMeta(title: string, description?: string, opts: { noindex?: boolean } = {}) {
  useEffect(() => {
    const prev = document.title;
    document.title = title.includes("Selio") ? title : `${title} — Selio`;
    const ensure = (name: string, attr: "name" | "property" = "name") => {
      let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${name}"]`);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, name);
        document.head.appendChild(el);
      }
      return el;
    };
    if (description) {
      ensure("description").content = description;
      ensure("og:description", "property").content = description;
    }
    ensure("og:title", "property").content = document.title;
    const robots = ensure("robots");
    robots.content = opts.noindex ? "noindex, nofollow" : "index, follow";
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = `${window.location.origin}${window.location.pathname}`;
    return () => {
      document.title = prev;
    };
  }, [title, description, opts.noindex]);
}
