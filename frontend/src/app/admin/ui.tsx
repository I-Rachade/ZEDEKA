export { button, buttonDanger, buttonGhost, Card, Empty, ErrorNote, input, Loading, PageHeader, StatTile, StickyActions, Tabs } from "@/components/panel/ui";
export { StatusPill as StatusBadge } from "@/components/panel/status";
import { roleOf, useStaff } from "@/lib/admin";
import { useT } from "@/lib/i18n/client";

// Page que seul le directeur modifie (équipe, réglages, zones, finances) : l'administrateur adjoint la voit,
// mais champs et boutons sont désactivés.
export function DirectorEdits({ children }: { children: React.ReactNode }) {
  const readOnly = roleOf(useStaff()) === "DEPUTY";
  const t = useT();
  return (
    <fieldset disabled={readOnly} className="min-w-0 space-y-4">
      {readOnly && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t("Lecture seule : seul le directeur modifie cette page.")}</p>}
      {children}
    </fieldset>
  );
}
