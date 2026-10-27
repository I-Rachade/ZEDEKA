"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/panel/icons";
import { LogoMark } from "@/components/Logo";
import { PushBanner } from "@/components/panel/partner";
import { card, Empty, Skeleton } from "@/app/app/ui";
import { fcfa } from "@/lib/api";
import { driverFetch, shownStatus, useDriverSession, useQueue, type DriverOrder } from "@/lib/driver";
import { driverClient } from "./client";
import { useDriver } from "./DriverShell";

const STEP_LABEL: Record<string, string> = { PICKED_UP: "En livraison", DELIVERED: "Livrée" };

function stepOf(o: DriverOrder, status: DriverOrder["status"]) {
  if (STEP_LABEL[status]) return STEP_LABEL[status];
  if (o.type === "FOOD") return status === "READY" ? "Prête au restaurant" : status === "PENDING" ? "En attente du restaurant" : "En préparation";
  return "À récupérer";
}

// Accueil du livreur : en ligne ou non, courses en cours.
export default function DriverHome() {
  const session = useDriverSession();
  const { current, reload, setNotice } = useDriver();
  const queue = useQueue();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (!current) return;
    setBusy(true);
    try {
      await driverFetch("/online", { method: "PATCH", body: { online: !current.online } });
      await reload();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const online = current?.online ?? false;
  const active = current?.active ?? [];

  return (
    <div>
      <header className="bg-emerald-700 px-4 pb-6 pt-5 text-white">
        <div className="flex items-center gap-3">
          <LogoMark className="h-10 w-10" />
          <div>
            <p className="text-sm text-emerald-100">Bonjour</p>
            <p className="font-display text-xl font-extrabold">{session?.name}</p>
          </div>
        </div>
        <button
          onClick={toggle}
          disabled={!current || busy}
          role="switch"
          aria-checked={online}
          className={`mt-4 flex w-full items-center justify-between rounded-2xl px-4 py-4 text-left shadow ${online ? "bg-white text-emerald-800" : "bg-emerald-900/40 text-white"}`}
        >
          <span>
            <span className="block text-lg font-bold">{online ? "En ligne" : "Hors ligne"}</span>
            <span className={`block text-sm ${online ? "text-emerald-700" : "text-emerald-100"}`}>
              {online ? "La répartition peut vous confier des courses" : "Passez en ligne pour recevoir des courses"}
            </span>
          </span>
          <span className={`relative h-8 w-14 shrink-0 rounded-full transition ${online ? "bg-emerald-600" : "bg-white/30"}`}>
            <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${online ? "left-7" : "left-1"}`} />
          </span>
        </button>
      </header>

      <div className="space-y-4 px-4 py-4">
        <PushBanner api={driverClient} what="course proposée" />
        <h2 className="text-lg font-semibold">Courses en cours</h2>
        {!current ? (
          <Skeleton rows={2} />
        ) : active.length === 0 ? (
          <div className={card}>
            {online && (
              <div className="relative mx-auto mt-6 h-10 w-56 overflow-hidden" aria-hidden="true">
                <span className="absolute inset-x-0 bottom-1 border-t-2 border-dashed border-stone-300" />
                <span className="anim-ride absolute bottom-2 left-0 block [--ride:12rem]">
                  <LogoMark className="h-8 w-8" />
                </span>
              </div>
            )}
            <Empty icon="rider" title={online ? "En attente d'une course" : "Aucune course"}>
              {online ? "Gardez l'application ouverte : une alarme sonne dès qu'une course vous est proposée." : "Vous êtes hors ligne."}
            </Empty>
          </div>
        ) : (
          <ul className="space-y-3">
            {active.map((o) => {
              const status = shownStatus(o, queue);
              const pending = queue.some((q) => q.orderId === o.id);
              return (
                <li key={o.id}>
                  <Link href={`/livreur/course/${o.id}`} className={`${card} block p-4`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold">
                        {o.code} · {o.type === "FOOD" ? o.restaurant?.name : "Colis"}
                      </p>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${status === "PICKED_UP" ? "bg-sky-100 text-sky-800" : "bg-amber-100 text-amber-800"}`}>{stepOf(o, status)}</span>
                    </div>
                    <p className="mt-1 flex items-start gap-1.5 text-sm text-stone-600">
                      <Icon name="pin" className="mt-0.5 h-4 w-4 shrink-0" />
                      {status === "PICKED_UP" ? o.address : o.restaurant ? o.restaurant.address : o.pickupAddress}
                    </p>
                    <p className="mt-1 text-sm text-stone-500">
                      {o.cashDue ? `À encaisser : ${fcfa(o.cashDue)}` : "Déjà payé"}
                      {pending && " · étape en attente de réseau"}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
