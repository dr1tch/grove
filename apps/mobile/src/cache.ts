// TypeScript and non-native tooling use the browser implementation.
// Metro selects cache.native.ts on Android and iOS.
export { openVaultCache } from "./cache.web";
