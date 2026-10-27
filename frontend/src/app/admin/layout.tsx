import type { Metadata } from "next";
import AdminNav from "./AdminNav";

export const metadata: Metadata = { title: "Admin – Zedeka", robots: { index: false } };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <AdminNav />
      {children}
    </div>
  );
}
