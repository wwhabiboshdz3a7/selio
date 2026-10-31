import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, Loader2, LockKeyhole, MonitorSmartphone, XCircle } from "lucide-react";
import { Button, Dialog, ProgressBar, cn } from "@selio/ui";
import { useClient } from "../../../lib/data/provider";
import { errorMessage } from "../../../lib/errors";
import type { CloudLoginStart } from "../../../lib/data/types";
import {
  LOGIN_CLOSED_MESSAGES, createThrottle, formatRemaining, keyMessage, mouseMessage, parseServerMessage, textMessages, toRemotePoint, wheelMessage,
  type LoginClientMessage, type LoginMouseEvent, type LoginServerMessage,
} from "../../../lib/cloud/login-protocol";
import { CLOUD_KEYS, accountName } from "./shared";
import type { CloudAccountView } from "../../../lib/data/types";

/** Bandeau explicite, affiché en permanence au-dessus de la page distante. */
export const LOGIN_PRIVACY_NOTICE = "Vous tapez directement dans Vinted, sur notre serveur. Selio n'enregistre ni votre mot de passe ni vos frappes.";
/** Démonstration : la connexion simulée aboutit après ce délai, sans aucune saisie. */
export const DEMO_LOGIN_DELAY_MS = 3000;
/** Après « session enregistrée », la fenêtre se ferme seule. */
export const CLOSE_AFTER_SAVE_MS = 1500;
const DEFAULT_REMOTE = { width: 1280, height: 800 };
const OPEN = 1;

type Phase =
  | { kind: "starting" }
  | { kind: "simulating"; start: CloudLoginStart }
  | { kind: "connecting"; start: CloudLoginStart }
  | { kind: "open"; start: CloudLoginStart }
  | { kind: "detected"; start: CloudLoginStart }
  | { kind: "saved"; simulated: boolean }
  | { kind: "expired" }
  | { kind: "error"; message: string };

const isTerminal = (p: Phase) => p.kind === "saved" || p.kind === "expired" || p.kind === "error";

/**
 * Fenêtre de connexion sécurisée de Selio Cloud. Le client se connecte LUI-MÊME à Vinted : la page
 * d'un navigateur isolé sur notre machine s'affiche en images dans un canvas, et ses clics et frappes
 * y sont relayés par WebSocket. Aucune frappe n'est gardée, affichée ni journalisée ici : chaque
 * événement est construit, envoyé, puis oublié. En démonstration, un écran simulé explique le
 * principe et la connexion aboutit après 3 secondes sans rien saisir.
 */
export function SecureLoginWindow({ account, open, onClose }: { account: CloudAccountView | null; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open && !!account} onClose={onClose} size="lg" title="Connexion sécurisée à Vinted" description={account ? `Compte : ${accountName(account)}` : undefined}>
      {open && account ? <LoginSession key={account.id} account={account} onClose={onClose} /> : null}
    </Dialog>
  );
}

function LoginSession({ account, onClose }: { account: CloudAccountView; onClose: () => void }) {
  const client = useClient();
  const qc = useQueryClient();
  const [phase, setPhase] = useState<Phase>({ kind: "starting" });
  const [remote, setRemote] = useState(DEFAULT_REMOTE);
  const [hasFrame, setHasFrame] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const captureRef = useRef<HTMLTextAreaElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const startRef = useRef<CloudLoginStart | null>(null);
  const doneRef = useRef(false);
  const remoteRef = useRef(DEFAULT_REMOTE);
  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;
  remoteRef.current = remote;

  const invalidate = () => Promise.all(CLOUD_KEYS.map((k) => qc.invalidateQueries({ queryKey: [k] })));

  // Ouverture : fenêtre côté serveur, puis WebSocket (ou simulation en démonstration).
  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;
    let simTimer: ReturnType<typeof setTimeout> | null = null;
    let closeTimer: ReturnType<typeof setTimeout> | null = null;

    const finishSaved = (simulated: boolean) => {
      doneRef.current = true;
      setPhase({ kind: "saved", simulated });
      void invalidate();
      closeTimer = setTimeout(onClose, CLOSE_AFTER_SAVE_MS);
    };

    const drawFrame = (src: string | Blob, size?: { width: number; height: number }) => {
      if (size && (size.width !== remoteRef.current.width || size.height !== remoteRef.current.height)) setRemote(size);
      setHasFrame(true);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const img = new Image();
      const url = typeof src === "string" ? `data:image/jpeg;base64,${src}` : URL.createObjectURL(src);
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        if (typeof src !== "string") URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        if (typeof src !== "string") URL.revokeObjectURL(url);
      };
      img.src = url;
    };

    const onServerMessage = (msg: LoginServerMessage, start: CloudLoginStart) => {
      switch (msg.type) {
        case "ready":
          // WebSocket branchée : la page devient utilisable à la première image (ou « open »).
          if (msg.width && msg.height) setRemote({ width: msg.width, height: msg.height });
          return;
        case "frame":
          drawFrame(msg.data, msg.width && msg.height ? { width: msg.width, height: msg.height } : undefined);
          setPhase((p) => (p.kind === "connecting" ? { kind: "open", start } : p));
          return;
        case "status":
          if (msg.status === "open") setPhase((p) => (p.kind === "connecting" ? { kind: "open", start } : p));
          else if (msg.status === "logged_in") setPhase((p) => (p.kind === "open" || p.kind === "connecting" ? { kind: "detected", start } : p));
          return;
        case "done":
          finishSaved(false);
          return;
        case "closed":
          if (doneRef.current) return;
          if (msg.reason === "expired") setPhase({ kind: "expired" });
          else setPhase({ kind: "error", message: msg.message ?? LOGIN_CLOSED_MESSAGES[msg.reason] });
          return;
        case "error":
          setPhase({ kind: "error", message: msg.message });
          return;
      }
    };

    client.startCloudLogin(account.id).then(
      (start) => {
        if (cancelled) {
          void client.cancelCloudLogin(start.loginSessionId).catch(() => undefined);
          return;
        }
        startRef.current = start;
        if (start.simulated || !start.socketUrl) {
          setPhase({ kind: "simulating", start });
          simTimer = setTimeout(() => {
            client.completeSimulatedCloudLogin(start.loginSessionId).then(
              () => !cancelled && finishSaved(true),
              (e) => !cancelled && setPhase({ kind: "error", message: errorMessage(e) }),
            );
          }, DEMO_LOGIN_DELAY_MS);
          return;
        }
        setPhase({ kind: "connecting", start });
        ws = new WebSocket(start.socketUrl);
        ws.binaryType = "blob";
        wsRef.current = ws;
        ws.onmessage = (ev: MessageEvent) => {
          if (typeof ev.data === "string") {
            const msg = parseServerMessage(ev.data);
            if (msg) onServerMessage(msg, start);
          } else if (ev.data instanceof Blob) {
            drawFrame(ev.data);
            setPhase((p) => (p.kind === "connecting" ? { kind: "open", start } : p));
          }
        };
        ws.onclose = () => {
          wsRef.current = null;
          if (!doneRef.current) setPhase((p) => (isTerminal(p) ? p : { kind: "error", message: "La liaison avec la fenêtre de connexion a été interrompue : rien n'a été enregistré. Ouvrez-en une nouvelle." }));
        };
      },
      (e) => {
        if (!cancelled) setPhase({ kind: "error", message: errorMessage(e) });
      },
    );

    return () => {
      cancelled = true;
      if (simTimer) clearTimeout(simTimer);
      if (closeTimer) clearTimeout(closeTimer);
      if (ws) {
        try {
          if (ws.readyState === OPEN) ws.send(JSON.stringify({ type: "cancel" } satisfies LoginClientMessage));
        } catch {
          // fermeture au mieux
        }
        ws.onclose = null;
        ws.onmessage = null;
        ws.close();
      }
      wsRef.current = null;
      const start = startRef.current;
      if (start && !doneRef.current) void client.cancelCloudLogin(start.loginSessionId).catch(() => undefined);
    };
    // La fenêtre vit le temps du composant (clé = compte) : rien d'autre ne la relance.
  }, []);

  // Compte à rebours jusqu'à l'expiration ; à zéro, la fenêtre se ferme sans rien enregistrer.
  const start = "start" in phase ? phase.start : null;
  const expiresAt = start ? new Date(start.expiresAt).getTime() : null;
  useEffect(() => {
    if (expiresAt === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  const remaining = expiresAt === null ? null : expiresAt - now;
  useEffect(() => {
    if (remaining === null || remaining > 0 || isTerminal(phaseRef.current)) return;
    setPhase({ kind: "expired" });
    const ws = wsRef.current;
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
  }, [remaining]);

  const interactive = phase.kind === "open";
  const send = (msg: LoginClientMessage) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== OPEN || phaseRef.current.kind !== "open") return;
    ws.send(JSON.stringify(msg));
  };
  const sendRef = useRef(send);
  sendRef.current = send;

  // Souris : déplacements limités en cadence, boutons et molette relayés ; clavier : touches et texte.
  useEffect(() => {
    if (!interactive) return;
    const canvas = canvasRef.current;
    const capture = captureRef.current;
    if (!canvas || !capture) return;
    const pointOf = (e: { clientX: number; clientY: number }) => toRemotePoint(e.clientX, e.clientY, canvas.getBoundingClientRect(), remoteRef.current);
    const moves = createThrottle<LoginMouseEvent>((m) => sendRef.current(m));
    let wheel = { dx: 0, dy: 0 };
    const wheels = createThrottle<{ x: number; y: number }>((point) => {
      const m = wheelMessage(point, { deltaX: wheel.dx, deltaY: wheel.dy });
      wheel = { dx: 0, dy: 0 };
      sendRef.current(m);
    });
    const onMove = (e: PointerEvent) => moves.push(mouseMessage("move", pointOf(e), e));
    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      capture.focus({ preventScroll: true });
      try {
        canvas.setPointerCapture?.(e.pointerId);
      } catch {
        // capture facultative
      }
      sendRef.current(mouseMessage("down", pointOf(e), e));
    };
    const onUp = (e: PointerEvent) => sendRef.current(mouseMessage("up", pointOf(e), e));
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 600 : 1;
      wheel = { dx: wheel.dx + e.deltaX * factor, dy: wheel.dy + e.deltaY * factor };
      wheels.push(pointOf(e));
    };
    const onContext = (e: Event) => e.preventDefault();
    const onKey = (action: "down" | "up") => (e: KeyboardEvent) => {
      if (e.key === "Escape") return; // Échap ferme la fenêtre (rien n'est transmis)
      const msg = keyMessage(action, e);
      if (!msg) return; // composition ou collage : le texte arrive par « beforeinput » / « paste »
      e.preventDefault();
      sendRef.current(msg);
    };
    const onKeyDown = onKey("down");
    const onKeyUp = onKey("up");
    const onPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      for (const m of textMessages(e.clipboardData?.getData("text/plain") ?? "")) sendRef.current(m);
    };
    // Clavier virtuel (mobile) ou saisie composée : le texte est relayé puis effacé aussitôt.
    const onBeforeInput = (e: InputEvent) => {
      if (e.isComposing || e.inputType === "insertCompositionText") return;
      e.preventDefault();
      if (e.inputType === "deleteContentBackward") {
        sendRef.current({ type: "key", action: "down", key: "Backspace", code: "Backspace", keyCode: 8 });
        sendRef.current({ type: "key", action: "up", key: "Backspace", code: "Backspace", keyCode: 8 });
      } else if (e.inputType === "insertLineBreak" || e.inputType === "insertParagraph") {
        sendRef.current({ type: "key", action: "down", key: "Enter", code: "Enter", keyCode: 13, text: "\r" });
        sendRef.current({ type: "key", action: "up", key: "Enter", code: "Enter", keyCode: 13 });
      } else if (e.data) {
        for (const m of textMessages(e.data)) sendRef.current(m);
      }
    };
    const onCompositionEnd = (e: CompositionEvent) => {
      for (const m of textMessages(e.data ?? "")) sendRef.current(m);
      capture.value = "";
    };
    const onInput = (e: Event) => {
      // Rien ne reste dans le champ de capture (sauf pendant une composition, vidée à la fin).
      if (!(e as InputEvent).isComposing) capture.value = "";
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContext);
    capture.addEventListener("keydown", onKeyDown);
    capture.addEventListener("keyup", onKeyUp);
    capture.addEventListener("paste", onPaste);
    capture.addEventListener("beforeinput", onBeforeInput);
    capture.addEventListener("compositionend", onCompositionEnd);
    capture.addEventListener("input", onInput);
    return () => {
      moves.cancel();
      wheels.cancel();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContext);
      capture.removeEventListener("keydown", onKeyDown);
      capture.removeEventListener("keyup", onKeyUp);
      capture.removeEventListener("paste", onPaste);
      capture.removeEventListener("beforeinput", onBeforeInput);
      capture.removeEventListener("compositionend", onCompositionEnd);
      capture.removeEventListener("input", onInput);
      capture.value = "";
    };
  }, [interactive]);

  if (phase.kind === "simulating") return <SimulatedLogin start={phase.start} onCancel={onClose} />;

  return (
    <div className="flex flex-col gap-3">
      <PrivacyNotice />
      {phase.kind === "starting" ? <StateLine icon={<Loader2 className="size-4 animate-spin" />}>Ouverture d'un navigateur isolé pour ce compte…</StateLine> : null}
      {phase.kind === "saved" ? (
        <StateLine tone="success" icon={<CheckCircle2 className="size-4 text-success" />}>
          <span className="font-medium text-text">Connexion détectée — session enregistrée.</span> Elle est chiffrée sur notre machine, réservée à ce compte, et supprimable en un clic. La fenêtre se ferme.
        </StateLine>
      ) : null}
      {phase.kind === "expired" ? (
        <StateLine icon={<Clock className="size-4 text-warning" />}>
          <span className="font-medium text-text">La fenêtre a expiré.</span> Rien n'a été enregistré ; ouvrez-en une nouvelle quand vous êtes prêt.
        </StateLine>
      ) : null}
      {phase.kind === "error" ? (
        <StateLine icon={<XCircle className="size-4 text-danger" />}>
          <span className="font-medium text-text">Connexion impossible.</span> {phase.message}
        </StateLine>
      ) : null}
      {phase.kind === "connecting" || phase.kind === "open" || phase.kind === "detected" ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
            <span aria-live="polite">
              {phase.kind === "detected" ? (
                <span className="inline-flex items-center gap-1.5 font-medium text-text"><CheckCircle2 className="size-3.5 text-success" aria-hidden />Connexion détectée : enregistrement de la session…</span>
              ) : phase.kind === "connecting" ? "Connexion au navigateur isolé…" : "Cliquez dans la page, puis tapez. Échap ferme la fenêtre."}
            </span>
            {remaining !== null ? <span className="num inline-flex items-center gap-1"><Clock className="size-3.5" aria-hidden />Expire dans {formatRemaining(remaining)}</span> : null}
          </div>
          <div className={cn("relative overflow-hidden rounded-md border border-border bg-surface-muted focus-within:[box-shadow:var(--focus-ring)]", !interactive && "pointer-events-none")}>
            <canvas
              ref={canvasRef}
              width={remote.width}
              height={remote.height}
              data-testid="cloud-login-canvas"
              role="img"
              aria-label="Page de connexion Vinted affichée depuis le navigateur isolé"
              className="block h-auto w-full touch-none select-none"
              style={{ aspectRatio: `${remote.width} / ${remote.height}` }}
            />
            {/* Champ de capture : reçoit le clavier (et le clavier du téléphone), toujours vidé aussitôt. */}
            <textarea
              ref={captureRef}
              data-testid="cloud-login-capture"
              aria-label="Saisie vers la page Vinted (rien n'est enregistré)"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              tabIndex={interactive ? 0 : -1}
              className="pointer-events-none absolute inset-0 resize-none opacity-0"
            />
            {!hasFrame ? (
              <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-text-muted">
                <Loader2 className="size-4 animate-spin" aria-hidden />Chargement de la page de Vinted…
              </div>
            ) : null}
          </div>
        </>
      ) : null}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant={isTerminal(phase) ? "primary" : "secondary"} onClick={onClose}>{isTerminal(phase) ? "Fermer" : "Annuler"}</Button>
      </div>
    </div>
  );
}

function PrivacyNotice() {
  return (
    <p className="flex items-start gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text" data-testid="cloud-login-notice">
      <LockKeyhole className="mt-0.5 size-4 shrink-0 text-text-muted" aria-hidden />
      <span>{LOGIN_PRIVACY_NOTICE}</span>
    </p>
  );
}

function StateLine({ icon, children, tone }: { icon: ReactNode; children: ReactNode; tone?: "success" }) {
  return (
    <div role="status" className={cn("flex items-start gap-2 rounded-md border px-3 py-3 text-sm text-text-muted", tone === "success" ? "border-border bg-surface" : "border-border bg-surface")}>
      <span className="mt-0.5 shrink-0" aria-hidden>{icon}</span>
      <p>{children}</p>
    </div>
  );
}

/** Démonstration : aucun navigateur, aucune saisie ; la réussite est simulée après 3 secondes. */
function SimulatedLogin({ start, onCancel }: { start: CloudLoginStart; onCancel: () => void }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const begin = Date.now();
    const t = setInterval(() => setElapsed(Math.min(DEMO_LOGIN_DELAY_MS, Date.now() - begin)), 100);
    return () => clearInterval(t);
  }, [start.loginSessionId]);
  const left = Math.max(0, Math.ceil((DEMO_LOGIN_DELAY_MS - elapsed) / 1000));
  return (
    <div className="flex flex-col gap-3" data-testid="cloud-login-simulated">
      <PrivacyNotice />
      <div className="overflow-hidden rounded-md border border-border bg-surface">
        <div className="flex items-center gap-2 border-b border-border bg-surface-muted px-3 py-2 text-xs text-text-muted">
          <MonitorSmartphone className="size-3.5" aria-hidden />
          <span>Navigateur isolé — simulation</span>
        </div>
        <div className="flex flex-col gap-3 px-4 py-6 text-sm text-text-muted md:px-6">
          <p className="text-base font-semibold text-text">Démonstration : rien n'est saisi, rien ne touche Vinted.</p>
          <p>Sur votre compte, la page de connexion de Vinted s'affiche ici, en direct depuis un navigateur isolé sur notre machine. Vous y tapez vous-même votre identifiant et votre mot de passe : Selio relaie vos clics et vos frappes sans les enregistrer, puis garde seulement la session de ce compte, chiffrée et supprimable en un clic.</p>
          <ProgressBar value={elapsed} max={DEMO_LOGIN_DELAY_MS} label="Connexion simulée" />
          <p className="num text-xs" aria-live="polite">{left > 0 ? `Connexion simulée dans ${left} s…` : "Connexion détectée (simulée)…"}</p>
        </div>
      </div>
      <div className="flex justify-end">
        <Button variant="secondary" onClick={onCancel}>Annuler</Button>
      </div>
    </div>
  );
}
