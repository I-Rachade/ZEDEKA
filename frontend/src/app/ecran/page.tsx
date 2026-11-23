import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import ScreenApp from "./ScreenApp";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: `${t("Écran du bureau")} – Zedeka`, robots: { index: false, follow: false } };
}

export default function ScreenPage() {
  return <ScreenApp />;
}
