import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Download, FolderOpen, KeyRound, MoreVertical, Pin, Plus, Puzzle, ShieldCheck } from "lucide-react";
import { Alert, Button, Field, Input, buttonClass, cn, formatDateTime, useToast } from "@selio/ui";
import { can } from "@selio/domain";
import type { ExtensionToken } from "@selio/contracts";
import { useClient, useRequiredSession } from "../../lib/data/provider";
import { apiBaseUrl } from "../../lib/env";
import { useAppMutation } from "./hooks";

/** Archive de l'extension servie par le site lui-même (construite au build Netlify, voir apps/web/scripts/extension-zip.mjs). */
export const EXTENSION_ZIP_PATH = "/extension/selio-extension.zip";
const EXTENSION_INFO_PATH = "/extension/selio-extension.json";

interface ExtensionPackage {
  version: string;
  bytes: number;
}

/** Fiche de l'archive (version, taille), ou null si ce site ne la sert pas (développement, build sans extension). */
async function fetchExtensionPackage(): Promise<ExtensionPackage | null> {
  try {
    const res = await fetch(EXTENSION_INFO_PATH, { cache: "no-store" });
    // Sans fichier, l'hébergeur renvoie la page de l'application (HTML) : pas d'archive.
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return null;
    const data = (await res.json()) as Partial<ExtensionPackage>;
    return typeof data.version === "string" && typeof data.bytes === "number" ? { version: data.version, bytes: data.bytes } : null;
  } catch {
    return null;
  }
}

/** Adresse de l'API que l'extension doit appeler : celle du site (relais /api/*), déjà pré-remplie dans ses options. */
export function extensionApiAddress(): string {
  return apiBaseUrl || (typeof window !== "undefined" ? window.location.origin : "");
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const { toast } = useToast();
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      icon={done ? <Check /> : <Copy />}
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          window.setTimeout(() => setDone(false), 2000);
        } catch {
          toast({ tone: "danger", title: "Copie impossible", description: "Sélectionnez le texte et copiez-le avec Ctrl + C." });
        }
      }}
    >
      {done ? "Copié" : "Copier"}
    </Button>
  );
}

function Step({ n, title, children, done }: { n: number; title: string; children: ReactNode; done?: boolean }) {
  return (
    <li className="relative flex gap-3 md:gap-4" aria-label={`Étape ${n} : ${title}`}>
      <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold", done ? "border-success bg-success text-white" : "border-border-strong bg-surface text-text")} aria-hidden>
        {done ? <Check className="size-4" /> : n}
      </span>
      <div className="min-w-0 flex-1 pb-2">
        <h3 className="text-base font-semibold text-text">{title}</h3>
        <div className="mt-2 flex flex-col gap-3 text-sm text-text-muted">{children}</div>
      </div>
    </li>
  );
}

/** Schéma de la page des extensions du navigateur : « Mode développeur » puis « Charger l'extension non empaquetée ». */
function ExtensionsPageSketch() {
  return (
    <figure className="max-w-xl" data-testid="schema-page-extensions">
      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm" aria-hidden>
        <div className="flex items-center gap-2 border-b border-border bg-surface-muted px-3 py-2">
          <span className="flex gap-1"><span className="size-2 rounded-full bg-border-strong" /><span className="size-2 rounded-full bg-border-strong" /><span className="size-2 rounded-full bg-border-strong" /></span>
          <span className="flex-1 truncate rounded-md bg-surface px-2 py-0.5 font-mono text-[11px] text-text">chrome://extensions</span>
        </div>
        <div className="flex items-center justify-between gap-3 px-3 py-2.5">
          <span className="text-sm font-semibold text-text">Extensions</span>
          <span className="flex items-center gap-2 rounded-md px-1.5 py-1 text-xs font-medium text-text ring-2 ring-accent">
            Mode développeur
            <span className="relative inline-block h-4 w-7 rounded-full bg-accent"><span className="absolute top-0.5 right-0.5 size-3 rounded-full bg-white" /></span>
          </span>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-border px-3 py-2.5">
          <span className="rounded-md border border-accent bg-accent-soft px-2 py-1 text-xs font-semibold text-text ring-2 ring-accent">Charger l'extension non empaquetée</span>
          <span className="rounded-md border border-border px-2 py-1 text-xs text-text-muted">Empaqueter l'extension</span>
          <span className="rounded-md border border-border px-2 py-1 text-xs text-text-muted">Mettre à jour</span>
        </div>
        <div className="mx-3 mb-3 flex items-center gap-2 rounded-md border border-border p-2">
          <img src="/favicon-32.png" alt="" className="size-5 rounded" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-text">Selio — assistant revendeur</span>
            <span className="block truncate text-[11px] text-text-muted">Chargée depuis le dossier selio-extension</span>
          </span>
          <span className="relative inline-block h-4 w-7 rounded-full bg-accent"><span className="absolute top-0.5 right-0.5 size-3 rounded-full bg-white" /></span>
        </div>
      </div>
      <figcaption className="mt-1.5 text-xs text-text-muted">Schéma : en haut à droite, « Mode développeur » activé ; puis le bouton « Charger l'extension non empaquetée ». Dans Edge, l'interrupteur est dans la colonne de gauche.</figcaption>
    </figure>
  );
}

/** Schéma de la barre d'outils : icône des extensions (pièce de puzzle), puis l'épingle à côté de Selio. */
function PinSketch() {
  return (
    <figure className="max-w-xl" data-testid="schema-epingler">
      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm" aria-hidden>
        <div className="flex items-center gap-2 border-b border-border bg-surface-muted px-3 py-2">
          <span className="flex-1 truncate rounded-md bg-surface px-2 py-0.5 font-mono text-[11px] text-text-muted">www.vinted.fr</span>
          <span className="flex size-6 items-center justify-center rounded-md text-text ring-2 ring-accent"><Puzzle className="size-3.5" /></span>
          <MoreVertical className="size-3.5 text-text-muted" />
        </div>
        <div className="ml-auto w-64 max-w-full border-l border-border p-2">
          <p className="px-1 pb-1 text-[11px] font-semibold text-text-muted">Extensions</p>
          <div className="flex items-center gap-2 rounded-md bg-surface-muted px-2 py-1.5">
            <img src="/favicon-32.png" alt="" className="size-4 rounded" />
            <span className="min-w-0 flex-1 truncate text-xs text-text">Selio — assistant revendeur</span>
            <span className="flex size-5 items-center justify-center rounded text-accent ring-2 ring-accent"><Pin className="size-3" /></span>
          </div>
        </div>
      </div>
      <figcaption className="mt-1.5 text-xs text-text-muted">Schéma : la pièce de puzzle à droite de la barre d'adresse, puis l'épingle à côté de « Selio — assistant revendeur ». Le logo Selio reste alors visible.</figcaption>
    </figure>
  );
}

/** Jeton à coller dans les options de l'extension : créé ici, affiché une seule fois. */
function TokenStep() {
  const client = useClient();
  const session = useRequiredSession();
  const [issued, setIssued] = useState<{ token: ExtensionToken; secret: string } | null>(null);
  const [label, setLabel] = useState("");
  const create = useAppMutation(() => client.createExtensionToken({ label: label.trim() || "Navigateur" }), { invalidate: ["tokens"], onSuccess: (r) => setIssued(r) });
  if (!can(session.role, "tokens.manage")) {
    return <Alert tone="info">Votre rôle ne permet pas de créer un jeton : demandez-le au titulaire ou à un administrateur de l'organisation.</Alert>;
  }
  if (issued) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-success/40 bg-surface p-3" data-testid="extension-token">
        <p className="text-sm font-medium text-text">Jeton créé pour « {issued.token.label} » : copiez-le maintenant, il ne sera plus affiché.</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <code className="block min-w-0 flex-1 rounded-md bg-surface-muted p-2.5 font-mono text-xs break-all text-text select-all">{issued.secret}</code>
          <CopyButton value={issued.secret} label="Copier le jeton" />
        </div>
        <p className="text-xs">Expire le {formatDateTime(issued.token.expiresAt)} ; révocable à tout moment dans Comptes Vinted › Avancé.</p>
      </div>
    );
  }
  return (
    <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); if (!create.isPending) create.mutate(undefined); }}>
      <Field label="Nom de ce navigateur" className="flex-1" hint="Pour le reconnaître plus tard, ex. « Chrome — PC bureau ».">
        {(p) => <Input id={p.id} aria-describedby={p.describedBy} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ex. Chrome — PC bureau" maxLength={80} />}
      </Field>
      <Button type="submit" icon={<KeyRound />} loading={create.isPending}>Créer un jeton</Button>
    </form>
  );
}

/**
 * Installation guidée de l'extension Selio, depuis le site : télécharger, installer dans Chrome, Edge ou Brave,
 * relier à son compte Selio, ajouter ses comptes Vinted (sans jamais de mot de passe Vinted), puis, en option,
 * la configuration de départ. Utilisée dans Démarrage (/app/onboarding) et dans Comptes Vinted.
 */
export function ExtensionInstallGuide({ showSetup = false }: { showSetup?: boolean }) {
  const pkg = useQuery({ queryKey: ["extension-package"], queryFn: fetchExtensionPackage, staleTime: 5 * 60_000 });
  const api = extensionApiAddress();
  const host = api.replace(/^https?:\/\//, "");
  return (
    <ol className="flex flex-col gap-5" aria-label="Installer l'extension Selio, étape par étape" data-testid="extension-guide">
      <Step n={1} title="Télécharger l'extension">
        <p>Sur un ordinateur, avec Chrome, Edge ou Brave (l'extension ne fonctionne pas sur téléphone).</p>
        <div className="flex flex-wrap items-center gap-3">
          {pkg.data ? (
            <a href={EXTENSION_ZIP_PATH} download="selio-extension.zip" className={buttonClass({ variant: "accent" })} data-testid="extension-download">
              <Download aria-hidden /> Télécharger l'extension
            </a>
          ) : (
            <span className={cn(buttonClass({ variant: "accent" }), "pointer-events-none opacity-60")} aria-disabled="true">
              <Download aria-hidden /> Télécharger l'extension
            </span>
          )}
          {pkg.data ? <span className="num text-xs">Fichier selio-extension.zip · version {pkg.data.version} · {Math.max(1, Math.round(pkg.data.bytes / 1024))} Ko</span> : null}
        </div>
        {pkg.isFetched && !pkg.data ? <div data-testid="extension-unavailable"><Alert tone="warning">Le fichier de l'extension n'est pas disponible sur cette installation : il est construit à la mise en ligne du site. Demandez-le à l'équipe Selio.</Alert></div> : null}
      </Step>

      <Step n={2} title="L'installer dans le navigateur">
        <ol className="flex list-decimal flex-col gap-2 pl-5">
          <li><span className="inline-flex items-center gap-1 font-medium text-text"><FolderOpen className="size-3.5" aria-hidden />Décompressez le fichier</span> : clic droit sur selio-extension.zip › « Extraire tout… » (Windows), ou double-clic (Mac). Rangez le dossier obtenu à un endroit stable, par exemple dans Documents : le navigateur le relit à chaque démarrage, ne le supprimez pas.</li>
          <li>
            Ouvrez la page des extensions en collant cette adresse dans la barre d'adresse (un site ne peut pas l'ouvrir pour vous) :
            <span className="mt-1.5 flex flex-wrap gap-2">
              {[["Chrome", "chrome://extensions"], ["Edge", "edge://extensions"], ["Brave", "brave://extensions"]].map(([name, url]) => (
                <span key={url} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1">
                  <span className="text-xs text-text-muted">{name}</span>
                  <code className="font-mono text-xs text-text">{url}</code>
                  <CopyButton value={url!} label={`Copier l'adresse ${url}`} />
                </span>
              ))}
            </span>
          </li>
          <li>Activez le <span className="font-medium text-text">Mode développeur</span> (en haut à droite ; dans Edge, dans la colonne de gauche).</li>
          <li>Cliquez <span className="font-medium text-text">« Charger l'extension non empaquetée »</span> et choisissez le dossier décompressé (celui qui contient le fichier manifest.json).</li>
          <li><span className="font-medium text-text">Épinglez-la</span> : pièce de puzzle à droite de la barre d'adresse, puis l'épingle à côté de « Selio — assistant revendeur ».</li>
        </ol>
        <div className="grid gap-4 lg:grid-cols-2">
          <ExtensionsPageSketch />
          <PinSketch />
        </div>
        <p className="text-xs">Le navigateur peut signaler les extensions en mode développeur au démarrage : c'est normal tant que Selio n'est pas publiée sur le Chrome Web Store ; gardez-la activée.</p>
      </Step>

      <Step n={3} title="Relier l'extension à votre compte Selio">
        <p>La page Options de l'extension s'ouvre seule après l'installation (sinon : clic droit sur le logo Selio › « Options »). L'adresse de Selio y est déjà remplie ; vérifiez qu'elle correspond :</p>
        <span className="flex flex-wrap items-center gap-2">
          <code className="rounded-md bg-surface-muted px-2.5 py-1.5 font-mono text-xs text-text" data-testid="extension-api-address">{api}</code>
          <CopyButton value={api} label="Copier l'adresse de Selio" />
        </span>
        <p>Créez ensuite un jeton pour ce navigateur, collez-le dans « Jeton d'extension », cliquez <span className="font-medium text-text">« Associer »</span> et acceptez l'autorisation demandée (accès à {host} seulement). La fenêtre de l'extension affiche alors « Associée ».</p>
        <TokenStep />
      </Step>

      <Step n={4} title="Ajouter vos comptes Vinted">
        <p className="flex items-start gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /><span>Selio ne vous demande jamais votre mot de passe Vinted. Connectez-vous à Vinted comme d'habitude, dans ce même navigateur : l'extension lit seulement les pages Vinted que vous ouvrez.</span></p>
        <ol className="flex list-decimal flex-col gap-1 pl-5">
          <li>Ajoutez chaque compte dans Selio : son pseudo Vinted et sa catégorie (vente, achat ou perso).</li>
          <li>Ouvrez une page de Vinted avec ce compte : il passe à « Connecté » dans Comptes Vinted.</li>
        </ol>
        <div><Link to="/app/accounts?ajouter=1" className={buttonClass({ variant: "secondary" })}><Plus aria-hidden /> Ajouter un compte Vinted</Link></div>
      </Step>

      {showSetup ? (
        <Step n={5} title="Configuration de départ">
          <ul className="flex list-disc flex-col gap-1 pl-5">
            <li><Link to="/app/automatisation/negociation" className="font-medium text-text underline underline-offset-2">Marges et négociation</Link> : votre marge minimale et la remise maximale acceptée.</li>
            <li><Link to="/app/automatisation" className="font-medium text-text underline underline-offset-2">Automatisations</Link> : choisissez ce que Selio fait seul, compte par compte.</li>
            <li><Link to="/studio" className="font-medium text-text underline underline-offset-2">Selio Studio</Link> : une première annonce à partir de vos photos.</li>
            <li><Link to="/app/onboarding" className="font-medium text-text underline underline-offset-2">Démarrage</Link> : les étapes restantes, à votre rythme.</li>
          </ul>
        </Step>
      ) : null}
    </ol>
  );
}
