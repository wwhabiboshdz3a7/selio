import { Logo } from "../icons/Logo";

export function Footer() {
  return (
    <footer className="mt-16 bg-[var(--color-selio-dark)] text-white/80">
      <div className="selio-container grid gap-8 py-10 sm:grid-cols-3">
        <div>
          <Logo variant="light" size="md" />
          <p className="mt-3 max-w-xs text-sm text-white/60">
            Selio est la place de marche pour acheter et vendre vos vetements et accessoires de seconde main, simplement.
          </p>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-white">Selio</h3>
          <ul className="mt-3 space-y-2 text-sm text-white/60">
            <li>Vendre un article</li>
            <li>Comment ca marche</li>
            <li>Securite &amp; confiance</li>
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-white">A savoir</h3>
          <p className="mt-3 text-sm text-white/60">
            Version MVP de demonstration : les paiements en ligne ne sont pas encore actives. Aucune transaction reelle n&rsquo;est traitee sur ce site.
          </p>
        </div>
      </div>
      <div className="border-t border-white/10 py-4 text-center text-xs text-white/40">
        © {new Date().getFullYear()} Selio. Tous droits reserves.
      </div>
    </footer>
  );
}
