// Règles communes aux espaces restaurant et loueur : fermeture temporaire, modification d'une commande.

export type CloseDuration = "30m" | "1h" | "tomorrow" | "indefinite";

// Fin de la fermeture : null = jusqu'à réouverture manuelle. « Demain » = 6 h à Lomé (UTC+0).
export function closedUntilFor(duration: CloseDuration, now = new Date()): Date | null {
  if (duration === "30m") return new Date(now.getTime() + 30 * 60_000);
  if (duration === "1h") return new Date(now.getTime() + 60 * 60_000);
  if (duration === "tomorrow") return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 6));
  return null;
}

// Statuts où le restaurant peut encore modifier la commande (avant « Prête »).
export const EDITABLE_STATUSES = ["PENDING", "CONFIRMED", "PREPARING"];

export type EditableItem = { id: string; menuItemId: string; name: string; variantName: string | null; unitPrice: number; quantity: number };
export type EditChange = { itemId: string; quantity: number; replacementId?: string };
export type Replacement = { id: string; name: string; price: number };

export type EditPlan = {
  updates: { id: string; quantity: number }[]; // quantité 0 = ligne supprimée
  additions: { menuItemId: string; name: string; unitPrice: number; quantity: number }[];
  changes: { name: string; from: number; to: number; replacement?: string }[];
  subtotal: number;
};

// Calcule une modification : on ne peut que retirer ou baisser une quantité, et remplacer les unités retirées
// par un plat au même prix ou moins cher. Les prix viennent toujours de la commande et de la carte, pas du client.
export function planOrderEdit(items: EditableItem[], edits: EditChange[], replacements: Replacement[]): EditPlan {
  const plan: EditPlan = { updates: [], additions: [], changes: [], subtotal: 0 };
  const seen = new Set<string>();
  for (const e of edits) {
    const item = items.find((i) => i.id === e.itemId);
    if (!item) throw new Error("Article introuvable dans la commande");
    if (seen.has(item.id)) throw new Error("Article modifié deux fois");
    seen.add(item.id);
    if (!Number.isInteger(e.quantity) || e.quantity < 0 || e.quantity > item.quantity) throw new Error(`Quantité invalide pour ${item.name}`);
    const removed = item.quantity - e.quantity;
    if (removed === 0) {
      if (e.replacementId) throw new Error(`Retirez au moins une unité de ${item.name} pour la remplacer`);
      continue;
    }
    let replacement: Replacement | undefined;
    if (e.replacementId) {
      replacement = replacements.find((r) => r.id === e.replacementId);
      if (!replacement || replacement.id === item.menuItemId) throw new Error(`Remplacement indisponible pour ${item.name}`);
      if (replacement.price > item.unitPrice) throw new Error(`Le remplacement de ${item.name} doit coûter au plus le même prix`);
      plan.additions.push({ menuItemId: replacement.id, name: replacement.name, unitPrice: replacement.price, quantity: removed });
    }
    plan.updates.push({ id: item.id, quantity: e.quantity });
    plan.changes.push({ name: item.variantName ? `${item.name} (${item.variantName})` : item.name, from: item.quantity, to: e.quantity, ...(replacement ? { replacement: replacement.name } : {}) });
  }
  if (!plan.changes.length) throw new Error("Aucune modification");

  const kept = items.map((i) => plan.updates.find((u) => u.id === i.id)?.quantity ?? i.quantity);
  const units = kept.reduce((s, q) => s + q, 0) + plan.additions.reduce((s, a) => s + a.quantity, 0);
  if (units === 0) throw new Error("La commande ne peut pas être vide : annulez-la plutôt");
  plan.subtotal = items.reduce((s, i, k) => s + i.unitPrice * kept[k], 0) + plan.additions.reduce((s, a) => s + a.unitPrice * a.quantity, 0);
  return plan;
}
