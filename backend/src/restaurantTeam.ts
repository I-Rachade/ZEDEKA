import type { NextFunction, Request, Response } from "express";
import type { PrismaClient } from "@prisma/client";

// Équipe d'un restaurant dans l'espace restaurant.
// - OWNER : le gérant, propriétaire du compte créé par Zedeka (e-mail du restaurant). Tous les droits.
// - MANAGER : la manageuse. Presque tout comme le gérant : commandes, carte, tables, horaires, relevés, et
//   l'équipe (caissières). Elle ne change pas l'identité du restaurant (numéro, adresse, logo), ni le mot de
//   passe du gérant, ni les comptes des autres manageuses.
// - CASHIER : la caissière. Commandes qui arrivent et en cours (accepter, prête, remise), encaissement au
//   comptoir et messages au livreur. Ni carte, ni réglages, ni relevés, ni équipe, ni chiffre d'affaires.

export type RestaurantRole = "OWNER" | "MANAGER" | "CASHIER";
export type RestaurantStaffRole = Exclude<RestaurantRole, "OWNER">;

export const RESTAURANT_ROLE_LABEL: Record<RestaurantRole, string> = { OWNER: "Gérant", MANAGER: "Manageuse", CASHIER: "Caissière" };

const CASHIER_ROUTES: [method: "GET" | "POST" | "ANY", path: RegExp][] = [
  ["GET", /^\/(me|orders|orders\/counts)$/],
  ["GET", /^\/orders\/[^/]+$/],
  ["POST", /^\/orders\/[^/]+\/(status|paid|driver-message)$/],
  ["POST", /^\/(password|sessions\/logout-all)$/], // les siens, pas ceux du gérant (voir restaurantPanel)
  ["ANY", /^\/push(\/|$)/],
];

// Champs des réglages qui décrivent le restaurant lui-même : réservés au gérant (et à Zedeka).
export const OWNER_SETTINGS_FIELDS = ["phone", "address", "logoUrl"] as const;

export function restaurantRoleMay(role: RestaurantRole, method: string, path: string): boolean {
  if (role === "OWNER" || role === "MANAGER") return true; // limites fines de la manageuse dans les routes
  return CASHIER_ROUTES.some(([m, re]) => (m === "ANY" || m === method) && re.test(path));
}

// La manageuse gère les caissières ; le gérant gère toute l'équipe.
export function mayManageMember(actor: RestaurantRole, target: RestaurantStaffRole): boolean {
  return actor === "OWNER" || (actor === "MANAGER" && target === "CASHIER");
}

export type RestaurantActor = { role: RestaurantRole; memberId: string | null; name: string };

export const actorOf = (res: Response) => res.locals.restaurantActor as RestaurantActor;

// Après requireRestaurant : vérifie le compte du membre (actif, du bon restaurant, session valable) et ses droits.
// Le gérant reste contrôlé par sessionGuard (« se déconnecter partout », mot de passe changé).
export function restaurantActorGuard(prisma: PrismaClient, issuedAt: (req: Request) => number | null) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const memberId = res.locals.restaurantMemberId as string | null;
    let actor: RestaurantActor;
    if (!memberId) {
      actor = { role: "OWNER", memberId: null, name: "Gérant" };
    } else {
      const m = await prisma.restaurantStaff.findUnique({ where: { id: memberId } });
      const issued = issuedAt(req) ?? 0;
      if (!m || !m.active || m.restaurantId !== res.locals.restaurantId || (m.sessionsValidFrom && issued < m.sessionsValidFrom.getTime())) {
        res.status(401).json({ error: "Session expirée, reconnectez-vous" });
        return;
      }
      actor = { role: m.role, memberId: m.id, name: m.name };
    }
    res.locals.restaurantActor = actor;
    if (!restaurantRoleMay(actor.role, req.method, req.path)) {
      res.status(403).json({ error: "Accès réservé au gérant ou à la manageuse" });
      return;
    }
    next();
  };
}
