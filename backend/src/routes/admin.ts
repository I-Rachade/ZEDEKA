import { adminPlannedMealsRouter } from "./plannedMealRoutes.js";
import { adminCompaniesRouter } from "./companyRoutes.js";
import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { bearer, checkPassword, issueToken, readToken, requireAdmin, tokenIssuedAt } from "../auth.js";
import type { EmailSender } from "../email.js";
import { adminPasswordRouter } from "./adminPassword.js";
import { OPEN, STATUSES } from "../orderFlow.js";
import { AWAITING } from "../locationRequest.js";
import { ISSUE_KINDS } from "../driver.js";
import { availability } from "../openingHours.js";
import { BREAK_EVEN_PER_DAY, buildReport, salariesPerDay, startOfDayUtc, subscriptionsPerDay, zedekaRevenue, zedPlansPerDay } from "../stats.js";
import { adminCatalogRouter } from "./adminCatalog.js";
import { adminServicesRouter } from "./adminServices.js";
import { adminServiceRequestsRouter } from "./serviceApp.js";
import { adminZedRouter } from "./zedApp.js";
import { adminFinanceRouter } from "./adminFinance.js";
import { adminOrdersRouter } from "./adminOrders.js";
import { adminVendorsRouter } from "./adminVendors.js";
import type { Notifier } from "../notify.js";
import type { FileStore } from "../storage.js";
import { requireAccess, sameMailbox, type AdminAccess } from "../access.js";
import { pushRoutes } from "./partnerAccount.js";
import { configProblems } from "../config.js";
import { getSettings } from "../util.js";
import { MASTER, seesMoney, staffMay, type Staff } from "../team.js";
import { adminTeamRouter } from "./adminTeam.js";
import { adminHealthRouter } from "./adminHealth.js";
import { adminKpiRouter } from "./adminKpi.js";
import { adminPromosRouter } from "./adminPromos.js";
import { adminRequestsRouter } from "./adminRequests.js";
import { adminNotificationsRouter } from "./adminNotifications.js";
import { adminAdsRouter } from "./ads.js";
import { adminReelsRouter } from "./reels.js";
import { adminMerchantsRouter } from "./adminMerchants.js";
import { adminFleetRouter } from "./adminFleet.js";
import { adminFavoritesRouter } from "./adminFavorites.js";
import { adminMdmRouter, type MdmConfig } from "./adminMdm.js";
import { adminCrmRouter } from "./adminCrm.js";
import { adminLeaseRouter } from "./adminLease.js";
import { adminSchoolRouter } from "./adminSchool.js";
import { leasingPerDay } from "../lease.js";
import { adminScreensRouter } from "./screen.js";
import { adminHrRouter } from "./adminHr.js";
import { adminAccountingRouter } from "./adminAccounting.js";

type AdminConfig = { adminPassword: string; adminSecret: string; files: FileStore; notifier: Notifier; access: AdminAccess; frontendOrigin?: string; mdm?: MdmConfig; email?: EmailSender; devCodes?: boolean };


export function adminRouter(prisma: PrismaClient, config: AdminConfig) {
  const router = Router();
  // Cloudflare Access d'abord, avant même le mot de passe.
  // Les membres actifs de l'équipe passent aussi, en plus de la liste ADMIN_EMAILS.
  router.use(
    // Même boîte aux lettres : rachadeissaka@ (session Access) couvre aussi rachadeissaka+adjoint@, etc.
    requireAccess(config.access, undefined, async (email) =>
      (await prisma.teamMember.findMany({ where: { active: true }, select: { email: true } })).some((m) => sameMailbox(m.email, email)),
    ),
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
      // Derrière Cloudflare Access, le compte doit être celui de l'adresse vérifiée par Access,
      // ou une variante « +... » de la même boîte (comptes de test d'un même propriétaire).
      const accessEmail: string | undefined = res.locals.accessEmail;
      if (accessEmail && !sameMailbox(accessEmail, member.email)) {
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

  // Mot de passe oublié d'un membre de l'équipe : code par e-mail (désactivé, comme la connexion, si la clé est trop faible).
  if (!problems.length) router.use(adminPasswordRouter({ prisma, secret: config.adminSecret, devCodes: config.devCodes ?? false, email: config.email }));

  // Clé trop faible : aucun jeton admin n'est accepté, même bien signé (une clé courte se devine hors ligne).
  router.use(requireAdmin(problems.length ? "" : config.adminSecret));

  // Qui est connecté : un compte désactivé perd l'accès tout de suite, et le dispatcheur s'arrête à ses écrans.
  router.use(async (req, res, next) => {
    const subject = readToken(bearer(req), config.adminSecret)?.s ?? "";
    let staff: Staff = MASTER;
    if (subject !== "admin") {
      const member = await prisma.teamMember.findUnique({ where: { id: subject }, select: { id: true, name: true, role: true, active: true, sessionsValidFrom: true } });
      // Session ouverte avant un changement de mot de passe : fermée.
      const issued = tokenIssuedAt(req, config.adminSecret) ?? 0;
      if (!member?.active || (member.sessionsValidFrom && issued < member.sessionsValidFrom.getTime())) {
        res.status(401).json({ error: "Compte désactivé ou supprimé" });
        return;
      }
      staff = { id: member.id, name: member.name, role: member.role };
    }
    if (!staffMay(staff.role, req.method, req.path)) {
      res.status(403).json({ error: "Réservé au directeur" });
      return;
    }
    res.locals.staff = staff;
    next();
  });

  router.get("/me", (_req, res) => {
    res.json(res.locals.staff);
  });
  // Écran du bureau : liens des moniteurs et objectif du jour.
  router.use(adminScreensRouter(prisma, { frontendOrigin: config.frontendOrigin }));
  // Chaque membre a ses propres abonnements (sujet = son id) : les pop-ups suivent son rôle et ses réglages.
  pushRoutes(router, prisma, config.notifier, "admin", (res) => (res.locals.staff as Staff).id ?? "admin", "/admin", config.adminSecret);

  // Compteurs du menu latéral : ce qui attend une action (commandes, demandes, candidatures) et l'état du terrain
  // en direct (livreurs libres ou en course, restaurants ouverts ou fermés), visibles sans ouvrir les pages.
  router.get("/nav", async (_req, res) => {
    const role = (res.locals.staff as Staff).role;
    // Ressources humaines et comptabilité : leurs seuls compteurs, rien des opérations.
    const hrLeaves = () => Promise.resolve(prisma.employeeLeave?.count({ where: { status: "REQUESTED" } }) ?? 0).catch(() => 0);
    const payrollToPay = () => Promise.resolve(prisma.payslip?.count({ where: { status: "VALIDATED" } }) ?? 0).catch(() => 0);
    if (role === "HR") {
      res.json({ hrLeaves: await hrLeaves() });
      return;
    }
    if (role === "ACCOUNTANT") {
      const [cashOrders, leasePayments, toPay] = await Promise.all([
        prisma.order.count({ where: { status: "DELIVERED", paymentMethod: "CASH", cashCollectionId: null, driverId: { not: null } } }),
        Promise.resolve(prisma.leasePayment?.count({ where: { status: "PENDING" } }) ?? 0).catch(() => 0),
        payrollToPay(),
      ]);
      res.json({ cashOrders, leasePayments, payrollToPay: toPay });
      return;
    }
    const DRIVER_ON_DUTY = { active: true, status: "APPROVED", deletedAt: null } as const;
    const busyOrder = { some: { status: { in: OPEN } } };
    const [
      newOrders,
      ordersInProgress,
      toDispatch,
      driverIssues,
      parcelsInProgress,
      parcelsAwaitingPosition,
      pendingDrivers,
      driversFree,
      driversBusy,
      restaurants,
      cashOrders,
      pendingVendors,
      openRequests,
      urgentRequests,
    ] = await Promise.all([
      prisma.order.count({ where: { status: "PENDING" } }),
      prisma.order.count({ where: { status: { in: OPEN.filter((s) => s !== "PENDING") } } }),
      prisma.order.count({
        where: {
          status: { in: OPEN },
          driverId: null,
          fulfillment: "DELIVERY",
          OR: [{ type: "PARCEL", storeSale: false }, { status: { in: ["READY", "PICKED_UP"] } }],
          // Comme la page Répartition : un colis qui attend la position du destinataire n'est pas encore à répartir.
          NOT: { locationRequest: { status: { in: AWAITING } } },
        },
      }),
      // Problèmes signalés par les livreurs (panne, client absent…) encore ouverts.
      prisma.driverIssue.count({ where: { resolvedAt: null } }),
      prisma.order.count({ where: { type: "PARCEL", status: { in: OPEN } } }),
      prisma.order.count({ where: { type: "PARCEL", status: { in: OPEN }, locationRequest: { status: { in: AWAITING } } } }),
      // Les conducteurs Zed inscrits seuls sont comptés à part (zedToReview).
      prisma.driver.count({ where: { status: "PENDING", deletedAt: null, deliveries: true } }),
      // En ligne et libres : ceux à qui une course peut partir tout de suite.
      prisma.driver.count({ where: { ...DRIVER_ON_DUTY, online: true, orders: { none: { status: { in: OPEN } } } } }),
      // Occupés : une course en cours (même si l'application est passée hors ligne entre-temps).
      prisma.driver.count({ where: { ...DRIVER_ON_DUTY, orders: busyOrder } }),
      prisma.restaurant.findMany({ where: { active: true }, select: { active: true, temporarilyClosed: true, closedUntil: true, openingHours: true } }),
      prisma.order.count({ where: { status: "DELIVERED", paymentMethod: "CASH", cashCollectionId: null, driverId: { not: null } } }),
      prisma.vendorApplication.count({ where: { status: "PENDING" } }),
      // Demandes encore dans la file commune (personne ne s'en occupe).
      prisma.supportRequest.count({ where: { status: "OPEN" } }),
      prisma.supportRequest.count({ where: { status: { not: "DONE" }, priority: "URGENT" } }),
    ]);
    const now = new Date();
    // Suivi CRM : rappels de la personne connectée (ou de toute l'équipe) à faire aujourd'hui ou en retard.
    const me = (res.locals.staff as Staff).name;
    const endOfDay = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
    endOfDay.setUTCDate(endOfDay.getUTCDate() + 1); // Lomé est à l'heure UTC
    const crmDue = await Promise.resolve(prisma.crmTask?.count({ where: { doneAt: null, dueAt: { lt: endOfDay }, OR: [{ assignedTo: me }, { assignedTo: null }] } }) ?? 0).catch(() => 0);
    const restaurantsOpen = restaurants.filter((r) => availability(r, now).open).length;
    // Mode Zed : dossiers à vérifier et paiements du plan à confirmer.
    const [zedDrivers, zedPayments] = await Promise.all([prisma.driver.count({ where: { zedStatus: "PENDING", deletedAt: null } }), prisma.zedPayment.count({ where: { status: "PENDING" } })]);
    // Leasing de motos : paiements mobile money à confirmer.
    const leasePayments = await Promise.resolve(prisma.leasePayment?.count({ where: { status: "PENDING" } }) ?? 0).catch(() => 0);
    // RH et comptabilité, pour le directeur et l'administrateur adjoint.
    const [pendingLeaves, toPay] = ["DIRECTOR", "DEPUTY"].includes(role) ? await Promise.all([hrLeaves(), payrollToPay()]) : [0, 0];
    // Transport scolaire : demandes d'abonnement à valider.
    const schoolPending = await Promise.resolve(prisma.schoolPass?.count({ where: { status: "PENDING" } }) ?? 0).catch(() => 0);
    res.json({
      hrLeaves: pendingLeaves,
      payrollToPay: toPay,
      zedToReview: zedDrivers + zedPayments,
      leasePayments,
      schoolPending,
      newOrders,
      ordersInProgress,
      toDispatch,
      driverIssues,
      parcelsInProgress,
      parcelsAwaitingPosition,
      pendingDrivers,
      driversFree,
      driversBusy,
      restaurantsOpen,
      restaurantsClosed: restaurants.length - restaurantsOpen,
      cashOrders,
      pendingVendors,
      openRequests,
      urgentRequests,
      crmDue,
    });
  });

  // Livreurs salariés actuellement payés : validés et actifs.
  const STAFF_ON_PAYROLL = { employment: "STAFF", status: "APPROVED", active: true } as const;

  // Revenus fixes du jour : abonnements des commerces actifs (restaurants et boutiques), plans Zed en cours
  // (chacun ramené à la journée). Les mêmes sommes servent au tableau de bord et au rapport.
  async function recurringPerDay(now = new Date()) {
    const [restaurants, plans, leases] = await Promise.all([
      prisma.restaurant.findMany({ where: { active: true, subscriptionFee: { not: null } }, select: { subscriptionFee: true } }),
      prisma.zedPayment.findMany({ where: { status: "CONFIRMED", startsAt: { lte: now }, endsAt: { gt: now } }, select: { amount: true, days: true } }),
      // Leasing de motos : prix par jour des contrats en cours.
      Promise.resolve(prisma.leaseContract?.findMany({ where: { status: "ACTIVE" }, select: { dailyRate: true } }) ?? []).catch(() => []),
    ]);
    const subscriptions = subscriptionsPerDay(restaurants);
    const zedPlans = zedPlansPerDay(plans);
    const leasing = leasingPerDay(leases);
    return { subscriptions, zedPlans, leasing, leasedBikes: leases.length, total: subscriptions + zedPlans + leasing, subscribedRestaurants: restaurants.length, zedPlanDrivers: plans.length };
  }

  router.get("/dashboard", async (_req, res) => {
    const today = startOfDayUtc(new Date());
    const [todayOrders, byStatus, recent, pendingDrivers, recurring, staff, cancelledToday] = await Promise.all([
      prisma.order.findMany({
        where: { createdAt: { gte: today }, status: { not: "CANCELLED" } },
        select: { deliveryFee: true, extraFee: true, discount: true, promoPayer: true, commission: true, driverEarning: true, total: true, type: true, createdAt: true, deliveredAt: true, zone: { select: { name: true } } },
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
      recurringPerDay(),
      prisma.driver.findMany({ where: STAFF_ON_PAYROLL, select: { monthlySalary: true } }),
      prisma.order.aggregate({ _sum: { cancellationFee: true }, where: { createdAt: { gte: today }, status: "CANCELLED" } }),
    ]);
    const subscriptions = recurring.subscriptions;
    const salaries = salariesPerDay(staff);
    const cancellationFees = cancelledToday._sum.cancellationFee ?? 0;
    const revenue = todayOrders.reduce((sum, o) => sum + zedekaRevenue(o), 0) + cancellationFees + recurring.total;
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
    const money = seesMoney(res);
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
              subscribedRestaurants: recurring.subscribedRestaurants,
              zedPlans: recurring.zedPlans,
              zedPlanDrivers: recurring.zedPlanDrivers,
              leasing: recurring.leasing,
              leasedBikes: recurring.leasedBikes,
              cancellationFees,
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
      ...(await liveBoard(today)),
    });
  });

  // Planche 9 : « Maintenant » (terrain en direct), « À traiter » (ce qui demande une action) et délais qui comptent
  // pour le client, avec les courses Zed du jour.
  async function liveBoard(today: Date) {
    const now = Date.now();
    const onDuty = { active: true, status: "APPROVED", deletedAt: null } as const;
    const [enRoute, kitchen, ready, toAssign, freeDrivers, zedAvailable, zedRides, pickedToday, issues, unanswered, silent] = await Promise.all([
      prisma.order.count({ where: { status: "PICKED_UP" } }),
      prisma.order.findMany({ where: { status: { in: ["CONFIRMED", "PREPARING"] } }, select: { confirmedAt: true, preparingAt: true, prepMinutes: true } }),
      prisma.order.count({ where: { status: "READY", readyAt: { lt: new Date(now - 15 * 60_000) } } }),
      prisma.order.count({
        where: { status: { in: OPEN }, driverId: null, fulfillment: "DELIVERY", OR: [{ type: "PARCEL", storeSale: false }, { status: { in: ["READY", "PICKED_UP"] } }], NOT: { locationRequest: { status: { in: AWAITING } } } },
      }),
      prisma.driver.count({ where: { ...onDuty, online: true, orders: { none: { status: { in: OPEN } } } } }),
      prisma.driver.count({ where: { ...onDuty, zedStatus: "ACTIVE", zedAvailable: true } }),
      prisma.zedRide.findMany({ where: { createdAt: { gte: today } }, select: { createdAt: true, acceptedAt: true, status: true } }),
      prisma.order.findMany({ where: { pickedUpAt: { gte: today }, readyAt: { not: null } }, select: { readyAt: true, pickedUpAt: true } }),
      prisma.driverIssue.findMany({ where: { resolvedAt: null }, orderBy: { createdAt: "asc" }, take: 5, include: { driver: { select: { name: true } }, order: { select: { id: true } } } }),
      prisma.order.findMany({ where: { status: "PENDING", alertedAdminAt: { not: null } }, take: 5, select: { id: true, restaurant: { select: { name: true, phone: true } } } }),
      // Livreurs avec une course en cours dont la position n'est pas arrivée depuis 5 min.
      prisma.driver.count({ where: { ...onDuty, orders: { some: { status: "PICKED_UP" } }, OR: [{ lastLocationAt: null }, { lastLocationAt: { lt: new Date(now - 5 * 60_000) } }] } }),
    ]);
    // Garde-fou : un livreur indépendant actif avec une part par course à 0 % ne toucherait rien pour ses livraisons.
    const [freelance, rates] = await Promise.all([
      prisma.driver.count({ where: { ...onDuty, employment: "FREELANCE", deliveries: true } }),
      getSettings(prisma),
    ]);
    const unpaidKinds = [rates.foodDriverCommission === 0 && "repas", rates.parcelDriverCommission === 0 && "colis"].filter(Boolean);
    const lateKitchen = kitchen.filter((o) => {
      const start = (o.preparingAt ?? o.confirmedAt)?.getTime();
      return start && o.prepMinutes && now - start > o.prepMinutes * 60_000;
    }).length;
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const pickup = avg(pickedToday.map((o) => (o.pickedUpAt!.getTime() - o.readyAt!.getTime()) / 60_000).filter((m) => m >= 0 && m < 240));
    const answer = avg(zedRides.filter((r) => r.acceptedAt).map((r) => (r.acceptedAt!.getTime() - r.createdAt.getTime()) / 1000));
    const todo = [
      ...issues.map((i) => ({ tone: "red", text: `Problème : ${(ISSUE_KINDS[i.kind as keyof typeof ISSUE_KINDS] ?? "signalé").toLowerCase()} (${i.driver.name.split(" ")[0]})`, href: "/admin/dispatch", action: "Voir" })),
      ...unanswered.map((o) => ({ tone: "orange", text: `Restaurant sans réponse : ${o.restaurant?.name ?? "?"}`, href: o.restaurant?.phone ? `tel:${o.restaurant.phone.replace(/ /g, "")}` : `/admin/commandes/${o.id}`, action: "Appeler" })),
      ...(silent ? [{ tone: "sun", text: `${silent} livreur(s) sans signal depuis 5 min`, href: "/admin/dispatch", action: "Voir" }] : []),
      ...(freelance && unpaidKinds.length
        ? [{ tone: "orange", text: `Part du livreur à 0 % (${unpaidKinds.join(" et ")}) : ${freelance} indépendant(s) ne toucheraient rien`, href: "/admin/reglages", action: "Régler" }]
        : []),
    ];
    return {
      live: { enRoute, kitchen: kitchen.length, toAssign, late: lateKitchen + ready, freeDrivers, zedAvailable },
      zedToday: zedRides.filter((r) => r.status !== "CANCELLED" && r.status !== "NO_DRIVER").length,
      delays: { pickupMinutes: pickup == null ? null : Math.round(pickup), zedAnswerSeconds: answer == null ? null : Math.round(answer) },
      todo,
    };
  }

  router.get("/report", async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 92);
    const from = new Date(startOfDayUtc(new Date()).getTime() - (days - 1) * 86_400_000);
    const recurring = await recurringPerDay();
    const staff = await prisma.driver.findMany({ where: STAFF_ON_PAYROLL, select: { monthlySalary: true } });
    const orders = await prisma.order.findMany({
      where: { createdAt: { gte: from } },
      select: {
        type: true,
        status: true,
        deliveryFee: true,
        extraFee: true,
        discount: true,
        promoPayer: true,
        commission: true,
        driverEarning: true,
        createdAt: true,
        deliveredAt: true,
        storeSale: true,
        cancellationFee: true,
        restaurant: { select: { name: true } },
      },
    });
    res.json(
      buildReport(
        // Ventes des boutiques en ligne : leur commission compte à part des colis envoyés.
        orders.map((o) => ({ ...o, restaurantName: o.restaurant?.name ?? (o.storeSale ? "Boutiques" : o.type === "PARCEL" ? "Colis" : "—") })),
        from,
        days,
        recurring.total,
        salariesPerDay(staff),
      ),
    );
  });

  router.use(adminOrdersRouter(prisma, config.notifier));
  router.use(adminTeamRouter(prisma));
  router.use(adminHealthRouter(prisma));
  router.use(adminKpiRouter(prisma));
  router.use(adminPromosRouter(prisma));
  router.use(adminRequestsRouter(prisma));
  router.use(adminCrmRouter(prisma));
  router.use(adminNotificationsRouter(prisma));
  router.use(adminServicesRouter(prisma));
  router.use(adminServiceRequestsRouter(prisma, config.notifier));
  router.use(adminCatalogRouter(prisma, { frontendOrigin: config.frontendOrigin ?? "", files: config.files }));
  router.use(adminAdsRouter(prisma, { files: config.files, frontendOrigin: config.frontendOrigin ?? "" }));
  router.use(adminReelsRouter(prisma, { files: config.files, frontendOrigin: config.frontendOrigin ?? "" }));
  router.use(adminFinanceRouter(prisma));
  router.use(adminVendorsRouter(prisma, { files: config.files }));
  router.use(adminMerchantsRouter(prisma));
  router.use(adminFavoritesRouter(prisma));
  router.use(adminMdmRouter(prisma, config.mdm));
  router.use(adminFleetRouter(prisma, { files: config.files, notifier: config.notifier }));
  router.use(adminLeaseRouter(prisma, { notifier: config.notifier }));
  router.use(adminHrRouter(prisma, { files: config.files }));
  router.use(adminAccountingRouter(prisma));
  router.use(adminSchoolRouter(prisma, { notifier: config.notifier }));
  router.use(adminPlannedMealsRouter(prisma));
  router.use(adminCompaniesRouter(prisma));
  router.use(adminZedRouter(prisma, { notifier: config.notifier, files: config.files }));

  return router;
}
