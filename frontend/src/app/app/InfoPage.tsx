import { TopBar } from "./ui";

// Mise en page des pages d'information (aide, conditions, confidentialité, annulation).
export default function InfoPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <TopBar title={title} back="/app/profil" />
      <article className="space-y-4 px-4 py-4 text-[15px] leading-relaxed text-stone-800 [&_h2]:mt-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-stone-900 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
        {children}
      </article>
    </div>
  );
}
