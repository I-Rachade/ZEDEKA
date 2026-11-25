"use client";

import { useState } from "react";
import { AccountPage } from "@/components/panel/PartnerAccount";
import { button, Card, ErrorNote, input, Loading } from "@/components/panel/ui";
import { restaurantClient } from "@/lib/partnerClients";
import { restaurantFetch, type Me } from "@/lib/restaurant";
import { useT } from "@/lib/i18n/client";
import { useRestaurant } from "../useRestaurant";

export default function RestaurantAccountPage() {
  const { data, error } = useRestaurant<Me>("/me");
  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;
  const owner = data.account.role === "OWNER";
  return (
    <>
      <AccountPage api={restaurantClient} name={owner ? data.name : `${data.account.name} · ${data.name}`} email={data.account.email} phone={data.phone} what="nouvelle commande" />
      {owner && <PinCard phone={data.phone} hasPin={!!data.hasPin} />}
    </>
  );
}

// Code PIN du gérant : pour entrer avec le numéro du commerce, sans taper l'e-mail et le mot de passe.
function PinCard({ phone, hasPin }: { phone: string; hasPin: boolean }) {
  const [set, setSet] = useState(hasPin);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const t = useT();
  return (
    <div className="mt-4">
      <Card title="Code PIN" icon="lock">
        <p className="mb-3 text-sm text-stone-600">
          {set ? t("Vous pouvez vous connecter avec le numéro {phone} et votre code PIN.", { phone }) : t("Choisissez un code PIN pour vous connecter avec le numéro {phone}.", { phone })}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const el = e.currentTarget;
            const f = new FormData(el);
            setBusy(true);
            setError(null);
            setDone(false);
            try {
              await restaurantFetch("/pin", { method: "PUT", body: { pin: String(f.get("pin") ?? ""), current: String(f.get("current") ?? "") } });
              setSet(true);
              setDone(true);
              el.reset();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          className="grid gap-2 sm:grid-cols-2"
        >
          <input name="pin" type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} required placeholder={t("Nouveau code PIN (4 chiffres)")} autoComplete="new-password" className={input} />
          <input name="current" type="password" required placeholder={set ? t("Mot de passe ou ancien PIN") : t("Mot de passe actuel")} autoComplete="current-password" className={input} />
          <div className="sm:col-span-2">
            <ErrorNote message={error} />
          </div>
          <button disabled={busy} className={`${button} sm:col-span-2`}>
            {set ? t("Changer le code PIN") : t("Créer le code PIN")}
          </button>
        </form>
        {done && <p className="mt-2 text-sm text-emerald-700">{t("Code PIN enregistré. Ne le donnez à personne.")}</p>}
      </Card>
    </div>
  );
}
