import type { Metadata } from "next";
import Terms from "@/components/legal/Terms";
import InfoPage from "../InfoPage";

export const metadata: Metadata = { title: "Conditions générales – Zedeka" };

export default function TermsPage() {
  return (
    <InfoPage title="Conditions générales">
      <Terms />
    </InfoPage>
  );
}
