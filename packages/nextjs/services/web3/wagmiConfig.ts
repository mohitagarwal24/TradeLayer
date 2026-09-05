// Upstream SE-2 keeps the app-wide wagmi config here; this project builds it
// in src/lib/wagmi.ts, so we simply re-export to satisfy hook imports.
export { config as wagmiConfig } from "@/lib/wagmi";
