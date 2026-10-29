import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import AdminShell from "./AdminShell";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: `${t("Admin")} – Zedeka`, robots: { index: false } };
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
