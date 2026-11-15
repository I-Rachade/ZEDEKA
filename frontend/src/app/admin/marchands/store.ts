// Boutiques en ligne dans l'admin (onglet « Vente en ligne » des Marchands et fiche d'une boutique).

export type StoreStatus = "PENDING" | "ONLINE" | "REJECTED" | "SUSPENDED";
export type StoreCategory = { key: string; label: string; emoji: string };
export type Billing = { mode: "COMMISSION" | "SUBSCRIPTION"; rate: number; fee: number | null };

export type StoresList = {
  categories: StoreCategory[];
  stores: {
    id: string;
    shopName: string;
    phone: string;
    owner: string | null;
    area: string;
    status: StoreStatus;
    category: string | null;
    billing: Billing;
    requestedAt: string | null;
    products: number;
    toReview: number;
  }[];
};

export type AdminProduct = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  stock: number;
  section: string;
  options: { name: string; values: string[] }[];
  imageUrls: string[];
  visible: boolean;
  review: "PENDING" | "APPROVED" | "REJECTED";
  reviewNote: string | null;
  createdAt: string;
};

export type StoreDetail = {
  id: string;
  shopName: string;
  phone: string;
  owner: string | null;
  area: string;
  payoutPhone: string | null;
  active: boolean;
  createdAt: string;
  reviewedBy: string | null;
  status: StoreStatus | "NONE";
  slug: string | null;
  category: string | null;
  description: string | null;
  logoUrl: string | null;
  idNumber: string | null;
  billing: Billing;
  requestedAt: string | null;
  reviewedAt: string | null;
  note: string | null;
  counts: { total: number; pending: number; approved: number; rejected: number };
  products: AdminProduct[];
  banners: { id: string; kind: "IMAGE" | "VIDEO"; url: string; posterUrl: string | null; title: string; productId: string | null; active: boolean }[];
  categories: StoreCategory[];
};

export const STORE_STATUS_LABEL: Record<StoreStatus | "NONE", [string, string]> = {
  NONE: ["Pas demandée", "bg-stone-100 text-stone-700"],
  PENDING: ["À valider", "bg-amber-100 text-amber-800"],
  ONLINE: ["Validée", "bg-emerald-100 text-emerald-800"],
  REJECTED: ["Refusée", "bg-red-100 text-red-800"],
  SUSPENDED: ["Suspendue", "bg-stone-200 text-stone-700"],
};

export const REVIEW_LABEL: Record<AdminProduct["review"], [string, string]> = {
  PENDING: ["À vérifier", "bg-amber-100 text-amber-800"],
  APPROVED: ["Accepté", "bg-emerald-100 text-emerald-800"],
  REJECTED: ["Refusé", "bg-red-100 text-red-800"],
};
