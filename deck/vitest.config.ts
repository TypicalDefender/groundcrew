import path from "node:path";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: { "@": path.join(root, "src") },
  },
  test: {
    globals: true,
    include: ["src/**/*.test.ts"],
  },
});
