export type CartLine = { menuItemId: string; quantity: number };
export type PricedItem = { id: string; name: string; price: number };

export type PricedOrder = {
  lines: { menuItemId: string; name: string; unitPrice: number; quantity: number }[];
  subtotal: number;
  deliveryFee: number;
  total: number;
};

// Les prix viennent toujours de la base, jamais du client.
export function priceOrder(cart: CartLine[], items: PricedItem[], deliveryFee: number): PricedOrder {
  const byId = new Map(items.map((i) => [i.id, i]));
  const merged = new Map<string, number>();
  for (const line of cart) {
    merged.set(line.menuItemId, (merged.get(line.menuItemId) ?? 0) + line.quantity);
  }

  const lines = [...merged].map(([menuItemId, quantity]) => {
    const item = byId.get(menuItemId);
    if (!item) throw new Error(`Article indisponible : ${menuItemId}`);
    return { menuItemId, name: item.name, unitPrice: item.price, quantity };
  });

  const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  return { lines, subtotal, deliveryFee, total: subtotal + deliveryFee };
}

export function formatFcfa(amount: number): string {
  return `${amount.toLocaleString("fr-FR").replace(/ | /g, " ")} FCFA`;
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function orderCode(random: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return `ZD-${code}`;
}

type WhatsappOrder = {
  code: string;
  restaurantName: string;
  zoneName: string;
  customerName: string;
  customerPhone: string;
  address: string;
  note?: string | null;
  paymentMethod: "CASH" | "MOBILE_MONEY";
  items: { name: string; unitPrice: number; quantity: number }[];
  subtotal: number;
  deliveryFee: number;
  total: number;
};

export function whatsappMessage(o: WhatsappOrder): string {
  const lines = [
    `Nouvelle commande ${o.code}`,
    `Restaurant : ${o.restaurantName}`,
    "",
    ...o.items.map((i) => `${i.quantity} x ${i.name} (${formatFcfa(i.unitPrice * i.quantity)})`),
    "",
    `Sous-total : ${formatFcfa(o.subtotal)}`,
    `Livraison (${o.zoneName}) : ${formatFcfa(o.deliveryFee)}`,
    `Total : ${formatFcfa(o.total)}`,
    `Paiement : ${o.paymentMethod === "CASH" ? "Espèces à la livraison" : "Mobile money"}`,
    "",
    `Client : ${o.customerName}, ${o.customerPhone}`,
    `Adresse : ${o.address}`,
  ];
  if (o.note) lines.push(`Note : ${o.note}`);
  return lines.join("\n");
}

export function whatsappUrl(phone: string, message: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}
