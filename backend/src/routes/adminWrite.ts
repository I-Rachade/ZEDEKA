import type { Request, Response } from "express";
import { z } from "zod";
import { firstError, sendPrismaError } from "../util.js";

// Gestionnaire générique : valide le corps, exécute l'écriture, traduit les erreurs Prisma.
// Avec partial, le schéma devient facultatif champ par champ (PATCH).
export function write<S extends z.AnyZodObject>(
  schema: S,
  action: (data: z.infer<S>, id: string) => Promise<unknown>,
  { partial = false } = {},
) {
  return async (req: Request, res: Response) => {
    const parsed = (partial ? schema.partial() : schema).safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    try {
      res.status(partial ? 200 : 201).json(await action(parsed.data as z.infer<S>, String(req.params.id ?? "")));
    } catch (e) {
      if (e instanceof HttpError) {
        res.status(e.status).json({ error: e.message });
        return;
      }
      if (!sendPrismaError(e, res)) throw e;
    }
  };
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
