"use client";

import { useState } from "react";
import s from "./decouvrir.module.css";

// Onglets des tarifs (clients, restaurants, boutiques, livreurs). Les quatre panneaux sont dans la page, un seul est affiché.
export function Tarifs({ panneaux }: { panneaux: { id: string; label: string; contenu: React.ReactNode }[] }) {
  const [actif, setActif] = useState(panneaux[0]?.id);
  return (
    <>
      <div className={s.tabs} role="tablist" aria-label="Tarifs par profil">
        {panneaux.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            id={`t-${p.id}`}
            aria-selected={p.id === actif}
            aria-controls={`p-${p.id}`}
            className={s.tab}
            onClick={() => setActif(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
      {panneaux.map((p) => (
        <div key={p.id} id={`p-${p.id}`} role="tabpanel" aria-labelledby={`t-${p.id}`} hidden={p.id !== actif}>
          {p.contenu}
        </div>
      ))}
    </>
  );
}

// Copie le numéro WhatsApp ; sans presse-papiers, le numéro reste sélectionnable à côté.
export function CopierNumero({ numero }: { numero: string }) {
  const [copie, setCopie] = useState(false);
  return (
    <button
      type="button"
      className={s.btnLigne}
      style={{ color: "#fff" }}
      onClick={() =>
        navigator.clipboard
          ?.writeText(numero)
          .then(() => {
            setCopie(true);
            setTimeout(() => setCopie(false), 2000);
          })
          .catch(() => {})
      }
    >
      {copie ? "Numéro copié" : "Copier le numéro"}
    </button>
  );
}
