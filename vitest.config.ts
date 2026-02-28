import { defineConfig } from "vitest/config";
import tsconfig from "./tsconfig.json" with { type: "json" };

export default defineConfig({
  test: {
    globals: true,
  },
  resolve: {
    extensions: [".ts"],
  },
  esbuild: {
    target: (tsconfig as { compilerOptions?: { target?: string } }).compilerOptions?.target ?? "es2022",
  },
});
