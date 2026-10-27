import { legalProse } from "@/components/legal/LegalPage";
import { TopBar } from "./ui";

// Mise en page des pages d'information (aide, conditions, confidentialité, annulation, mentions légales).
export default function InfoPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <TopBar title={title} back="/app/profil" />
      <article className={`${legalProse} px-4 py-4`}>
        {children}
      </article>
    </div>
  );
}
