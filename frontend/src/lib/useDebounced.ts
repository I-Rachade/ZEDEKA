"use client";

import { useEffect, useState } from "react";

// Valeur qui ne suit la saisie qu'après une pause (recherche) : une seule lecture de l'API quand on s'arrête de taper,
// au lieu d'une par lettre. Une valeur vide passe tout de suite (effacer la recherche ne doit pas attendre).
export function useDebounced<T>(value: T, ms = 300): T {
  const [kept, setKept] = useState(value);
  useEffect(() => {
    if (value === "" || value === kept) {
      setKept(value);
      return;
    }
    const timer = setTimeout(() => setKept(value), ms);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seule la saisie relance l'attente
  }, [value, ms]);
  return kept;
}
