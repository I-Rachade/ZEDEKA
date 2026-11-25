// Coupure passagère de la base D1 (« Network connection lost », objet de stockage réinitialisé…) : on réessaie une
// fois après un court délai. Réservé aux tâches sans effet visible en double (pas d'envoi de notification).

const TRANSIENT = /network connection lost|connection (was )?(reset|closed)|storage caused object to be reset|internal error.*(retry|transient)|D1_ERROR.*timed? ?out/i;

export function isTransientDbError(e: unknown): boolean {
  const text = e instanceof Error ? `${e.name}: ${e.message} ${String((e as { cause?: unknown }).cause ?? "")}` : String(e);
  return TRANSIENT.test(text);
}

export async function retryTransient<T>(fn: () => Promise<T>, delayMs = 1000): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!isTransientDbError(e)) throw e;
    await new Promise((r) => setTimeout(r, delayMs));
    return fn();
  }
}
