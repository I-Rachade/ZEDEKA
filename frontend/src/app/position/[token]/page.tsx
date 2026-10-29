import type { Metadata } from "next";
import PositionShare from "./PositionShare";

// Page ouverte par le destinataire d'un colis depuis le lien reçu : pas indexée, pas de données personnelles.
export const metadata: Metadata = { title: "Partager ma position – Zedeka", robots: { index: false, follow: false } };

export default async function PositionPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PositionShare token={token} />;
}
