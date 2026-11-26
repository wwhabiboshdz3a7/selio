import { Link } from "react-router";
import { buttonClass } from "@selio/ui";
import { usePageMeta } from "../../lib/seo";
import { Container, Eyebrow } from "../components";

/** Page 404 de la vitrine : toute adresse inconnue (jamais indexée). */
export default function NotFound() {
  usePageMeta("Page introuvable", "Cette adresse n'existe pas sur le site Selio.", { noindex: true });
  return (
    <section className="mk-hero py-16 md:py-24" data-testid="page-404">
      <Container className="max-w-xl text-center">
        <Eyebrow>Erreur 404</Eyebrow>
        <h1 className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-text">Page introuvable</h1>
        <p className="mt-2 text-sm text-text-muted">L'adresse demandée n'existe pas ou n'existe plus.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link to="/" className={buttonClass({ variant: "accent" })}>Accueil</Link>
          <Link to="/inscription" className={buttonClass({ variant: "secondary" })}>Essai gratuit</Link>
        </div>
      </Container>
    </section>
  );
}
