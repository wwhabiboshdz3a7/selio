import type {
  AiRequest, AuditLog, AutomationRule, Conversation, Customer, ExtensionToken, InventoryEvent, InventoryItem, Job, MarketplaceConnection, Membership, Message, Opportunity, Order, Organization, PurchaseRequest, RadarSearch, Shipment, Subscription, UsageEvent, User,
} from "@selio/contracts";

export const DEMO_STATE_VERSION = 3;
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
  /** Mot de passe de démo (jamais un vrai compte). */
  passwordHint: string;
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
    try {
      localStorage.setItem(this.key, JSON.stringify(state));
    } catch {
      // Quota ou stockage indisponible : la démo continue en mémoire.
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
