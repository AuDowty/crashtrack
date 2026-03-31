import { defineConfig } from "vitest/config";

export default defineConfig({
  // Disable postcss entirely — vitest walks up looking for postcss config and
  // finds a stray one in $HOME, which then errors on missing tailwindcss.
  css: { postcss: { plugins: [] } },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
