// Envoi d'e-mails (codes pour le PIN oublié) avec Resend (https://resend.com/docs/api-reference/emails/send-email).
// Sans clé RESEND_API_KEY, aucun e-mail n'est envoyé : le PIN oublié reste possible par SMS.
export interface EmailSender {
  send(to: string, subject: string, text: string): Promise<void>;
}

export function resendSender(
  apiKey: string,
  from: string,
  // Appelé à travers une fonction : le fetch du runtime ne doit pas être détaché de son contexte.
  fetcher: typeof fetch = (input, init) => fetch(input, init),
): EmailSender {
  return {
    async send(to, subject, text) {
      const res = await fetcher("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [to], subject, text }),
      });
      if (!res.ok) throw new Error(`resend ${res.status} ${await res.text().catch(() => "")}`);
    },
  };
}
