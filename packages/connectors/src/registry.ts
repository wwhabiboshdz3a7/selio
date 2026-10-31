import type { Provider } from "@selio/contracts";
import { DemoConnector } from "./demo/simulator";
import { VintedExtensionConnector } from "./vinted/connector";
import type { Connector, ConnectorDescriptor } from "./types";

const registry: Record<Provider, () => Connector> = {
  demo: () => new DemoConnector(),
  vinted: () => new VintedExtensionConnector(),
};

const instances = new Map<Provider, Connector>();

export function getConnector(provider: Provider): Connector {
  let c = instances.get(provider);
  if (!c) {
    c = registry[provider]();
    instances.set(provider, c);
  }
  return c;
}

export function describeConnectors(): ConnectorDescriptor[] {
  return (Object.keys(registry) as Provider[]).map((p) => getConnector(p).describe());
}
