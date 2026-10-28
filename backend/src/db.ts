import { PrismaClient } from "@prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";

// Base Cloudflare D1 « zedeka-db », séparée de celle de poinderecharge.
// D1 n'a pas de transactions : les $transaction de Prisma s'exécutent requête par requête.
export function createPrisma(db: D1Database) {
  return new PrismaClient({ adapter: new PrismaD1(db) });
}
