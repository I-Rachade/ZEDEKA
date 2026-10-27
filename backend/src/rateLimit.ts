import type { NextFunction, Request, Response } from "express";

// Limite de requêtes par adresse IP, en mémoire (une seule instance de l'API).
// Freine les essais de mots de passe et de codes, l'énumération des codes de commande et le spam de formulaires.

type Bucket = { count: number; resetAt: number };

export type RateLimiter = (req: Request, res: Response, next: NextFunction) => void;

export function rateLimit(opts: { windowMs: number; max: number; message?: string }, now = () => Date.now()): RateLimiter {
  const buckets = new Map<string, Bucket>();
  let lastSweep = now();
  return (req, res, next) => {
    const t = now();
    // Nettoyage des compteurs expirés, au plus une fois par fenêtre.
    if (t - lastSweep > opts.windowMs) {
      for (const [key, b] of buckets) if (b.resetAt <= t) buckets.delete(key);
      lastSweep = t;
    }
    const key = req.ip ?? "?";
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= t) {
      bucket = { count: 0, resetAt: t + opts.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count++;
    if (bucket.count > opts.max) {
      const wait = Math.ceil((bucket.resetAt - t) / 1000);
      res.set("Retry-After", String(wait));
      res.status(429).json({ error: opts.message ?? "Trop de tentatives. Réessayez dans quelques minutes.", retryIn: wait });
      return;
    }
    next();
  };
}

// Limiteur actif seulement pour les méthodes données (ex. POST sur une route qui accepte aussi GET).
export function onlyFor(methods: string[], limiter: RateLimiter): RateLimiter {
  return (req, res, next) => (methods.includes(req.method) ? limiter(req, res, next) : next());
}
