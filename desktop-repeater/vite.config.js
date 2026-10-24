import { defineConfig } from "vite";

export default defineConfig({
  // Electron opens the built HTML through file://, so root-relative /assets
  // paths resolve to the wrong location. Relative paths work in the installer.
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});