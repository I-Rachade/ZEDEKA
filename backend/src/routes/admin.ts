import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { bearer, checkPassword, issueToken, readToken, requireAdmin } from "../auth.js";
import { OPEN, STATUSES } from "../orderFlow.js";
import { BREAK_EVEN_PER_DAY, buildReport, salariesPerDay, startOfDayUtc, subscriptionsPerDay, zedekaRevenue } from "../stats.js";
import { adminCatalogRouter } from "./adminCatalog.js";
import { adminFinanceRouter } from "./adminFinance.js";
import { adminOrdersRouter } from "./adminOrders.js";
import { adminVendorsRouter } from "./adminVendors.js";
import type { Notifier } from "../notify.js";
import type { FileStore } from "../storage.js";
import { requireAccess, type AdminAccess } from "../access.js";
import { pushRoutes } from "./partnerAccount.js";
import { configProblems } from "../config.js";
import { dispatcherMay, MASTER, type Staff } from "../team.js";
import { adminTeamRouter } from "./adminTeam.js";
import { adminNotificationsRouter } from "./adminNotifications.js";

type AdminConfig = { adminPassword: string; adminSecret: string; files: FileStore; notifier: Notifier; access: AdminAccess; frontendOrigin?: string };


export function adminRouter(prisma: PrismaClient, config: AdminConfig) {
  const router = Router();
  // Cloudflare Access d'abord, avant même le mot de passe.
  // Les membres actifs de l'équipe passent aussi, en plus de la liste ADMIN_EMAILS.
  router.use(
    requireAccess(config.access, undefined, async (email) => Boolean(await prisma.teamMember.findFirst({ where: { email, active: true }, select: { id: true } }))),
  );

  const problems = configProblems(config);

  // Avec une adresse e-mail : compte d'un membre de l'équipe. Sans : mot de passe ADMIN_PASSWORD du directeur.
  router.post("/login", async (req, res) => {
    if (problems.length) {
      console.error(`Connexion admin refusée, secrets à corriger :\n- ${problems.join("\n- ")}`);
      res.status(503).json({ error: "Connexion admin désactivée : secrets du serveur trop faibles (voir les journaux du Worker)" });
      return;
    }
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (email) {
      const member = await prisma.teamMember.findUnique({ where: { email } });
      if (!member || !member.active || !(await bcrypt.compare(password, member.passwordHash))) {
        res.status(401).json({ error: "Adresse ou mot de passe incorrect" });
        return;
      }
      // Derrière Cloudflare Access, le compte doit être celui de l'adresse vérifiée par Access.
      const accessEmail: string | undefined = res.locals.accessEmail;
      if (accessEmail && accessEmail !== member.email) {
        res.status(403).json({ error: `Connectez-vous avec le compte de ${accessEmail}` });
        return;
      }
      await prisma.teamMember.update({ where: { id: member.id }, data: { lastLoginAt: new Date() } });
      res.json({ token: issueToken(config.adminSecret, Date.now(), "admin", member.id), name: member.name, role: member.role });
      return;
    }
    if (!checkPassword(password, config.adminPassword)) {
      res.status(401).json({ error: "Mot de passe incorrect" });
      return;
    }
    res.json({ token: issueToken(config.adminSecret), name: MASTER.name, role: MASTER.role });
  });

  // Clé trop faible : aucun jeton admin n'est accepté, même bien signé (une clé courte se devine hors ligne).
  router.use(requireAdmin(problems.length ? "" : config.adminSecret));

  // Qui est connecté : un compte désactivé perd l'accès tout de suite, et le dispatcheur s'arrête à ses écrans.
  router.use(async (req, res, next) => {
    const subject = readToken(bearer(req), config.adminSecret)?.s ?? "";
    let staff: Staff = MASTER;
    if (subject !== "admin") {
      const member = await prisma.teamMember.findUnique({ where: { id: subject }, select: { id: true, name: true, role: true, active: true } });
      if (!member?.active) {
        res.status(401).json({ error: "Compte désactivé ou supprimé" });
        return;
      }
      staff = { id: member.id, name: member.name, role: member.role };
    }
    if (staff.role === "DISPATCHER" && !dispatcherMay(req.method, req.path)) {
      res.status(403).json({ error: "Réservé au directeur" });
      return;
    }
    res.locals.staff = staff;
    next();
  });

  router.get("/me", (_req, res) => {
    res.json(res.locals.staff);
  });
  // Chaque membre a ses propres abonnements (sujet = son id) : les pop-ups suivent son rôle et ses réglages.
  pushRoutes(router, prisma, config.notifier, "admin", (res) => (res.locals.staff as Staff).id ?? "admin", "/admin");

  // Compteurs du menu latéral.
  router.get("/nav", async (_req, res) => {
    const [newOrders, toDispatch, pendingDrivers, cashOrders, pendingVendors] = await Promise.all([
      prisma.order.count({ where: { status: "PENDING" } }),
      prisma.order.count({
        where: {
          status: { in: OPEN },
          driverId: null,
          fulfillment: "DELIVERY",
          OR: [{ type: "PARCEL" }, { status: { in: ["READY", "PICKED_UP"] } }],
        },
      }),
      prisma.driver.count({ where: { status: "PENDING" } }),
      prisma.order.count({ where: { status: "DELIVERED", paymentMethod: "CASH", cashCollectionId: null, driverId: { not: null } } }),
      prisma.vendorApplication.count({ where: { status: "PENDING" } }),
    ]);
    res.json({ newOrders, toDispatch, pendingDrivers, cashOrders, pendingVendors });
  });

  // Livreurs salariés actuellement payés : validés et actifs.
  const STAFF_ON_PAYROLL = { employment: "STAFF", status: "APPROVED", active: true } as const;

  router.get("/dashboard", async (_req, res) => {
    const today = startOfDayUtc(new Date());
    const [todayOrders, byStatus, recent, pendingDrivers, subscribed, staff] = await Promise.all([
      prisma.order.findMany({
        where: { createdAt: { gte: today }, status: { not: "CANCELLED" } },
        select: { deliveryFee: true, extraFee: true, discount: true, commission: true, driverEarning: true, total: true, type: true, createdAt: true, deliveredAt: true, zone: { select: { name: true } } },
      }),
      prisma.order.groupBy({ by: ["status"], _count: { _all: true }, where: { createdAt: { gte: today } } }),
      prisma.order.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          code: true,
          type: true,
          status: true,
          total: true,
          createdAt: true,
          restaurant: { select: { name: true } },
          driver: { select: { name: true } },
        },
      }),
      prisma.driver.count({ where: { status: "PENDING" } }),
      prisma.restaurant.findMany({ where: { active: true, subscriptionFee: { not: null } }, select: { subscriptionFee: true } }),
      prisma.driver.findMany({ where: STAFF_ON_PAYROLL, select: { monthlySalary: true } }),
    ]);
    const subscriptions = subscriptionsPerDay(subscribed);
    const salaries = salariesPerDay(staff);
    const revenue = todayOrders.reduce((sum, o) => sum + zedekaRevenue(o), 0) + subscriptions;
    // Pour les graphiques du tableau de bord : commandes par heure (Lomé = UTC), par zone, délai moyen des livrées.
    const byHour = Array.from({ length: 24 }, (_, h) => todayOrders.filter((o) => o.createdAt.getUTCHours() === h).length);
    const zoneCounts = new Map<string, number>();
    for (const o of todayOrders) zoneCounts.set(o.zone.name, (zoneCounts.get(o.zone.name) ?? 0) + 1);
    const byZone = [...zoneCounts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    const delivered = todayOrders.filter((o) => o.deliveredAt);
    const avgDeliveryMinutes = delivered.length
      ? Math.round(delivered.reduce((sum, o) => sum + (o.deliveredAt!.getTime() - o.createdAt.getTime()), 0) / delivered.length / 60_000)
      : null;
    // Le dispatcheur voit l'activité du jour, pas les montants (revenu, salaires, abonnements).
    const money = (res.locals.staff as Staff).role === "DIRECTOR";
    res.json({
      money,
      today: {
        orders: todayOrders.length,
        parcels: todayOrders.filter((o) => o.type === "PARCEL").length,
        breakEven: BREAK_EVEN_PER_DAY,
        avgDeliveryMinutes,
        ...(money
          ? {
              revenue,
              orderValue: todayOrders.reduce((sum, o) => sum + o.total, 0),
              subscriptions,
              subscribedRestaurants: subscribed.length,
              salaries,
              staffDrivers: staff.length,
              afterSalaries: revenue - salaries,
            }
          : { revenue: 0, orderValue: 0 }),
      },
      byHour,
      byZone,
      byStatus: Object.fromEntries(STATUSES.map((s) => [s, byStatus.find((g) => g.status === s)?._count._all ?? 0])),
      recent,
      pendingDrivers,
    });
  });

  router.get("/report", async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 92);
    const from = new Date(startOfDayUtc(new Date()).getTime() - (days - 1) * 86_400_000);
    const subscribed = await prisma.restaurant.findMany({ where: { active: true, subscriptionFee: { not: null } }, select: { subscriptionFee: true } });
    const staff = await prisma.driver.findMany({ where: STAFF_ON_PAYROLL, select: { monthlySalary: true } });
    const orders = await prisma.order.findMany({
      where: { createdAt: { gte: from } },
      select: {
        type: true,
        status: true,
        deliveryFee: true,
        extraFee: true,
        discount: true,
        commission: true,
        driverEarning: true,
        createdAt: true,
        deliveredAt: true,
        restaurant: { select: { name: true } },
      },
    });
    res.json(
      buildReport(
        orders.map((o) => ({ ...o, restaurantName: o.restaurant?.name ?? (o.type === "PARCEL" ? "Colis" : "—") })),
        from,
        days,
        subscriptionsPerDay(subscribed),
        salariesPerDay(staff),
      ),
    );
  });

  router.use(adminOrdersRouter(prisma, config.notifier));
  router.use(adminTeamRouter(prisma));
  router.use(adminNotificationsRouter(prisma));
  router.use(adminCatalogRouter(prisma, { frontendOrigin: config.frontendOrigin ?? "" }));
  router.use(adminFinanceRouter(prisma));
  router.use(adminVendorsRouter(prisma, { files: config.files }));

  return router;
}
