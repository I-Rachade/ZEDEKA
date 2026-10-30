// Envoi d'e-mails (codes pour le PIN oublié) avec Cloudflare Email Service : liaison « send_email » du Worker,
// sans clé d'API. Sans adresse d'expédition EMAIL_FROM, aucun e-mail n'est envoyé : le PIN oublié reste possible par SMS.
export interface EmailSender {
  send(to: string, subject: string, text: string): Promise<void>;
}

// Partie de la liaison utilisée ici (voir https://developers.cloudflare.com/email-service/api/send-emails/workers-api/).
export type SendEmailBinding = {
  send(message: { from: string | { email: string; name: string }; to: string; subject: string; text: string }): Promise<{ messageId: string }>;
};

/** `from` : « Zedeka <noreply@zedeka.poinderecharge.com> » ou simplement « noreply@zedeka.poinderecharge.com ». */
export function cloudflareSender(binding: SendEmailBinding, from: string): EmailSender {
  const named = /^(.*?)\s*<([^>]+)>$/.exec(from.trim());
  const sender = named ? { name: named[1].trim(), email: named[2].trim() } : from.trim();
  return {
    async send(to, subject, text) {
      await binding.send({ from: sender, to, subject, text });
    },
  };
}
