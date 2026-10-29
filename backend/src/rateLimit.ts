import type { NextFunction, Request, Response } from "express";

// Limites de requêtes par adresse IP. Les compteurs sont tenus par Cloudflare (liaisons « ratelimits » de
// wrangler.jsonc) : un compteur en mémoire ne servirait à rien, chaque isolat du Worker a la sienne.
// Freine les essais de mots de passe et de codes, le parcours des codes de commande et le spam de formulaires.

export type Limiter = { limit: (options: { key: string }) => Promise<{ success: boolean }> };

export type Limiters = {
  login?: Limiter;
  otp?: Limiter;
  lookup?: Limiter;
  forms?: Limiter;
  applications?: Limiter;
};

// Le site transmet la requête d'origine : CF-Connecting-IP est posé par Cloudflare, le visiteur ne peut pas le choisir.
export function clientIp(req: Request): string {
  const header = req.headers["cf-connecting-ip"];
  return (typeof header === "string" && header) || req.ip || "?";
}

// Limiteur actif seulement pour les méthodes données (ex. POST sur une route qui accepte aussi GET).
// Sans liaison (tests, développement), la requête passe.
export function limitFor(methods: string[], limiter: Limiter | undefined) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!limiter || !methods.includes(req.method)) return next();
    limiter.limit({ key: clientIp(req) }).then(
      ({ success }) => {
        if (success) return next();
        res.set("Retry-After", "60");
        res.status(429).json({ error: "Trop de tentatives. Réessayez dans une minute.", retryIn: 60 });
      },
      // Panne du service de limites : on laisse passer plutôt que de bloquer tout le monde.
      (e) => {
        console.error("rate limit", e);
        next();
      },
    );
  };
}
