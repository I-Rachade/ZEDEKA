// Fichiers envoyés par les partenaires (logos, documents). En production : un espace R2 de Cloudflare.

export type StoredFile = { body: ArrayBuffer | Uint8Array; contentType: string };

export type FileStore = {
  put: (key: string, body: Uint8Array, contentType: string) => Promise<void>;
  get: (key: string) => Promise<StoredFile | null>;
  delete: (key: string) => Promise<void>;
};

// Sous-ensemble de R2Bucket utilisé ici, pour ne pas dépendre des types Cloudflare dans les tests.
type Bucket = {
  put: (key: string, value: Uint8Array, options: { httpMetadata: { contentType: string } }) => Promise<unknown>;
  get: (key: string) => Promise<{ arrayBuffer: () => Promise<ArrayBuffer>; httpMetadata?: { contentType?: string } } | null>;
  delete: (key: string) => Promise<void>;
};

export function r2Store(bucket: Bucket): FileStore {
  return {
    async put(key, body, contentType) {
      await bucket.put(key, body, { httpMetadata: { contentType } });
    },
    async get(key) {
      const object = await bucket.get(key);
      return object ? { body: await object.arrayBuffer(), contentType: object.httpMetadata?.contentType ?? "application/octet-stream" } : null;
    },
    async delete(key) {
      await bucket.delete(key);
    },
  };
}

// Pour les tests et le développement sans Cloudflare.
export function memoryStore(): FileStore & { files: Map<string, StoredFile> } {
  const files = new Map<string, StoredFile>();
  return {
    files,
    async put(key, body, contentType) {
      files.set(key, { body, contentType });
    },
    async get(key) {
      return files.get(key) ?? null;
    },
    async delete(key) {
      files.delete(key);
    },
  };
}
