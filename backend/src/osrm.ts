// Serveur d'itinéraires de Zedeka (OSRM, réseau routier du Togo) dans Cloudflare Containers : image osrm/Dockerfile.
// Un seul exemplaire, démarré à la première demande d'itinéraire et arrêté après 30 min sans demande ; le premier
// itinéraire après une pause attend quelques secondes le démarrage.
import { DurableObject } from "cloudflare:workers";

const PORT = 5000;
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;
// Point de Lomé : OSRM répond dès que la carte est chargée.
const READY_PATH = "/nearest/v1/driving/1.2228,6.1319";

export class Osrm extends DurableObject {
  private starting: Promise<void> | undefined;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    const container = ctx.container;
    // Objet redémarré alors que le serveur tourne encore : on remet le délai d'arrêt.
    if (container?.running) void ctx.blockConcurrencyWhile(() => container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS));
  }

  async fetch(request: Request): Promise<Response> {
    const container = this.ctx.container;
    if (!container) return new Response("Serveur d'itinéraires non configuré", { status: 503 });
    // Demandes simultanées : un seul démarrage.
    this.starting ??= this.startAndWait(container).finally(() => {
      this.starting = undefined;
    });
    await this.starting;
    const url = new URL(request.url);
    return container.getTcpPort(PORT).fetch(`http://container${url.pathname}${url.search}`, { method: "GET" });
  }

  private async startAndWait(container: Container) {
    if (!container.running) container.start();
    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
    const port = container.getTcpPort(PORT);
    let lastError: unknown;
    for (let attempt = 0; attempt < 120; attempt++) {
      try {
        const res = await port.fetch(`http://container${READY_PATH}`, { signal: AbortSignal.timeout(1000) });
        await res.body?.cancel();
        if (res.ok) return;
        lastError = new Error(`OSRM ${res.status}`);
      } catch (e) {
        lastError = e;
      }
      await scheduler.wait(250);
    }
    throw new Error("Le serveur d'itinéraires n'a pas démarré", { cause: lastError });
  }
}

// Fetcher des itinéraires : notre serveur, avec le serveur public en secours (src/routing.ts, withFallback).
export const osrmPrimary = (ns: DurableObjectNamespace<Osrm>) => (path: string) =>
  ns.getByName("togo").fetch(`http://osrm${path}`, { signal: AbortSignal.timeout(25_000) });
