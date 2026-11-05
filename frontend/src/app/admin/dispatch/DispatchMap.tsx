"use client";

import "leaflet/dist/leaflet.css";
import type { LayerGroup, Map as LeafletMap } from "leaflet";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { AdminOrder, Driver } from "@/lib/admin";
import { useT } from "@/lib/i18n/client";

// Répartition en direct (planche 4) : livreurs sur la carte (vert : libre, jaune : en course, gris : vu il y a plus de
// 5 min), restaurants, et commandes à affecter en rouge. Une commande choisie propose les 3 livreurs libres les plus
// proches, chacun avec « Affecter ».

type Point = { latitude: number; longitude: number };
export type DispatchMapData = {
  restaurants: (Point & { id: string; name: string })[];
  pickups: Record<string, Point | null>;
  ratings: Record<string, number | null>;
  counts: { kitchen: number; late: number };
};

const STALE_MS = 5 * 60_000;
const LOME: [number, number] = [6.1319, 1.2228];

function km(a: Point, b: Point) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
const where = (d: Driver): Point | null =>
  d.lastLatitude != null && d.lastLongitude != null
    ? { latitude: d.lastLatitude, longitude: d.lastLongitude }
    : null;
const stale = (d: Driver, now: number) =>
  !d.lastLocationAt || now - new Date(d.lastLocationAt).getTime() > STALE_MS;
const state = (d: Driver, now: number) =>
  stale(d, now) ? "STALE" : (d.activeOrders ?? 0) > 0 ? "BUSY" : "FREE";
const COLORS = { FREE: "#0e7c4a", BUSY: "#ffb020", STALE: "#9ca3af" } as const;
const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function Counter({
  value,
  label,
  alert,
}: {
  value: number;
  label: string;
  alert?: boolean;
}) {
  const t = useT();
  return (
    <div
      className={`rounded-lg border bg-white px-3 py-2 shadow-sm ${alert ? "border-red-400" : "border-stone-200"}`}
    >
      <p
        className={`text-xl font-extrabold tabular-nums ${alert ? "text-red-600" : ""}`}
      >
        {value}
      </p>
      <p className="text-xs text-stone-600">{t(label)}</p>
    </div>
  );
}

function Legend() {
  const t = useT();
  const item = (color: string, label: string) => (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-stone-50 px-2 py-0.5 text-xs font-semibold">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {t(label)}
    </span>
  );
  return (
    <div className="flex flex-wrap gap-1.5 rounded-lg border border-stone-200 bg-white p-2 shadow-sm">
      {item(COLORS.FREE, "Libre")}
      {item(COLORS.BUSY, "En course")}
      {item(COLORS.STALE, "Vu > 5 min")}
    </div>
  );
}

export default function DispatchMap({
  map: data,
  unassigned,
  ongoing,
  drivers,
  onAssign,
}: {
  map: DispatchMapData;
  unassigned: AdminOrder[];
  ongoing: AdminOrder[];
  drivers: Driver[];
  onAssign: (orderId: string, driverId: string) => void;
}) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const leaflet = useRef<{
    map: LeafletMap;
    layer: LayerGroup;
    L: typeof import("leaflet");
    fitted: boolean;
  } | null>(null);
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !box.current) return;
      const map = L.map(box.current, {
        zoomControl: true,
        attributionControl: true,
      }).setView(LOME, 13);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap",
      }).addTo(map);
      leaflet.current = {
        map,
        layer: L.layerGroup().addTo(map),
        L,
        fitted: false,
      };
      setReady(true);
    });
    return () => {
      cancelled = true;
      leaflet.current?.map.remove();
      leaflet.current = null;
    };
  }, []);

  const order =
    unassigned.find((o) => o.id === selected) ?? unassigned[0] ?? null;
  const from = order ? data.pickups[order.id] : null;
  const nearest = from
    ? drivers
        .filter((d) => d.online && where(d) && state(d, now) === "FREE")
        .map((d) => ({ d, km: km(from, where(d)!) }))
        .sort((a, b) => a.km - b.km)
        .slice(0, 3)
    : [];
  const nearestKey = nearest.map((n) => n.d.id).join();

  // Points redessinés à chaque rafraîchissement des données (toutes les 10 s) et au choix d'une commande.
  useEffect(() => {
    const s = leaflet.current;
    if (!ready || !s) return;
    const { L, layer, map } = s;
    const at = Date.now();
    layer.clearLayers();
    const icon = (html: string, size: number) =>
      L.divIcon({
        html,
        className: "",
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
    const disc = (bg: string, emoji: string, size: number, border = "#fff") =>
      `<span style="display:grid;place-items:center;width:${size}px;height:${size}px;border-radius:9999px;background:${bg};border:2px solid ${border};box-shadow:0 1px 3px rgb(0 0 0 / .3);font-size:${size / 2}px">${emoji}</span>`;
    const pts: [number, number][] = [];
    for (const r of data.restaurants) {
      L.marker([r.latitude, r.longitude], {
        icon: icon(disc("#fff", "🍗", 26, COLORS.FREE), 26),
        title: r.name,
      }).addTo(layer);
      pts.push([r.latitude, r.longitude]);
    }
    for (const d of drivers) {
      const p = where(d);
      if (!p || (!d.online && stale(d, at))) continue;
      L.marker([p.latitude, p.longitude], {
        icon: icon(disc(COLORS[state(d, at)], "🛵", 30), 30),
        title: d.name,
      }).addTo(layer);
      pts.push([p.latitude, p.longitude]);
    }
    for (const o of unassigned) {
      const p = data.pickups[o.id];
      if (!p) continue;
      const on = o.id === order?.id;
      const m = L.marker([p.latitude, p.longitude], {
        icon: icon(
          `<span style="display:grid;place-items:center;width:40px;height:40px;border-radius:9999px;background:rgb(229 72 77 / ${on ? 0.3 : 0.18})"><span style="display:grid;place-items:center;width:24px;height:24px;border-radius:9999px;background:#e5484d;border:2px solid #fff;color:#fff;font-size:11px;font-weight:800">!</span></span>`,
          40,
        ),
        title: o.code,
        zIndexOffset: 1000,
      }).addTo(layer);
      m.on("click", () => setSelected(o.id));
    }
    if (from && nearest[0]) {
      const p = where(nearest[0].d)!;
      L.polyline(
        [
          [from.latitude, from.longitude],
          [p.latitude, p.longitude],
        ],
        { color: COLORS.FREE, weight: 3, dashArray: "4 8" },
      ).addTo(layer);
    }
    if (!s.fitted && pts.length > 1) {
      map.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 15 });
      s.fitted = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, data, drivers, unassigned, order?.id, nearestKey]);

  const enRoute = ongoing.filter((o) => o.status === "PICKED_UP").length;
  const since = order
    ? now - new Date(order.readyAt ?? order.createdAt).getTime()
    : 0;

  return (
    <div className="relative h-[620px] overflow-hidden rounded-lg border border-stone-200 bg-stone-200">
      <div ref={box} className="absolute inset-0 z-0" />
      <div className="pointer-events-none absolute inset-x-3 top-3 z-[500] flex flex-wrap items-start justify-between gap-2">
        <div className="pointer-events-auto flex flex-wrap gap-2">
          <Counter value={enRoute} label="en route" />
          <Counter value={data.counts.kitchen} label="en cuisine" />
          <Counter
            value={data.counts.late}
            label="en retard"
            alert={data.counts.late > 0}
          />
          <Counter
            value={unassigned.length}
            label="à affecter"
            alert={unassigned.length > 0}
          />
        </div>
        <div className="pointer-events-auto">
          <Legend />
        </div>
      </div>
      {order && (
        <section className="absolute bottom-3 right-3 z-[500] w-[min(340px,calc(100%-24px))] rounded-lg border border-stone-200 bg-white p-3 shadow-lg">
          <div className="flex items-start justify-between gap-2">
            <Link
              href={`/admin/commandes/${order.id}`}
              className="font-bold hover:underline"
            >
              {order.code}
              {order.restaurant ? ` · ${order.restaurant.name}` : ""}
            </Link>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-red-50 px-2 py-0.5 text-xs font-semibold tabular-nums text-red-700">
              <span className="h-1.5 w-1.5 rounded-full bg-red-600" />
              {clock(since)}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-stone-600">
            {order.type === "PARCEL"
              ? t("Colis")
              : order.status === "READY"
                ? t("Prête")
                : t("En livraison")}{" "}
            · → {order.address.split(",")[0]}
            {order.distanceKm != null &&
              ` · ${order.distanceKm.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km`}
          </p>
          <p className="mt-2 text-xs font-bold">
            {t("Les 3 livreurs libres les plus proches")}
          </p>
          {nearest.length === 0 ? (
            <p className="mt-1 text-xs text-stone-500">
              {t("Aucun livreur libre avec une position récente.")}
            </p>
          ) : (
            <ul className="mt-1 space-y-1">
              {nearest.map(({ d, km: dist }) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: COLORS.FREE }}
                    />
                    <span className="truncate">
                      {d.name} ·{" "}
                      {dist.toLocaleString("fr-FR", {
                        maximumFractionDigits: 1,
                      })}{" "}
                      km
                      {d.employment === "STAFF"
                        ? ` · ${t("salarié")}`
                        : data.ratings[d.id] != null
                          ? ` · ★ ${data.ratings[d.id]!.toLocaleString("fr-FR")}`
                          : ""}
                    </span>
                  </span>
                  <button
                    onClick={() => onAssign(order.id, d.id)}
                    className="shrink-0 font-bold text-[#0e7c4a] hover:underline"
                  >
                    {t("Affecter")}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {unassigned.length > 1 && (
            <p className="mt-2 text-[11px] text-stone-500">
              {t("Touchez un point rouge pour une autre commande.")}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
