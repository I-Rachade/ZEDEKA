import { type Restaurant, type TableInfo } from "@/lib/api";
import { serverGet } from "@/lib/serverApi";

// Table d'un QR code et carte de son restaurant ; null si le QR code n'existe plus.
export async function loadTable(token: string) {
  const table = await serverGet<TableInfo>(`/api/tables/${encodeURIComponent(token)}`);
  if (!table) return null;
  const restaurant = await serverGet<Restaurant>(`/api/restaurants/${encodeURIComponent(table.restaurant.slug)}`);
  return restaurant ? { table, restaurant } : null;
}
