import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    include: process.env["PROOFWORK_TESTNET"] ? ["tests/testnet/**/*.test.ts"] : ["tests/unit/**/*.test.ts"],
    environment: "node",
    // Several PGlite instances in parallel workers starve each other and the run never ends; one file at a time takes ~2.5 min.
    fileParallelism: false,
    testTimeout: process.env["PROOFWORK_TESTNET"] ? 120_000 : 10_000,
  },
});
