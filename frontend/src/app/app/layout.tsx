import type { Metadata } from "next";
import AppShell from "./AppShell";

export const metadata: Metadata = { title: "Zedeka" };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
