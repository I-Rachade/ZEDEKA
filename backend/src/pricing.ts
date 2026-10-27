import { randomInt } from "node:crypto";

export type CartLine = { menuItemId: string; quantity: number; variantId?: string; addonIds?: string[] };

export type PricedItem = {
  id: string;
  name: string;
  price: number;
  variants: { id: string; name: string; price: number }[];
  addons: { id: string; name: string; price: number }[];
};

export type PricedLine = {
  menuItemId: string;
  name: string;
  variantName: string | null;
  addons: { name: string; price: number }[];
  unitPrice: number;
  quantity: number;
};

export type PricedOrder = {
  lines: PricedLine[];
  subtotal: number;
  deliveryFee: number;
  total: number;
};

// Les prix viennent toujours de la base, jamais du client.
export function priceOrder(cart: CartLine[], items: PricedItem[], deliveryFee: number): PricedOrder {
  const byId = new Map(items.map((i) => [i.id, i]));
  const merged = new Map<string, PricedLine>();

  for (const line of cart) {
    const item = byId.get(line.menuItemId);
    if (!item) throw new Error(`Article indisponible : ${line.menuItemId}`);

    let variant: PricedItem["variants"][number] | undefined;
    if (item.variants.length > 0) {
      variant = item.variants.find((v) => v.id === line.variantId);
      if (!variant) throw new Error(`Choisissez une variante pour « ${item.name} »`);
    }
    const addonIds = [...new Set(line.addonIds ?? [])].sort();
    const addons = addonIds.map((id) => {
      const addon = item.addons.find((a) => a.id === id);
      if (!addon) throw new Error(`Supplément indisponible pour « ${item.name} »`);
      return { name: addon.name, price: addon.price };
    });

    const key = [item.id, variant?.id ?? "", ...addonIds].join("|");
    const existing = merged.get(key);
    if (existing) {
      existing.quantity += line.quantity;
      continue;
    }
    merged.set(key, {
      menuItemId: item.id,
      name: item.name,
      variantName: variant?.name ?? null,
      addons,
      unitPrice: (variant?.price ?? item.price) + addons.reduce((s, a) => s + a.price, 0),
      quantity: line.quantity,
    });
  }

  const lines = [...merged.values()];
  const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  return { lines, subtotal, deliveryFee, total: subtotal + deliveryFee };
}

export function formatFcfa(amount: number): string {
  return `${amount.toLocaleString("fr-FR").replace(/ | /g, " ")} FCFA`;
}

// Tirage cryptographique : les codes servent à suivre une commande, ils ne doivent pas être prévisibles.
export const secureRandom = () => randomInt(0, 1 << 30) / (1 << 30);

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function orderCode(random: () => number = secureRandom): string {
  let code = "";
  for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return `ZD-${code}`;
}

export function lineLabel(l: { name: string; variantName?: string | null; addons?: { name: string }[] }): string {
  const extras = [l.variantName, ...(l.addons ?? []).map((a) => `+ ${a.name}`)].filter(Boolean);
  return extras.length ? `${l.name} (${extras.join(", ")})` : l.name;
}

type WhatsappOrder = {
  code: string;
  title: string; // « Restaurant : … » ou « Colis : … »
  zoneName: string;
  customerName: string;
  customerPhone: string;
  address: string;
  note?: string | null;
  paymentMethod: "CASH" | "MOBILE_MONEY";
  details: string[];
  subtotal: number;
  deliveryFee: number;
  extraFee?: number;
  total: number;
};

export function whatsappMessage(o: WhatsappOrder): string {
  const lines = [
    `Nouvelle commande ${o.code}`,
    o.title,
    "",
    ...o.details,
    "",
    ...(o.subtotal ? [`Sous-total : ${formatFcfa(o.subtotal)}`] : []),
    `Livraison (${o.zoneName}) : ${formatFcfa(o.deliveryFee)}`,
    ...(o.extraFee ? [`Supplément : ${formatFcfa(o.extraFee)}`] : []),
    `Total : ${formatFcfa(o.total)}`,
    `Paiement : ${o.paymentMethod === "CASH" ? "Espèces à la livraison" : "Mobile money"}`,
    "",
    `Client : ${o.customerName}, ${o.customerPhone}`,
    `Adresse : ${o.address}`,
  ];
  if (o.note) lines.push(`Note : ${o.note}`);
  return lines.join("\n");
}

export function foodDetails(lines: PricedLine[]): string[] {
  return lines.map((l) => `${l.quantity} x ${lineLabel(l)} (${formatFcfa(l.unitPrice * l.quantity)})`);
}

export function whatsappUrl(phone: string, message: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}
