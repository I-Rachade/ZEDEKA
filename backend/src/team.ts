// Équipe Zedeka dans l'admin : qui est connecté et ce que son rôle lui permet.
// Le mot de passe ADMIN_PASSWORD ouvre l'admin en directeur des opérations (sujet « admin » du jeton) ;
// chaque membre a sinon son propre compte (sujet = id du membre).

export type TeamRole = "DIRECTOR" | "MANAGER" | "DISPATCHER";
export type Staff = { id: string | null; name: string; role: TeamRole };

export const MASTER: Staff = { id: null, name: "Directeur des opérations", role: "DIRECTOR" };

// Ce que le dispatcheur peut ouvrir : commandes, répartition, disponibilité des livreurs, et les listes
// en lecture dont ces écrans ont besoin. Finances, rapport, réglages, catalogue, candidatures et équipe
// restent au directeur.
const DISPATCHER_ROUTES: [method: "GET" | "ANY", path: RegExp][] = [
  ["GET", /^\/(nav|dashboard|me|zones|parcel-categories|drivers|restaurants)$/],
  ["GET", /^\/restaurants\/[^/]+$/],
  ["GET", /^\/partner-logos\/[^/]+$/],
  ["ANY", /^\/(orders|dispatch)(\/|$)/],
  ["ANY", /^\/push(\/|$)/],
  ["ANY", /^\/notifications(\/|$)/],
];

export function dispatcherMay(method: string, path: string): boolean {
  if (method === "PATCH" && /^\/drivers\/[^/]+$/.test(path)) return true; // champs limités dans la route
  return DISPATCHER_ROUTES.some(([m, re]) => (m === "ANY" || m === method) && re.test(path));
}

// La managerin : tout ce que fait le dispatcheur, plus les demandes (appels, WhatsApp) des clients, restaurants,
// boutiques et livreurs, qu'elle traite avec les autres managerins. Elle peut annuler et accorder une remise, mais
// pas changer les frais de livraison (voir MANAGER_LOCKED_ORDER_FIELDS). Ni finances, ni réglages, ni candidatures,
// ni zones, ni équipe.
export function managerMay(method: string, path: string): boolean {
  if (/^\/requests(\/|$)/.test(path)) return true;
  return dispatcherMay(method, path);
}

// Montants qu'une managerin ou un dispatcheur ne touche pas sur une commande : seuls le directeur les change.
export const MANAGER_LOCKED_ORDER_FIELDS = ["deliveryFee", "extraFee"] as const;

// Le rôle peut-il ouvrir cette route de l'admin ?
export function staffMay(role: TeamRole, method: string, path: string): boolean {
  if (role === "DIRECTOR") return true;
  if (role === "MANAGER") return managerMay(method, path);
  return dispatcherMay(method, path);
}

// Champs d'un livreur réservés au directeur : statut salarié, salaire, et l'identité (nom, numéro).
// Le numéro sert à la connexion par code SMS : le changer reviendrait à prendre le compte du livreur.
export const DIRECTOR_DRIVER_FIELDS = ["employment", "monthlySalary", "name", "phone", "email"] as const;

// Membre connecté, placé dans res.locals.staff par le routeur admin (absent pour les appels sans admin).
type WithStaff = { locals: Record<string, unknown> };
const staffOf = (res: WithStaff) => res.locals.staff as Staff | undefined;
export const isDirector = (res: WithStaff) => (staffOf(res)?.role ?? "DIRECTOR") === "DIRECTOR";
export const staffName = (res: WithStaff) => staffOf(res)?.name ?? null;
export const staffRole = (res: WithStaff): TeamRole => staffOf(res)?.role ?? "DIRECTOR";
export const isManager = (res: WithStaff) => staffRole(res) === "MANAGER";

export const ROLE_LABEL: Record<TeamRole, string> = { DIRECTOR: "Directeur", MANAGER: "Managerin", DISPATCHER: "Dispatcheur" };

// Notifications de l'équipe : catégories d'événements que chaque rôle reçoit. Un nouveau rôle (ex. une
// manageuse) n'a qu'une ligne à ajouter ici ; un rôle absent de la liste reçoit les commandes, les restaurants
// et les livreurs, sans candidatures ni finances.
export const NOTIFICATION_CATEGORIES = ["ORDERS", "RESTAURANTS", "DRIVERS", "APPLICATIONS", "FINANCE"] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
const DEFAULT_CATEGORIES: NotificationCategory[] = ["ORDERS", "RESTAURANTS", "DRIVERS"];
const CATEGORIES_BY_ROLE: Partial<Record<TeamRole, NotificationCategory[]>> = {
  DIRECTOR: [...NOTIFICATION_CATEGORIES],
  // Managerin : commandes, restaurants et livreurs ; ni candidatures ni finances.
  MANAGER: ["ORDERS", "RESTAURANTS", "DRIVERS"],
  DISPATCHER: ["ORDERS", "RESTAURANTS", "DRIVERS"],
};
export const notificationCategoriesFor = (role: string): NotificationCategory[] => CATEGORIES_BY_ROLE[role as TeamRole] ?? DEFAULT_CATEGORIES;
