import { apiGet, apiPost } from "./api";
import { readStored, writeStored } from "./device";

// Commandes groupées (bureaux, écoles) : lien /groupe/<code>, chacun ajoute sa part, l'organisateur envoie une seule
// commande (API src/routes/companyRoutes.ts).
export type GroupView = {
  code: string;
  status: "OPEN" | "SUBMITTING" | "SUBMITTED" | "CANCELLED";
  hostName: string;
  deadline: string | null;
  address: string;
  company: string | null;
  orderCode: string | null;
  restaurant: { slug: string; name: string; minOrderAmount: number } | null;
  lines: { id: string; participant: string; subtotal: number; items: { name: string; quantity: number }[] }[];
  subtotal: number;
};

export type GroupItem = { menuItemId: string; quantity: number; variantId?: string; addonIds?: string[]; choices?: string[] };

export const fetchGroup = (code: string) => apiGet<GroupView>(`/api/group-orders/${encodeURIComponent(code)}`);
export const addGroupPart = (code: string, participant: string, items: GroupItem[]) =>
  apiPost<{ id: string; editKey: string; subtotal: number }>(`/api/group-orders/${encodeURIComponent(code)}/lines`, { participant, items });

// Clés des parts ajoutées depuis ce téléphone (pour retirer la sienne) et prénom retenu.
const KEYS = "zedeka.groupParts";
export const myPartKeys = () => readStored<Record<string, string>>(KEYS) ?? {};
export const rememberPartKey = (lineId: string, key: string) => writeStored(KEYS, { ...myPartKeys(), [lineId]: key });

export async function removeMyPart(code: string, lineId: string) {
  const key = myPartKeys()[lineId];
  const res = await fetch(`/api/group-orders/${encodeURIComponent(code)}/lines/${encodeURIComponent(lineId)}`, { method: "DELETE", headers: { "x-edit-key": key ?? "" } });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Impossible de retirer cette part");
}
