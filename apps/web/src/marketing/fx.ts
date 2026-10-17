/**
 * Effets discrets de la vitrine (anime.js), chargés à la demande par useFx :
 * rien de ce fichier n'entre dans le bundle initial, et rien ne s'exécute en
 * mouvement réduit. Chaque effet se met en pause hors écran (anime.js se met
 * déjà en pause quand l'onglet est masqué) et se nettoie entièrement.
 */
import { animate, createDrawable, createTimeline, stagger, utils } from "animejs";
import type { JSAnimation, Timeline } from "animejs";

type Cleanup = () => void;

/** Ciel du bandeau d'appel : les étoiles scintillent, les lignes se tracent une fois. */
export function sky(svg: Element): Cleanup {
  const stars = Array.from(svg.querySelectorAll<SVGElement>(".mk-sky-star"));
  const lines = Array.from(svg.querySelectorAll<SVGGeometryElement>(".mk-sky-line"));
  const drawables = lines.length ? createDrawable(lines) : [];
  const hidden = drawables.length ? utils.set(drawables, { draw: "0 0" }) : null;
  const twinkle = animate(stars, {
    opacity: () => [utils.random(0.15, 0.45, 2), 1],
    duration: () => utils.random(1600, 3400),
    delay: () => utils.random(0, 2400),
    ease: "inOutSine",
    loop: true,
    alternate: true,
    autoplay: false,
  });
  let draw: JSAnimation | null = null;
  const io = new IntersectionObserver((entries) => {
    const visible = entries.some((e) => e.isIntersecting);
    if (!visible) {
      twinkle.pause();
      return;
    }
    twinkle.play();
    if (!draw && drawables.length) draw = animate(drawables, { draw: ["0 0", "0 1"], duration: 1800, delay: stagger(320), ease: "inOutQuad" });
  });
  io.observe(svg);
  return () => {
    io.disconnect();
    twinkle.revert();
    draw?.revert();
    hidden?.revert();
  };
}

/** Apparition au défilement : seuls les éléments encore hors écran sont concernés. */
export function reveal(root: Element): Cleanup {
  const els = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
  const vh = window.innerHeight;
  const pending = new Set<HTMLElement>();
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.top < vh * 0.92 && r.bottom > 0) continue;
    el.style.opacity = "0";
    el.style.transform = "translate3d(0, 22px, 0) scale(0.985)";
    pending.add(el);
  }
  const anims: JSAnimation[] = [];
  const io = new IntersectionObserver(
    (entries) => {
      const batch: HTMLElement[] = [];
      for (const e of entries) {
        const el = e.target as HTMLElement;
        if (!e.isIntersecting || !pending.has(el)) continue;
        pending.delete(el);
        io.unobserve(el);
        batch.push(el);
      }
      if (!batch.length) return;
      anims.push(
        animate(batch, {
          opacity: [0, 1],
          translateY: [22, 0],
          scale: [0.985, 1],
          duration: 760,
          delay: stagger(90),
          ease: "outCubic",
          // cleanInlineStyles restaurerait l'état masqué posé plus haut : on retire tout.
          onComplete: () => {
            for (const el of batch) {
              el.style.removeProperty("opacity");
              el.style.removeProperty("transform");
            }
          },
        }),
      );
    },
    { rootMargin: "0px 0px -6% 0px" },
  );
  pending.forEach((el) => io.observe(el));
  return () => {
    io.disconnect();
    for (const a of anims) a.revert();
    for (const el of els) {
      el.style.removeProperty("opacity");
      el.style.removeProperty("transform");
    }
  };
}

/** Constellation d'une réponse : les étoiles s'allument, puis se relient dans l'ordre. */
export function flow(root: Element): Cleanup {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>(".mk-flow-node"));
  const links = Array.from(root.querySelectorAll<HTMLElement>(".mk-flow-link"));
  const bodies = Array.from(root.querySelectorAll<HTMLElement>(".mk-flow-body"));
  const horizontal = window.matchMedia?.("(min-width: 900px)").matches ?? false;
  const axis = horizontal ? "scaleX" : "scaleY";
  const initial = [
    utils.set(nodes, { scale: 0, opacity: 0 }),
    utils.set(links, { [axis]: 0 }),
    utils.set(bodies, { opacity: 0, translateY: 10 }),
  ];
  let tl: Timeline | null = null;
  let glow: JSAnimation | null = null;
  const io = new IntersectionObserver(
    (entries) => {
      const visible = entries.some((e) => e.isIntersecting);
      if (!visible) {
        glow?.pause();
        return;
      }
      if (tl) {
        glow?.play();
        return;
      }
      const step = 260;
      tl = createTimeline({ defaults: { ease: "outCubic" } });
      nodes.forEach((n, i) => {
        tl!.add(n, { scale: [0, 1.25, 1], opacity: [0, 1], duration: 620, ease: "outBack(2)" }, i * step);
        const b = bodies[i];
        if (b) tl!.add(b, { opacity: [0, 1], translateY: [10, 0], duration: 640 }, i * step + 80);
        const l = links[i];
        if (l) tl!.add(l, { [axis]: [0, 1], duration: step + 140, ease: "inOutSine" }, i * step + 180);
      });
      const last = nodes[nodes.length - 1];
      tl.call(() => {
        if (last) glow = animate(last, { scale: [1, 1.18], duration: 1500, ease: "inOutSine", loop: true, alternate: true });
      }, nodes.length * step + 500);
    },
    { rootMargin: "0px 0px -12% 0px" },
  );
  io.observe(root);
  return () => {
    io.disconnect();
    glow?.revert();
    tl?.revert();
    for (const a of initial) a.revert();
    for (const el of [...nodes, ...links, ...bodies]) {
      el.style.removeProperty("opacity");
      el.style.removeProperty("transform");
    }
  };
}

