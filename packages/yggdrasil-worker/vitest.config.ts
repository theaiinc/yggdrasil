import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    globals: true,
    pool: "@cloudflare/vitest-pool-workers",
    poolOptions: {
      workers: {
        main: "src/index.ts",
        isolatedStorage: false,
        wrangler: {
          configPath: "wrangler.test.jsonc",
        },
      },
    },
  },
});