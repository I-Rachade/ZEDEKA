// Comptabilité de Zedeka : comptes de trésorerie (caisse, mobile money, banque) et journal des recettes et des
// dépenses. Les écrans sont dans src/routes/adminAccounting.ts ; le rôle « ACCOUNTANT » les ouvre (voir team.ts).
// Les chiffres de la plateforme (commandes, abonnements, leasing, plans Zed, espèces des livreurs, reversements)
// sont relus des tables existantes, sans double saisie ; le journal garde ce qui se passe hors de l'application
// (loyer, énergie, salaires, achats…).

export const ACCOUNT_KINDS = ["CASH", "MOBILE_MONEY", "BANK", "OTHER"] as const;
export const DIRECTIONS = ["IN", "OUT"] as const;
export type Direction = (typeof DIRECTIONS)[number];

// Catégories du journal, par sens. TRANSFER : virement entre deux comptes de Zedeka (hors recettes et dépenses).
export const INCOME_CATEGORIES = ["DELIVERY", "COMMISSIONS", "SUBSCRIPTIONS", "LEASING", "ZED_PLANS", "ADVERTISING", "CAPITAL", "LOAN", "OTHER_INCOME"] as const;
export const EXPENSE_CATEGORIES = [
  "SALARIES",
  "DRIVER_PAYMENTS",
  "RESTAURANT_PAYOUTS",
  "RENT",
  "ENERGY",
  "MAINTENANCE",
  "EQUIPMENT",
  "VEHICLES",
  "MARKETING",
  "TELECOM",
  "TAXES",
  "BANK_FEES",
  "LOAN_REPAYMENT",
  "OTHER_EXPENSE",
] as const;
export const CATEGORIES = [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES, "TRANSFER"] as const;
export type Category = (typeof CATEGORIES)[number];

export const categoryFits = (direction: Direction, category: string) =>
  category === "TRANSFER" || (direction === "IN" ? (INCOME_CATEGORIES as readonly string[]) : (EXPENSE_CATEGORIES as readonly string[])).includes(category);

type Entry = { direction: string; category: string; amount: number; accountId: string | null; voidedAt: Date | null };

/** Solde de chaque compte : solde d'ouverture + recettes − dépenses (écritures annulées exclues). */
export function accountBalances<A extends { id: string; openingBalance: number }>(accounts: A[], entries: Entry[]) {
  const moves = new Map<string, { in: number; out: number }>();
  for (const e of entries) {
    if (e.voidedAt || !e.accountId) continue;
    const m = moves.get(e.accountId) ?? { in: 0, out: 0 };
    if (e.direction === "IN") m.in += e.amount;
    else m.out += e.amount;
    moves.set(e.accountId, m);
  }
  return accounts.map((a) => {
    const m = moves.get(a.id) ?? { in: 0, out: 0 };
    return { ...a, totalIn: m.in, totalOut: m.out, balance: a.openingBalance + m.in - m.out };
  });
}

/** Totaux d'une période : recettes, dépenses, résultat, et détail par catégorie (virements à part). */
export function journalTotals(entries: Entry[]) {
  const live = entries.filter((e) => !e.voidedAt);
  const byCategory = new Map<string, { direction: string; amount: number; count: number }>();
  let income = 0;
  let expense = 0;
  let transfers = 0;
  for (const e of live) {
    if (e.category === "TRANSFER") {
      if (e.direction === "OUT") transfers += e.amount;
      continue;
    }
    if (e.direction === "IN") income += e.amount;
    else expense += e.amount;
    const key = `${e.direction}:${e.category}`;
    const c = byCategory.get(key) ?? { direction: e.direction, amount: 0, count: 0 };
    c.amount += e.amount;
    c.count++;
    byCategory.set(key, c);
  }
  return {
    income,
    expense,
    result: income - expense,
    transfers,
    byCategory: [...byCategory].map(([key, c]) => ({ category: key.split(":")[1], ...c })).sort((a, b) => b.amount - a.amount),
  };
}

/** Période d'un écran : du (inclus) / au (inclus), en jours AAAA-MM-JJ ; par défaut le mois en cours. */
export function periodOf(from: Date | null, to: Date | null, now = new Date()) {
  const start = from ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastDay = to ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  const end = new Date(lastDay.getTime() + 86_400_000); // exclu
  if (end.getTime() <= start.getTime()) return null;
  // Au plus deux ans d'un coup.
  if (end.getTime() - start.getTime() > 731 * 86_400_000) return null;
  return { start, end, from: start.toISOString().slice(0, 10), to: lastDay.toISOString().slice(0, 10) };
}
