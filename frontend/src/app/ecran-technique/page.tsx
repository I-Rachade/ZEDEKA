import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import TechScreenApp from "./TechScreenApp";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: `${t("Écran technique")} – Zedeka`, robots: { index: false, follow: false } };
}

export default function TechScreenPage() {
  return <TechScreenApp />;
}
