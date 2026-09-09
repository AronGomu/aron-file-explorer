import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  test: {
    reporters: ["default", "json"],
    outputFile: {
      json: "artifacts/theme-validation/unit/results.json",
    },
    projects: [
      {
        plugins: [react()],
        test: {
          name: "themes",
          environment: "jsdom",
          include: ["tests/themes/**/*.test.{js,jsx}"],
          restoreMocks: true,
        },
      },
    ],
  },
});
