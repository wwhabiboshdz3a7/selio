import { loadDemoClient } from "./lib/data/provider";

// Le client de démonstration se charge à la demande (jamais en production) : les tests l'ont prêt d'avance,
// pour que getDemoClient() et <DataProvider forceMode="demo"> répondent tout de suite.
await loadDemoClient();
