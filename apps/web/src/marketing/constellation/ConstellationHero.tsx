import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowRight } from "lucide-react";
import { buttonClass } from "@selio/ui";
import { Sparkle } from "../components";
import { setOverNight } from "../nightHeader";
import { CONSTELLATION, STATUS_LABEL } from "./features";
import "./constellation.css";

/**
 * Héro de la vitrine : une sphère céleste dont les 14 étoiles-fonctionnalités
 * deviennent des cartes au défilement, puis une quinzième carte, « Votre
 * constellation commence ici », qui porte les deux actions. Le texte, les liens
 * et les cartes sont du vrai HTML (accessible, indexable) ; les canevas sont
 * purement décoratifs.
 *
 * Le titre apparaît mot à mot en CSS pur, sans attendre le moteur (canvas +
 * anime.js, chargé à part). Sans moteur (mouvement réduit, écran très bas,
 * échec de chargement), la section reste complète : ciel fixe et grille.
 */

const TITLE = ["Vos", "articles,", "vos", "conversations", "et", "votre", "marge,", "enfin", "alignés."];
const PAIRS = Array.from({ length: CONSTELLATION.length / 2 }, (_, k) => [CONSTELLATION[2 * k], CONSTELLATION[2 * k + 1]] as const);

/** Mouvement réduit, ou écran trop bas pour une visite épinglée (téléphone en paysage). */
const STATIC_QUERY = "(prefers-reduced-motion: reduce), (max-height: 500px)";
function subscribeStatic(onChange: () => void) {
  const mq = window.matchMedia?.(STATIC_QUERY);
  mq?.addEventListener("change", onChange);
  return () => mq?.removeEventListener("change", onChange);
}
const getStatic = () => window.matchMedia?.(STATIC_QUERY).matches ?? false;
const getStaticServer = () => false;

/** L'intro complète ne se joue qu'une fois par session ; ensuite, une version courte. */
const INTRO_KEY = "selio:intro-vue";
function readIntroSeen(): boolean {
  try {
    return window.sessionStorage.getItem(INTRO_KEY) === "1";
  } catch {
    return false;
  }
}

export function ConstellationHero() {
  const rootRef = useRef<HTMLElement>(null);
  const nightZoneRef = useRef<HTMLSpanElement>(null);
  const isStatic = useSyncExternalStore(subscribeStatic, getStatic, getStaticServer);
  const [failed, setFailed] = useState(false);
  const [introSeen] = useState(readIntroSeen);
  const mode: "live" | "static" = isStatic || failed ? "static" : "live";
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(INTRO_KEY, "1");
    } catch {
      // Stockage indisponible (navigation privée stricte) : l'intro complète rejouera.
    }
  }, []);

  // En-tête « nuit » tant que le ciel (jusqu'au milieu de l'horizon) passe sous
  // l'en-tête : on observe cette zone à travers une ligne d'un pixel au bas de
  // l'en-tête (fiable même après un saut de défilement).
  useEffect(() => {
    const zone = nightZoneRef.current;
    if (!zone || typeof IntersectionObserver === "undefined") return;
    let io: IntersectionObserver | null = null;
    const observe = () => {
      io?.disconnect();
      io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) setOverNight(e.isIntersecting);
        },
        { rootMargin: `-56px 0px -${Math.max(0, window.innerHeight - 57)}px 0px` },
      );
      io.observe(zone);
    };
    observe();
    let timer = 0;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(observe, 150);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.clearTimeout(timer);
      io?.disconnect();
      setOverNight(false);
    };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let cancelled = false;
    let destroy: (() => void) | undefined;
    const fallBack = (error: unknown) => {
      if (cancelled) return;
      console.warn("Constellation : affichage statique", error);
      if (mode === "live") setFailed(true);
    };
    import("./engine")
      .then(({ mountConstellation }) => {
        if (cancelled) return;
        destroy = mountConstellation(root, {
          mode: mode === "live" ? "live" : "still",
          intro: introSeen ? "short" : "full",
          onNavigate: (href) => navigateRef.current(href),
          onError: fallBack,
        });
      })
      .catch(fallBack);
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [mode, introSeen]);

  const live = mode === "live";

  return (
    <section ref={rootRef} className="cst-root" data-mode={mode} data-intro={live ? "pending" : "done"} data-text={live && !introSeen ? "play" : "still"} aria-labelledby="cst-title">
      <div className="cst-track" data-cst="track">
        <div className="cst-stage" data-cst="stage">
          <div className="cst-scene" data-cst="scene">
            <div className="cst-nebula" data-cst="nebula" aria-hidden="true" />
            <div className="cst-limb" data-cst="limb" aria-hidden="true" />
            <canvas className="cst-canvas" data-cst="canvas" aria-hidden="true" />
            <canvas className="cst-labels" data-cst="labels" aria-hidden="true" />
            <div className="cst-hero" data-cst="hero">
              <div className="cst-hero-text" data-cst="hero-text">
                <p className="cst-eyebrow" data-cst-intro="eyebrow">
                  <Sparkle className="cst-eyebrow-star" />
                  Pour les revendeurs qui tiennent leurs comptes
                </p>
                <h1 id="cst-title" className="cst-title">
                  {TITLE.map((w, i) => (
                    <Fragment key={i}>
                      <span className={i === TITLE.length - 1 ? "cst-word cst-word-glow" : "cst-word"} data-cst-intro="word" style={{ "--i": i } as CSSProperties}>{w}</span>
                      {i < TITLE.length - 1 ? " " : null}
                    </Fragment>
                  ))}
                </h1>
                <p className="cst-lead" data-cst-intro="lead">
                  Selio relie votre stock, vos conversations, vos commandes et vos analyses. Quatorze modules pensés pour la revente, et des automatisations qui restent sous votre contrôle.
                </p>
                <div className="cst-ctas">
                  <Link to="/inscription" className={buttonClass({ variant: "accent", size: "lg", className: "cst-cta-link" })} data-cst-intro="cta" style={{ "--i": 0 } as CSSProperties}>
                    Créer un compte <ArrowRight aria-hidden="true" />
                  </Link>
                  <Link to="/demo" className="cst-ghost" data-cst-intro="cta" style={{ "--i": 1 } as CSSProperties}>Explorer la démo</Link>
                  {live ? <a href="#application" className="cst-skip-a11y">Passer la visite des fonctionnalités</a> : null}
                </div>
                <p className="cst-note" data-cst-intro="note">La démonstration fonctionne sans compte ni carte bancaire, avec des données fictives.</p>
                {live ? (
                  <p className="cst-hint" data-cst-intro="note" aria-hidden="true">
                    <span className="cst-hint-fine">Glissez pour faire tourner la sphère, survolez une étoile, puis défilez pour entrer.</span>
                    <span className="cst-hint-coarse">Touchez une étoile, puis défilez pour entrer.</span>
                  </p>
                ) : null}
              </div>
            </div>
            {live ? (
              <div className="cst-tip" data-cst="tip" aria-hidden="true">
                <div className="cst-tip-inner" data-cst="tip-inner">
                  <p className="cst-tip-title" data-cst="tip-title" />
                  <p className="cst-tip-text" data-cst="tip-text" />
                  <p className="cst-tip-more">Voir le détail <ArrowRight aria-hidden="true" /></p>
                </div>
              </div>
            ) : null}
          </div>

          {/* Repères de visite : jamais au-dessus des cartes pour la souris (pointer-events: none). */}
          <div className="cst-hud" data-cst="hud">
            <div className="cst-hud-top" data-cst="hud-top">
              <p className="cst-eyebrow cst-eyebrow-center"><Sparkle className="cst-eyebrow-star" />La constellation Selio</p>
              <h2 id="cst-features-title" className="cst-hud-title">Quatorze modules, reliés entre eux</h2>
            </div>
            {live ? (
              <div className="cst-hud-bottom" data-cst="hud-bottom">
                <span className="cst-counter num" aria-hidden="true"><span data-cst="counter">01–02</span><span className="cst-counter-total"> / 14</span></span>
                {/* Mini-constellation : une paire par repère, cliquable (le clavier passe par les cartes). */}
                <span className="cst-dots" data-cst="dots" aria-hidden="true">
                  {PAIRS.map(([a, b], k) => (
                    <button key={k} type="button" tabIndex={-1} className="cst-dot-pair" data-pair={k} data-state={k === 0 ? "current" : "next"} title={`${a?.title ?? ""} · ${b?.title ?? ""}`}>
                      <i data-tone={a?.tone} />
                      <i data-tone={b?.tone} />
                    </button>
                  ))}
                </span>
                <a href="#application" className="cst-skip" data-cst="skip" tabIndex={-1} aria-hidden="true">Passer la visite</a>
              </div>
            ) : null}
          </div>

          <ol className="cst-cards" aria-labelledby="cst-features-title">
            {CONSTELLATION.map((f, i) => (
              <li key={f.id} className="cst-card-item" data-cst-card="" data-tone={f.tone}>
                <Link to={f.href} className="cst-card" aria-labelledby={`cst-t-${f.id}`} aria-describedby={`cst-s-${f.id} cst-d-${f.id}`}>
                  <span className="cst-card-head">
                    <span className="cst-card-num num" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                    <span className="cst-card-status" id={`cst-s-${f.id}`} data-status={f.status}>{STATUS_LABEL[f.status]}</span>
                  </span>
                  <h3 className="cst-card-title" id={`cst-t-${f.id}`}>{f.title}</h3>
                  <span className="cst-card-text" id={`cst-d-${f.id}`}>{f.text}</span>
                  <span className="cst-card-more" aria-hidden="true">Découvrir <ArrowRight /></span>
                </Link>
              </li>
            ))}
          </ol>

          {/* Quinzième carte : la fin de la visite devient une action. */}
          <div className="cst-finale" data-cst="finale">
            <div className="cst-finale-card">
              <p className="cst-eyebrow cst-eyebrow-center"><Sparkle className="cst-eyebrow-star" />Quinzième étoile</p>
              <h3 className="cst-finale-title">Votre constellation commence ici</h3>
              <p className="cst-finale-text">Les quatorze modules, reliés à vos propres articles. La démonstration s'ouvre sans compte, avec des données fictives.</p>
              <div className="cst-ctas cst-finale-ctas">
                <Link to="/inscription" className={buttonClass({ variant: "accent", size: "lg", className: "cst-cta-link" })}>
                  Créer un compte <ArrowRight aria-hidden="true" />
                </Link>
                <Link to="/demo" className="cst-ghost">Explorer la démo</Link>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="cst-horizon" aria-hidden="true" />
      <span ref={nightZoneRef} className="cst-night-zone" aria-hidden="true" />
    </section>
  );
}
