"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { usePlace } from "@/lib/customer";
import { useRestaurants } from "../data";
import { Empty, input, RestaurantCard, Skeleton, TopBar } from "../ui";

const SUGGESTIONS = ["Poulet", "Poisson", "Riz", "Pâte", "Alloco", "Boissons"];

export default function Search() {
  const place = usePlace();
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);
  const results = useRestaurants(place?.zoneId, q.length >= 2 ? q : "");

  return (
    <div>
      <TopBar title="Recherche" />
      <div className="space-y-4 px-4 py-4">
        <label className="relative block">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400">
            <Icon name="search" />
          </span>
          <input
            type="search"
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Un plat, un restaurant…"
            aria-label="Rechercher un plat ou un restaurant"
            className={`${input} pl-10`}
          />
        </label>
        {q.length < 2 && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => setText(s)} className="rounded-full bg-white px-3 py-1.5 text-sm ring-1 ring-stone-200">
                {s}
              </button>
            ))}
          </div>
        )}
        {results.loading || !results.data ? (
          <Skeleton />
        ) : results.data.length === 0 ? (
          <Empty icon="search" title="Aucun résultat">
            Essayez un autre mot, par exemple le nom d&apos;un plat.
          </Empty>
        ) : (
          <div className="space-y-3">
            {q.length >= 2 && <p className="text-sm text-stone-500">{results.data.length} restaurant(s)</p>}
            {results.data.map((r) => (
              <RestaurantCard key={r.slug} r={r} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
