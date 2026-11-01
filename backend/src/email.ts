// Envoi d'e-mails (codes pour le PIN oublié) avec Cloudflare Email Service : liaison « send_email » du Worker,
// sans clé d'API. Sans adresse d'expédition EMAIL_FROM, aucun e-mail n'est envoyé : le PIN oublié reste possible par SMS.
export interface EmailSender {
  send(to: string, subject: string, text: string): Promise<void>;
}

// Partie de la liaison utilisée ici (voir https://developers.cloudflare.com/email-service/api/send-emails/workers-api/).
export type SendEmailBinding = {
  send(message: { from: string | { email: string; name: string }; to: string; subject: string; text: string }): Promise<{ messageId: string }>;
};

// Pied de chaque e-mail : Zedeka n'envoie que des e-mails de service (codes), jamais de publicité ; il dit
// comment ne plus en recevoir (retirer l'adresse du compte) et où demander la suppression des données.
export function emailFooter(siteOrigin: string): string {
  const site = siteOrigin.replace(/\/+$/, "");
  return [
    "",
    "--",
    "Zedeka – e-mail de service envoyé à votre demande. Nous n'envoyons pas de publicité par e-mail.",
    `Ne plus recevoir d'e-mails : retirez votre adresse e-mail de votre profil dans l'application, ou demandez la suppression de vos données : ${site}/suppression-donnees`,
  ].join("\n");
}

/** `from` : « Zedeka <noreply@zedeka.poinderecharge.com> » ou simplement « noreply@zedeka.poinderecharge.com ». */
export function cloudflareSender(binding: SendEmailBinding, from: string, siteOrigin = "https://zedeka.poinderecharge.com"): EmailSender {
  const named = /^(.*?)\s*<([^>]+)>$/.exec(from.trim());
  const sender = named ? { name: named[1].trim(), email: named[2].trim() } : from.trim();
  return {
    async send(to, subject, text) {
      await binding.send({ from: sender, to, subject, text: `${text}\n${emailFooter(siteOrigin)}` });
    },
  };
}
