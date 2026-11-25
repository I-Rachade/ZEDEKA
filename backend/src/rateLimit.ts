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
  // Plafond large par adresse IP seule, devant les limites par compte (connexion, codes) : au Togo, beaucoup de
  // téléphones sortent par la même adresse chez l'opérateur, une limite serrée par IP bloquerait des inconnus entre eux.
  ipBurst?: Limiter;
};

// Le site transmet la requête d'origine : CF-Connecting-IP est posé par Cloudflare, le visiteur ne peut pas le choisir.
export function clientIp(req: Request): string {
  const header = req.headers["cf-connecting-ip"];
  return (typeof header === "string" && header) || req.ip || "?";
}

// Limiteur actif seulement pour les méthodes données (ex. POST sur une route qui accepte aussi GET).
// Sans liaison (tests, développement), la requête passe.
// Compte visé par une connexion ou une demande de code : 8 derniers chiffres du téléphone, ou e-mail en minuscules.
export function accountOf(req: Request): string | null {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.phone === "string") {
    const digits = body.phone.replace(/\D/g, "").slice(-8);
    if (digits) return `tel:${digits}`;
  }
  if (typeof body.email === "string") {
    const email = body.email.trim().toLowerCase();
    if (email) return `mail:${email}`;
  }
  return null;
}

// Clé « adresse + compte » : deux clients derrière la même adresse d'opérateur ont chacun leur compteur, et un même
// compte reste limité. Sans compte dans la requête (connexion admin, changement de mot de passe), l'adresse seule.
export function ipAndAccount(req: Request): string {
  const account = accountOf(req);
  return account ? `${clientIp(req)}|${account}` : clientIp(req);
}

export function limitFor(methods: string[], limiter: Limiter | undefined, keyOf: (req: Request) => string = clientIp) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!limiter || !methods.includes(req.method)) return next();
    limiter.limit({ key: keyOf(req) }).then(
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
