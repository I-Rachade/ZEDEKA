import type { Metadata } from "next";
import LegalPage from "@/components/legal/LegalPage";
import Terms from "@/components/legal/Terms";

export const metadata: Metadata = { title: "Conditions générales d'utilisation et de vente – Zedeka" };

export default function Page() {
  return (
    <LegalPage title="Conditions générales d'utilisation et de vente">
      <Terms />
    </LegalPage>
  );
}
