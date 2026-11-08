import { Link } from "react-router";
import { Alert } from "@selio/ui";
import { Container, Eyebrow, IndependenceNotice } from "../components";
import { EXTENSION_PRIVACY, EXTENSION_PRIVACY_UPDATED } from "../extensionPrivacy";
import { LEGAL_DRAFT_NOTICE, useMarketingMeta } from "../seo";

/** Politique de confidentialité de l'extension (adresse demandée par le Chrome Web Store). */
export default function ExtensionPrivacy() {
  useMarketingMeta("/extension/confidentialite");
  return (
    <section className="mk-hero py-12 md:py-16">
      <Container className="max-w-3xl">
        <Eyebrow>Extension navigateur</Eyebrow>
        <h1 className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-text">Confidentialité de l'extension Selio</h1>
        <p className="mt-2 text-sm text-text-muted">Mise à jour le {EXTENSION_PRIVACY_UPDATED}.</p>
        <Alert tone="warning" title="Version provisoire" className="mt-4">{LEGAL_DRAFT_NOTICE} Le texte décrit ce que fait l'extension aujourd'hui ; les passages entre crochets sont à renseigner.</Alert>
        <div className="prose-selio mt-6 max-w-[70ch] text-base text-text">
          {EXTENSION_PRIVACY.map((s) => (
            <div key={s.h}>
              <h2>{s.h}</h2>
              {s.p.map((p) => <p key={p} className="text-text-muted">{p}</p>)}
            </div>
          ))}
        </div>
        <p className="mt-8 text-sm text-text-muted">
          Le service Selio lui-même est décrit dans la <Link to="/confidentialite" className="font-medium text-accent hover:underline">politique de confidentialité</Link>. Ce que fait l'extension : <Link to="/extension" className="font-medium text-accent hover:underline">page Extension</Link>.
        </p>
        <IndependenceNotice className="mt-6" />
      </Container>
    </section>
  );
}
