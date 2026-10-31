/**
 * Créneaux de navigateurs : au plus `max` navigateurs ouverts en même temps sur
 * la machine (CLOUD_MAX_BROWSERS). Une demande attend son tour dans l'ordre
 * d'arrivée, bornée par un délai ; aucune file infinie.
 */
export class BrowserSlotTimeoutError extends Error {
  constructor() {
    super("Aucun navigateur libre dans le délai imparti.");
    this.name = "BrowserSlotTimeoutError";
  }
}

export class BrowserSlots {
  readonly max: number;
  private used = 0;
  private readonly waiters: { resolve: (release: () => void) => void; timer: ReturnType<typeof setTimeout> | null }[] = [];

  constructor(max: number) {
    this.max = Math.max(1, Math.floor(max));
  }

  get inUse(): number {
    return this.used;
  }

  get waiting(): number {
    return this.waiters.length;
  }

  /** Prend un créneau ; renvoie la fonction qui le rend (idempotente). */
  acquire(timeoutMs?: number): Promise<() => void> {
    if (this.used < this.max) {
      this.used++;
      return Promise.resolve(this.releaser());
    }
    return new Promise((resolve, reject) => {
      const waiter: (typeof this.waiters)[number] = { resolve, timer: null };
      if (timeoutMs !== undefined) {
        waiter.timer = setTimeout(() => {
          const i = this.waiters.indexOf(waiter);
          if (i >= 0) this.waiters.splice(i, 1);
          reject(new BrowserSlotTimeoutError());
        }, Math.max(0, timeoutMs));
      }
      this.waiters.push(waiter);
    });
  }

  private releaser(): () => void {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const next = this.waiters.shift();
      if (next) {
        if (next.timer) clearTimeout(next.timer);
        next.resolve(this.releaser());
      } else {
        this.used--;
      }
    };
  }
}
