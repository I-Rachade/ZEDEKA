import type { PrismaClient } from "@prisma/client";

// Stock facultatif d'un plat ou d'un article : retiré à la commande, sans jamais passer sous zéro, même si deux
// clients commandent le dernier en même temps. Rend ce qui a été pris si la commande n'est finalement pas créée.

export class OutOfStock extends Error {}

type Line = { menuItemId: string; quantity: number };
type Item = { id: string; name: string; stock?: number | null };

export async function takeStock(prisma: PrismaClient, lines: Line[], items: Item[]): Promise<() => Promise<void>> {
  const wanted = new Map<string, number>();
  for (const l of lines) wanted.set(l.menuItemId, (wanted.get(l.menuItemId) ?? 0) + l.quantity);
  const taken: [string, number][] = [];
  const restore = async () => {
    for (const [id, qty] of taken) await prisma.menuItem.update({ where: { id }, data: { stock: { increment: qty } } }).catch(() => {});
  };
  for (const item of items) {
    const qty = wanted.get(item.id);
    if (!qty || item.stock == null) continue;
    const { count } = await prisma.menuItem.updateMany({ where: { id: item.id, stock: { gte: qty } }, data: { stock: { decrement: qty } } });
    if (!count) {
      await restore();
      throw new OutOfStock(`« ${item.name} » n'est plus disponible en quantité suffisante`);
    }
    taken.push([item.id, qty]);
  }
  return restore;
}
