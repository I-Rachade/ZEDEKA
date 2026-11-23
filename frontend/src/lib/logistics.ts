"use client";

// Appli marchand : gestion de stock, caisse (POS) et logistique (entrepôt Zedeka, retours, frais).

export type StockItem = {
  id: string;
  name: string;
  sku: string | null;
  quantity: number; // à l'entrepôt Zedeka
  shopQuantity: number; // en boutique
  price: number | null;
  alertAt: number | null;
  location: string | null;
  updatedAt: string;
  low?: boolean;
};

export type StockMovement = {
  id: string;
  kind: "DEPOSIT" | "SHIPMENT" | "CANCEL" | "RETURN" | "ADJUST" | "SALE" | "SALE_CANCEL";
  place: "WAREHOUSE" | "SHOP";
  quantity: number;
  note: string | null;
  by: string | null;
  createdAt: string;
};

export const MOVEMENT_LABEL: Record<StockMovement["kind"], string> = {
  DEPOSIT: "Dépôt à l'entrepôt",
  SHIPMENT: "Colis expédié",
  CANCEL: "Colis annulé",
  RETURN: "Retour remis en stock",
  ADJUST: "Correction",
  SALE: "Vente à la caisse",
  SALE_CANCEL: "Vente annulée",
};

export type SaleLine = { stockItemId: string; name: string; quantity: number; price: number };
export type PosMethod = "CASH" | "FLOOZ" | "TMONEY";
export type PosSale = {
  id: string;
  number: number;
  lines: SaleLine[];
  subtotal: number;
  discount: number;
  total: number;
  method: PosMethod;
  received: number | null;
  reference: string | null;
  customerName: string | null;
  customerPhone: string | null;
  cashier: string | null;
  cancelledAt: string | null;
  createdAt: string;
  change?: number;
};
export type PosDay = {
  day: string;
  summary: { count: number; total: number; byMethod: Record<PosMethod, number>; cancelled: number };
  top: { name: string; quantity: number; amount: number }[];
  sales: PosSale[];
};
export const METHOD_LABEL: Record<PosMethod, string> = { CASH: "Espèces", FLOOZ: "Flooz", TMONEY: "T-Money" };

export type DepositLine = { stockItemId: string | null; name: string; sku: string | null; quantity: number; fromShop?: boolean; received?: number };
export type StockDeposit = { id: string; status: "PENDING" | "RECEIVED" | "CANCELLED"; lines: DepositLine[]; note: string | null; createdAt: string; receivedAt: string | null };
export type ReturnStatus = "TO_COLLECT" | "AT_WAREHOUSE" | "RESTOCKED" | "HANDED_BACK";
export type ParcelReturnRow = {
  id: string;
  code: string;
  recipientName: string | null;
  reason: string;
  reasonLabel: string;
  note: string | null;
  status: ReturnStatus;
  fee: number;
  fromStock: boolean;
  createdAt: string;
};
export type Charge = { id: string; kind: "STORAGE" | "RETURN"; amount: number; label: string; createdAt: string };
export type Logistics = {
  warehouse: { address: string } | null;
  fees: { storagePerItem: number; returnFee: number };
  items: StockItem[];
  units: number;
  deposits: StockDeposit[];
  returns: ParcelReturnRow[];
  charges: { due: number; open: Charge[]; withheld: Charge[] };
};

export const RETURN_STATUS: Record<ReturnStatus, [string, string]> = {
  TO_COLLECT: ["À ramener", "bg-amber-100 text-amber-800"],
  AT_WAREHOUSE: ["À l'entrepôt", "bg-sky-100 text-sky-800"],
  RESTOCKED: ["Remis en stock", "bg-emerald-100 text-emerald-800"],
  HANDED_BACK: ["Rendu", "bg-stone-200 text-stone-700"],
};
export const DEPOSIT_STATUS: Record<StockDeposit["status"], [string, string]> = {
  PENDING: ["À recevoir", "bg-amber-100 text-amber-800"],
  RECEIVED: ["Reçu", "bg-emerald-100 text-emerald-800"],
  CANCELLED: ["Annulé", "bg-stone-200 text-stone-700"],
};
export const RETURN_REASON_OPTIONS = [
  ["REFUSED", "Refusé par le destinataire"],
  ["ABSENT", "Destinataire absent ou injoignable"],
  ["DAMAGED", "Colis abîmé"],
  ["CUSTOMER_RETURN", "Renvoyé par le client après livraison"],
  ["OTHER", "Autre motif"],
] as const;

// Clé anti-doublon d'une vente (renvoi après une coupure de réseau).
export const saleKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
