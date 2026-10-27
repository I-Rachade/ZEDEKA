import type { Metadata } from "next";
import LegalPage from "@/components/legal/LegalPage";
import Privacy from "@/components/legal/Privacy";

export const metadata: Metadata = { title: "Politique de confidentialité – Zedeka" };

export default function Page() {
  return (
    <LegalPage title="Politique de confidentialité">
      <Privacy />
    </LegalPage>
  );
}
