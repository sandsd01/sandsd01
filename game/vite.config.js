import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5174,
  },
  build: {
    // main.ts awaits the model files at the top level so the world is built
    // with its real meshes rather than swapping them in mid-scene. Vite's
    // default target (es2020) predates top-level await; es2022 matches what
    // tsconfig already compiles to, and every browser that can run WebGL2 for
    // this scene supports it.
    target: "es2022",
  },
});
