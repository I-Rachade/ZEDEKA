// Mise en page des textes légaux sur le site public (les mêmes textes s'affichent dans l'application client).
export const legalProse =
  "space-y-4 text-[15px] leading-relaxed text-stone-800 [&_a]:text-emerald-700 [&_a]:underline [&_h2]:mt-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-stone-900 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5";

export default function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className={`${legalProse} rounded-xl bg-white p-5 shadow-sm`}>
      <h1 className="text-2xl font-bold text-stone-900">{title}</h1>
      {children}
    </article>
  );
}
