import { AIError } from "./types";

export interface QueueOptions {
  concurrency: number;
  maxPending: number;
}

interface Pending {
  run: () => void;
  signal?: AbortSignal;
}

/** File de demandes IA à concurrence limitée, avec annulation des demandes en attente. */
export class AIQueue {
  private running = 0;
  private pending: Pending[] = [];

  constructor(private readonly opts: QueueOptions) {}

  snapshot(): { pending: number; running: number; concurrency: number } {
    return { pending: this.pending.length, running: this.running, concurrency: this.opts.concurrency };
  }

  enqueue<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(new AIError("cancelled", "Requête annulée"));
    if (this.pending.length >= this.opts.maxPending) {
      return Promise.reject(new AIError("queue_full", "File d'attente IA saturée, réessayez plus tard", true));
    }
    return new Promise<T>((resolve, reject) => {
      const entry: Pending = {
        signal,
        run: () => {
          signal?.removeEventListener("abort", onAbort);
          this.running++;
          task()
            .then(resolve, reject)
            .finally(() => {
              this.running--;
              this.drain();
            });
        },
      };
      const onAbort = () => {
        const i = this.pending.indexOf(entry);
        if (i !== -1) this.pending.splice(i, 1);
        reject(new AIError("cancelled", "Requête annulée avant exécution"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.push(entry);
      this.drain();
    });
  }

  private drain(): void {
    while (this.running < this.opts.concurrency && this.pending.length > 0) {
      const next = this.pending.shift()!;
      next.run();
    }
  }
}
