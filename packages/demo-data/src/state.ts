import type {
  AiRequest, AuditLog, AutomationRule, Conversation, Customer, ExtensionToken, InventoryEvent, InventoryItem, Job, MarketplaceConnection, Membership, Message, Opportunity, Order, Organization, PurchaseRequest, RadarSearch, Shipment, Subscription, UsageEvent, User, WhiteLabel,
} from "@selio/contracts";

/** v8 : marque blanche de Selio Agence (aperçu). */
export const DEMO_STATE_VERSION = 8;
export const DEMO_STORAGE_KEY = "selio.demo.v1";

export interface DemoState {
  version: number;
  seededAt: string;
  user: User;
  users: User[];
  org: Organization;
  memberships: Membership[];
  items: InventoryItem[];
  itemEvents: InventoryEvent[];
  customers: Customer[];
  conversations: Conversation[];
  messages: Message[];
  orders: Order[];
  shipments: Shipment[];
  rules: AutomationRule[];
  jobs: Job[];
  automation: { globalPaused: boolean; pausedAt: string | null };
  searches: RadarSearch[];
  opportunities: Opportunity[];
  purchases: PurchaseRequest[];
  connections: MarketplaceConnection[];
  tokens: ExtensionToken[];
  aiRequests: AiRequest[];
  usage: UsageEvent[];
  subscription: Subscription;
  audit: AuditLog[];
  /** Selio Agence (aperçu) : marque blanche enregistrée dans la démonstration (null = pas encore personnalisée). */
  whiteLabel: WhiteLabel | null;
  /** Mot de passe de démo (jamais un vrai compte). */
  passwordHint: string;
}

/** Au-delà de cette taille, une data URL est une photo importée (les photos de la démo sont des fichiers servis par le site, pas des data URL). */
const IMPORTED_PHOTO_MIN_CHARS = 20_000;

/** Copie de l'état sans les photos importées des articles (toutes, ou toutes sauf la couverture). */
export function lightenDemoState(state: DemoState, keepCover: boolean): DemoState {
  return {
    ...state,
    items: state.items.map((item) => {
      const photos = item.photos.filter((p, i) => (keepCover && i === 0) || !(p.url.startsWith("data:") && p.url.length >= IMPORTED_PHOTO_MIN_CHARS));
      return photos.length === item.photos.length ? item : { ...item, photos };
    }),
  };
}

export interface DemoStorage {
  load(): DemoState | null;
  save(state: DemoState): void;
  clear(): void;
}

export class LocalDemoStorage implements DemoStorage {
  constructor(private readonly key = DEMO_STORAGE_KEY) {}
  load(): DemoState | null {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as DemoState;
      if (parsed.version !== DEMO_STATE_VERSION) return null;
      return parsed;
    } catch {
      return null;
    }
  }
  save(state: DemoState): void {
    // Le stockage du navigateur est limité (~5 Mo) : un ou deux articles du générateur avec leurs
    // photos suffisent à le remplir. Sans repli, chaque enregistrement suivant échouait en silence et
    // toutes les modifications étaient perdues au rechargement. On enregistre alors une copie allégée
    // (photos importées retirées, couverture gardée si possible) : le reste de la démo est conservé.
    const candidates = [() => state, () => lightenDemoState(state, true), () => lightenDemoState(state, false)];
    for (const candidate of candidates) {
      try {
        localStorage.setItem(this.key, JSON.stringify(candidate()));
        return;
      } catch {
        // Quota dépassé ou stockage indisponible : on essaie plus léger, sinon la démo continue en mémoire.
      }
    }
  }
  clear(): void {
    try {
      localStorage.removeItem(this.key);
    } catch {
      // ignore
    }
  }
}

export class MemoryDemoStorage implements DemoStorage {
  private state: DemoState | null = null;
  load() {
    return this.state;
  }
  save(s: DemoState) {
    this.state = s;
  }
  clear() {
    this.state = null;
  }
}
