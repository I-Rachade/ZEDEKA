// Cache en mémoire des lectures publiques les plus fréquentes (accueil, carte d'un restaurant), l'équivalent de
// Redis sur Workers : une instance de l'API relit la base au plus une fois par période, quel que soit le trafic.
// - Durée courte (20 s en production, 0 dans les tests) : une autre instance voit un changement au plus 20 s après.
// - Toute écriture de l'admin ou d'un restaurant vide le cache de l'instance qui la reçoit, aussitôt.
// - Une lecture déjà en cours est partagée : dix téléphones qui ouvrent l'accueil ensemble font une seule lecture.

type Entry = { at: number; gen: number; value: Promise<unknown> };

let generation = 0;
const stores = new WeakMap<object, Map<string, Entry>>();

export type CatalogCache = <T>(key: string, load: () => Promise<T>) => Promise<T>;

export function invalidateCatalog() {
  generation += 1;
}

export function catalogCache(owner: object, ttlMs: number, clock: () => number = Date.now): CatalogCache {
  return <T>(key: string, load: () => Promise<T>): Promise<T> => {
    if (ttlMs <= 0) return load();
    let store = stores.get(owner);
    if (!store) stores.set(owner, (store = new Map()));
    const now = clock();
    const hit = store.get(key);
    if (hit && hit.gen === generation && now - hit.at < ttlMs) return hit.value as Promise<T>;
    const value = load();
    const entry: Entry = { at: now, gen: generation, value };
    store.set(key, entry);
    // Échec (base indisponible) : rien n'est gardé, la prochaine visite relira la base.
    value.catch(() => store.get(key) === entry && store.delete(key));
    if (store.size > 500) store.delete(store.keys().next().value as string);
    return value;
  };
}
