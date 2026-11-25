// choices : une valeur par groupe de choix du plat, dans l'ordre des groupes (ex. ["Arachide", "Piquant"]).
export type CartLine = { menuItemId: string; quantity: number; variantId?: string; addonIds?: string[]; choices?: string[] };

export type OptionGroup = { name: string; values: string[] };

// Groupes de choix d'un plat, tels que gardés en base (JSON) : on ignore ce qui n'a pas la bonne forme.
export function optionGroups(raw: unknown): OptionGroup[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((g) =>
    g && typeof g === "object" && typeof (g as OptionGroup).name === "string" && Array.isArray((g as OptionGroup).values)
      ? [{ name: (g as OptionGroup).name, values: (g as OptionGroup).values.filter((v): v is string => typeof v === "string") }]
      : [],
  );
}

export function photoList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((u): u is string => typeof u === "string") : [];
}

export type PricedItem = {
  id: string;
  name: string;
  price: number;
  variants: { id: string; name: string; price: number }[];
  addons: { id: string; name: string; price: number }[];
  options?: unknown; // groupes de choix (JSON de la base)
  stock?: number | null; // vide : illimité
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

    // Un choix par groupe (sauce, cuisson…) : obligatoire, et parmi les valeurs proposées par le restaurant.
    const groups = optionGroups(item.options);
    const choices = groups.map((g, i) => {
      const value = line.choices?.[i];
      if (!value || !g.values.includes(value)) throw new Error(`Choisissez « ${g.name} » pour « ${item.name} »`);
      return `${g.name} : ${value}`;
    });

    const key = [item.id, variant?.id ?? "", ...addonIds, ...choices].join("|");
    const existing = merged.get(key);
    if (existing) {
      existing.quantity += line.quantity;
      continue;
    }
    // Les choix suivent la variante dans le libellé : cuisine, livreur et reçu les voient sans autre changement.
    const label = [variant?.name, ...choices].filter(Boolean).join(" · ");
    merged.set(key, {
      menuItemId: item.id,
      name: item.name,
      variantName: label || null,
      addons,
      unitPrice: (variant?.price ?? item.price) + addons.reduce((s, a) => s + a.price, 0),
      quantity: line.quantity,
    });
  }

  const lines = [...merged.values()];
  // Stock limité : la quantité totale du plat (toutes variantes) ne peut pas le dépasser.
  for (const item of items) {
    if (item.stock == null) continue;
    const wanted = lines.filter((l) => l.menuItemId === item.id).reduce((s, l) => s + l.quantity, 0);
    if (wanted > item.stock) {
      throw new Error(item.stock > 0 ? `Plus que ${item.stock} « ${item.name} » disponible(s)` : `« ${item.name} » est épuisé`);
    }
  }
  const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  return { lines, subtotal, deliveryFee, total: subtotal + deliveryFee };
}

export function formatFcfa(amount: number): string {
  return `${amount.toLocaleString("fr-FR").replace(/ | /g, " ")} FCFA`;
}

// Sans 0/O, 1/I/L : lisible à l'oral et au téléphone.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

// Tirage cryptographique : les codes servent à suivre une commande, ils ne doivent pas être prévisibles.
export const secureRandom = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;

// Code public d'une commande : préfixe + 8 caractères en deux groupes (ex. ZD-K7MQ-3XPA).
export function publicCode(prefix: string, random: () => number = secureRandom): string {
  let code = "";
  for (let i = 0; i < 8; i++) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return `${prefix}-${code.slice(0, 4)}-${code.slice(4)}`;
}

export function orderCode(random: () => number = secureRandom): string {
  return publicCode("ZD", random);
}

// Remet en forme un code saisi à la main (minuscules, espaces, tirets oubliés).
// Les anciens codes à 4 caractères (ZD-B4Q4) restent reconnus.
export function normalizeCode(input: string): string {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m = /^(Z[A-Z])([A-Z0-9]{4})([A-Z0-9]{4})?$/.exec(raw);
  if (!m) return input.toUpperCase().replace(/\s/g, "");
  return m[3] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[1]}-${m[2]}`;
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
  payer?: string; // colis : SENDER ou RECIPIENT
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
    `Paiement : ${o.payer === "RECIPIENT" ? "par le destinataire, en espèces à la livraison" : o.paymentMethod === "CASH" ? "Espèces à la livraison" : "Mobile money"}`,
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
