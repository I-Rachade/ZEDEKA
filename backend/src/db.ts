import { PrismaClient } from "@prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";

// Base Cloudflare D1 « zedeka-db », séparée de celle de poinderecharge.
// D1 n'a pas de transactions : les $transaction de Prisma s'exécutent requête par requête.
//
// Un seul client Prisma sert toutes les requêtes d'une instance du Worker. Or Prisma regroupe les findUnique de même
// forme lancés au même moment en une seule lecture, faite au nom de la première requête. Sur Workers, l'autre requête
// attend alors une réponse qui ne lui appartient pas : le runtime la croit bloquée et l'arrête (erreur 500 sans message,
// « Erreur 500 » dans l'appli restaurant quand plusieurs écrans chargent ensemble). findUnique passe donc par
// findFirst, qui n'est jamais regroupé : chaque requête fait sa propre lecture.
export function createPrisma(db: D1Database): PrismaClient {
  return withoutCrossRequestBatching(new PrismaClient({ adapter: new PrismaD1(db) }));
}

type Delegate = {
  findFirst(args: unknown): Promise<unknown>;
  findFirstOrThrow(args: unknown): Promise<unknown>;
};

export function withoutCrossRequestBatching(base: PrismaClient): PrismaClient {
  const delegate = (model: string) => (base as unknown as Record<string, Delegate>)[model.charAt(0).toLowerCase() + model.slice(1)];
  return base.$extends({
    query: {
      $allModels: {
        findUnique({ model, args }) {
          return delegate(model).findFirst(uniqueToFirst(args)) as never;
        },
        findUniqueOrThrow({ model, args }) {
          return delegate(model).findFirstOrThrow(uniqueToFirst(args)) as never;
        },
      },
    },
  }) as unknown as PrismaClient;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);

// findFirst n'accepte pas les clés uniques composées (« driverId_kind: { driverId, kind } ») : elles sont dépliées.
export function uniqueToFirst<T extends { where?: unknown }>(args: T): T {
  if (!isPlainObject(args?.where)) return args;
  const where: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args.where)) {
    const parts = key.split("_");
    if (parts.length > 1 && isPlainObject(value) && parts.every((p) => p in value) && Object.keys(value).length === parts.length) {
      Object.assign(where, value);
    } else {
      where[key] = value;
    }
  }
  return { ...args, where };
}
