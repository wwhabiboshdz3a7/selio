import { Navigate, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CalendarCheck, HeartHandshake, Loader2, Wallet } from "lucide-react";
import { PLAN_LABELS, betaDateLabel } from "@selio/contracts";
import { Logo } from "../../components/Logo";
import { useClient, useRequiredSession } from "../../lib/data/provider";
import { useAppMutation } from "../components/hooks";

/** Page suivante : le démarrage (installation de l'extension). */
export const AFTER_WELCOME_PATH = "/app/onboarding";

/**
 * Constellation de l'accueil : points reliés un à un, puis l'étincelle d'or au centre (≈ 1,6 s, transform,
 * opacity et tracé seulement). Avec « réduire les animations », tout est affiché d'emblée, immobile.
 */
const STARS: [number, number, number][] = [
  [38, 132, 2.2], [92, 70, 2.8], [150, 108, 2], [200, 46, 3.2], [252, 104, 2.2], [310, 62, 2.6], [362, 128, 2], [128, 168, 1.6], [278, 162, 1.8],
];
const LINKS: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [2, 7], [4, 8]];

const CSS = `
.bw-root { background: radial-gradient(120% 90% at 50% 0%, var(--violet-700) 0%, var(--violet-900) 62%, #160d33 100%); }
.bw-star { transform-box: fill-box; transform-origin: center; animation: bw-pop 420ms cubic-bezier(.2,.9,.3,1.25) both; }
.bw-line { stroke-dasharray: 1; stroke-dashoffset: 1; animation: bw-draw 360ms ease-out forwards; }
.bw-spark { transform-box: fill-box; transform-origin: center; animation: bw-spark 700ms 1050ms cubic-bezier(.2,.9,.3,1.2) both; }
.bw-halo { transform-box: fill-box; transform-origin: center; animation: bw-halo 1400ms 1100ms ease-out both; }
.bw-rise { animation: bw-rise 600ms cubic-bezier(.2,0,0,1) both; }
.bw-twinkle { animation: bw-twinkle 3.2s 1.8s ease-in-out infinite; }
@keyframes bw-pop { from { opacity: 0; transform: scale(0); } to { opacity: 1; transform: scale(1); } }
@keyframes bw-draw { to { stroke-dashoffset: 0; } }
@keyframes bw-spark { 0% { opacity: 0; transform: scale(0) rotate(-60deg); } 70% { opacity: 1; transform: scale(1.15) rotate(8deg); } 100% { opacity: 1; transform: scale(1) rotate(0); } }
@keyframes bw-halo { 0% { opacity: 0; transform: scale(.4); } 40% { opacity: .55; } 100% { opacity: 0; transform: scale(2.4); } }
@keyframes bw-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@keyframes bw-twinkle { 0%, 100% { opacity: 1; } 50% { opacity: .45; } }
@media (prefers-reduced-motion: reduce) {
  .bw-star, .bw-line, .bw-spark, .bw-rise, .bw-twinkle { animation: none !important; opacity: 1 !important; transform: none !important; stroke-dashoffset: 0 !important; }
  .bw-halo { animation: none !important; opacity: 0 !important; }
}
`;

function Constellation() {
  return (
    <svg viewBox="0 0 400 200" className="mx-auto h-auto w-full max-w-[420px]" role="img" aria-label="Une constellation s'allume, une étincelle d'or au centre">
      <g stroke="var(--violet-300)" strokeOpacity="0.55" strokeWidth="1" fill="none" strokeLinecap="round">
        {LINKS.map(([a, b], i) => (
          <line key={`${a}-${b}`} className="bw-line" pathLength={1} x1={STARS[a]![0]} y1={STARS[a]![1]} x2={STARS[b]![0]} y2={STARS[b]![1]} style={{ animationDelay: `${180 + i * 95}ms` }} />
        ))}
      </g>
      {STARS.map(([x, y, r], i) => (
        <circle key={i} className="bw-star bw-twinkle" cx={x} cy={y} r={r} fill={i === 3 ? "var(--gold-200)" : "#fff"} style={{ animationDelay: `${i * 80}ms, ${1800 + i * 240}ms` }} />
      ))}
      <circle className="bw-halo" cx="200" cy="46" r="18" fill="var(--gold-300)" opacity="0" />
      <path className="bw-spark" d="M200 22 C202 38 206 42 222 46 C206 50 202 54 200 70 C198 54 194 50 178 46 C194 42 198 38 200 22 Z" fill="var(--gold-300)" />
    </svg>
  );
}

/**
 * « Bienvenue dans la bêta Selio » : juste après l'inscription avec le code, et à la première connexion tant que
 * l'écran n'a pas été vu. « Commencer » le marque vu (pour l'organisation) et ouvre le démarrage.
 */
export default function BetaWelcome() {
  const s = useRequiredSession();
  const client = useClient();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const start = useAppMutation(async () => (client.markBetaWelcomeSeen ? client.markBetaWelcomeSeen() : null), {
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["session"] });
      // Le message d'inscription (« Bienvenue dans la bêta… ») vient d'être dit ici : le démarrage ne le répète pas.
      navigate(AFTER_WELCOME_PATH, { replace: true });
    },
  });
  const beta = s.beta;
  if (!beta || beta.state !== "running") return <Navigate to="/app" replace />;
  const end = beta.endsAt ? betaDateLabel(beta.endsAt) : null;
  return (
    <main data-testid="beta-welcome" className="bw-root relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-10 text-white">
      <style>{CSS}</style>
      <div className="absolute top-5 left-1/2 -translate-x-1/2 opacity-90"><Logo height={22} inverse /></div>
      <div className="relative w-full max-w-xl text-center">
        <Constellation />
        <p className="bw-rise mt-2 text-xs font-semibold tracking-[0.18em] text-gold-300 uppercase" style={{ animationDelay: "900ms" }}>Bêta privée</p>
        <h1 className="bw-rise mt-3 text-3xl font-semibold tracking-[-0.025em] md:text-[2.6rem] md:leading-tight" style={{ animationDelay: "1000ms" }}>Bienvenue dans la bêta Selio</h1>
        <p className="bw-rise mx-auto mt-4 max-w-md text-base text-white/80" style={{ animationDelay: "1150ms" }}>
          Votre mois de Selio {PLAN_LABELS[beta.plan]} est offert{end ? <> jusqu'au <span className="num font-semibold text-white">{end}</span></> : null}. Rien à payer, aucune carte demandée.
        </p>
        <ul className="bw-rise mx-auto mt-7 grid max-w-lg gap-2.5 text-left text-sm sm:grid-cols-3" style={{ animationDelay: "1300ms" }}>
          <li className="flex items-start gap-2 rounded-lg bg-white/[0.07] px-3 py-2.5 ring-1 ring-white/10 ring-inset"><CalendarCheck className="mt-0.5 size-4 shrink-0 text-gold-300" aria-hidden /><span>Mois offert{end ? <> jusqu'au <span className="num">{end}</span></> : null}</span></li>
          <li className="flex items-start gap-2 rounded-lg bg-white/[0.07] px-3 py-2.5 ring-1 ring-white/10 ring-inset"><Wallet className="mt-0.5 size-4 shrink-0 text-gold-300" aria-hidden /><span>Rien à payer, sans carte</span></li>
          <li className="flex items-start gap-2 rounded-lg bg-white/[0.07] px-3 py-2.5 ring-1 ring-white/10 ring-inset"><HeartHandshake className="mt-0.5 size-4 shrink-0 text-gold-300" aria-hidden /><span>Vos retours comptent</span></li>
        </ul>
        <p className="bw-rise mx-auto mt-5 max-w-md text-sm text-white/65" style={{ animationDelay: "1400ms" }}>Une remarque, une idée, un bug ? Dites-le nous depuis l'Aide : chaque retour façonne Selio.</p>
        <div className="bw-rise mt-8" style={{ animationDelay: "1500ms" }}>
          <button
            type="button"
            data-testid="beta-welcome-start"
            onClick={() => start.mutate(undefined)}
            disabled={start.isPending}
            aria-busy={start.isPending || undefined}
            className="press group inline-flex h-12 items-center gap-2 rounded-full bg-white px-7 text-base font-semibold text-[var(--violet-700)] shadow-lg shadow-black/20 hover:bg-[var(--violet-50)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gold-300)] disabled:opacity-70"
          >
            {start.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Commencer
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </button>
        </div>
      </div>
    </main>
  );
}
