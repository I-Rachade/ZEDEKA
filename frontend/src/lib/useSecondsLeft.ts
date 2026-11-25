"use client";

import { useEffect, useState } from "react";

// Secondes restantes avant une échéance, avec le décalage de l'horloge du téléphone. L'horloge est lue souvent pour
// rester précise, mais l'écran n'est redessiné qu'une fois par seconde, quand le chiffre change (et non 2 à 4 fois
// par seconde) : moins de travail pour un téléphone d'entrée de gamme et sa batterie.
export function useSecondsLeft(deadline: string, offsetMs: number, everyMs = 250): number {
  const compute = () => Math.max(0, Math.ceil((new Date(deadline).getTime() - (Date.now() + offsetMs)) / 1000));
  const [left, setLeft] = useState(compute);
  useEffect(() => {
    setLeft(compute());
    const timer = setInterval(() => setLeft(compute()), everyMs);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- compute ne dépend que de ces valeurs
  }, [deadline, offsetMs, everyMs]);
  return left;
}
