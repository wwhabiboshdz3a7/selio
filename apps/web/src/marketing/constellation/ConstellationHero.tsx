import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@selio/ui";
import { Sparkle } from "../components";
import { CONSTELLATION, STATUS_LABEL } from "./features";
import "./constellation.css";

/**
 * Héro de la vitrine : une sphère céleste dont les 14 étoiles-fonctionnalités
 * deviennent des cartes au défilement. Le texte, les liens et les cartes sont
 * du vrai HTML (accessible, indexable) ; le canevas est purement décoratif.
 *
 * Le moteur (canvas + anime.js) est chargé à part. Sans lui (mouvement réduit,
 * échec de chargement), la section reste complète : ciel fixe et grille de cartes.
 */

const TITLE = ["Vos", "articles,", "vos", "conversations", "et", "votre", "marge,", "enfin", "alignés."];

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";
function subscribeReduced(onChange: () => void) {
  const mq = window.matchMedia?.(REDUCED_QUERY);
  mq?.addEventListener("change", onChange);
  return () => mq?.removeEventListener("change", onChange);
}
const getReduced = () => window.matchMedia?.(REDUCED_QUERY).matches ?? false;
const getReducedServer = () => false;

export function ConstellationHero() {
  const rootRef = useRef<HTMLElement>(null);
  const reduced = useSyncExternalStore(subscribeReduced, getReduced, getReducedServer);
  const [failed, setFailed] = useState(false);
  const mode: "live" | "static" = reduced || failed ? "static" : "live";
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

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
          onNavigate: (href) => navigateRef.current(href),
          onError: fallBack,
        });
      })
      .catch(fallBack);
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [mode]);

  const live = mode === "live";

  return (
    <section ref={rootRef} className="cst-root" data-mode={mode} data-intro={live ? "pending" : "done"} aria-labelledby="cst-title">
      <div className="cst-track" data-cst="track">
        <div className="cst-stage" data-cst="stage">
          <div className="cst-scene" data-cst="scene">
            <div className="cst-nebula" data-cst="nebula" aria-hidden="true" />
            <div className="cst-limb" data-cst="limb" aria-hidden="true" />
            <canvas className="cst-canvas" data-cst="canvas" aria-hidden="true" />
            <div className="cst-hero" data-cst="hero">
              <div className="cst-hero-text" data-cst="hero-text">
                <p className="cst-eyebrow" data-cst-intro="eyebrow">
                  <Sparkle className="cst-eyebrow-star" />
                  Pour les revendeurs qui tiennent leurs comptes
                </p>
                <h1 id="cst-title" className="cst-title">
                  {TITLE.map((w, i) => (
                    <Fragment key={i}>
                      <span className={i === TITLE.length - 1 ? "cst-word cst-word-glow" : "cst-word"} data-cst-intro="word">{w}</span>
                      {i < TITLE.length - 1 ? " " : null}
                    </Fragment>
                  ))}
                </h1>
                <p className="cst-lead" data-cst-intro="lead">
                  Selio relie votre stock, vos conversations, vos commandes et vos analyses. Quatorze outils pensés pour la revente, et des automatisations qui restent sous votre contrôle.
                </p>
                <div className="cst-ctas">
                  <span data-cst-intro="cta">
                    <Link to="/inscription" className="cst-cta-link">
                      <Button variant="accent" size="lg" iconRight={<ArrowRight />} tabIndex={-1}>Créer un compte</Button>
                    </Link>
                  </span>
                  <span data-cst-intro="cta">
                    <Link to="/demo" className="cst-ghost">Explorer la démo</Link>
                  </span>
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

          <div className="cst-hud" data-cst="hud">
            <div className="cst-hud-top">
              <p className="cst-eyebrow cst-eyebrow-center"><Sparkle className="cst-eyebrow-star" />La constellation Selio</p>
              <h2 id="cst-features-title" className="cst-hud-title">Quatorze fonctionnalités, reliées entre elles</h2>
            </div>
            {live ? (
              <div className="cst-hud-bottom">
                <span className="cst-counter num" aria-hidden="true"><span data-cst="counter">01–02</span><span className="cst-counter-total"> / 14</span></span>
                <span className="cst-progress" aria-hidden="true"><span data-cst="bar" /></span>
                <a href="#parcours" className="cst-skip">Passer la visite</a>
              </div>
            ) : null}
          </div>

          <ol className="cst-cards" aria-labelledby="cst-features-title">
            {CONSTELLATION.map((f, i) => (
              <li key={f.id} className="cst-card-item" data-cst-card="" data-tone={f.tone}>
                <Link to={f.href} className="cst-card">
                  <span className="cst-card-head">
                    <span className="cst-card-num num">{String(i + 1).padStart(2, "0")}</span>
                    <span className="cst-card-status" data-status={f.status}>{STATUS_LABEL[f.status]}</span>
                  </span>
                  <h3 className="cst-card-title">{f.title}</h3>
                  <span className="cst-card-text">{f.text}</span>
                  <span className="cst-card-more">Découvrir <ArrowRight aria-hidden="true" /></span>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div className="cst-horizon" aria-hidden="true" />
    </section>
  );
}
