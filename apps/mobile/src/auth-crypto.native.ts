import { CryptoDigestAlgorithm, digest, getRandomValues } from "expo-crypto";

// Supabase PKCE needs secure randomness and SHA-256 on Hermes.
// CloudStore also uses SHA-1 to hash Git blobs.
if (!globalThis.crypto?.getRandomValues) {
  const native = globalThis.crypto ?? ({} as Crypto);
  Object.defineProperty(native, "getRandomValues", {
    value: getRandomValues,
    configurable: true,
  });
  if (!globalThis.crypto)
    Object.defineProperty(globalThis, "crypto", {
      value: native,
      configurable: true,
    });
}
if (!globalThis.crypto.subtle?.digest) {
  const subtle = globalThis.crypto.subtle ?? ({} as SubtleCrypto);
  Object.defineProperty(subtle, "digest", {
    configurable: true,
    value: (algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer> => {
      const name = typeof algorithm === "string" ? algorithm : algorithm.name;
      if (name.toUpperCase() === "SHA-1") return digest(CryptoDigestAlgorithm.SHA1, data);
      if (name.toUpperCase() === "SHA-256") return digest(CryptoDigestAlgorithm.SHA256, data);
      return Promise.reject(new Error("Unsupported native digest algorithm."));
    },
  });
  if (!globalThis.crypto.subtle)
    Object.defineProperty(globalThis.crypto, "subtle", {
      value: subtle,
      configurable: true,
    });
}
