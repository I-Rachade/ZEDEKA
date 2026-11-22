// Durable Object « Live » : un seul exemplaire garde toutes les connexions WebSocket des écrans ouverts (src/live.ts).
// API d'hibernation de Cloudflare : entre deux signaux, l'objet dort et ne coûte rien, les connexions restent ouvertes.
// Chaque connexion porte ses canaux en étiquettes ; publier, c'est envoyer « changed » aux connexions d'un canal.
import { DurableObject } from "cloudflare:workers";

// Signe de vie du téléphone toutes les 30 s environ : répondu par Cloudflare sans réveiller l'objet.
const PING = "ping";
const PONG = "pong";

export class Live extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  // Connexion d'un écran ; les canaux ont été vérifiés par le Worker (ticket signé) et arrivent dans l'en-tête.
  async fetch(request: Request): Promise<Response> {
    const channels = (request.headers.get("x-live-channels") ?? "").split(",").filter(Boolean);
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket" || !channels.length) return new Response("WebSocket attendu", { status: 426 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], channels);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // Appelé par l'API (RPC) après un changement : un message par connexion, même abonnée à plusieurs canaux visés.
  async publish(channels: string[]): Promise<number> {
    const seen = new Set<WebSocket>();
    for (const channel of new Set(channels)) {
      for (const ws of this.ctx.getWebSockets(channel)) {
        if (seen.has(ws)) continue;
        seen.add(ws);
        try {
          ws.send(JSON.stringify({ t: "changed", c: channel }));
        } catch {
          // connexion déjà fermée
        }
      }
    }
    return seen.size;
  }

  async webSocketMessage(): Promise<void> {
    // Les écrans n'envoient que le signe de vie, répondu automatiquement.
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, "fermé");
    } catch {
      // déjà fermée
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    try {
      ws.close(1011, "erreur");
    } catch {
      // déjà fermée
    }
  }
}
