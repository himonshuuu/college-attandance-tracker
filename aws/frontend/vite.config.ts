import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The production UI remains the existing React application in the repository
// root. This wrapper avoids duplicating or replacing the established views.
const frontendDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(frontendDirectory, "../..");

export default defineConfig({
  root: projectRoot,
  plugins: [react()],
  publicDir: path.join(projectRoot, "public"),
  build: {
    outDir: path.join(frontendDirectory, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name].[ext]",
      },
    },
  },
});
