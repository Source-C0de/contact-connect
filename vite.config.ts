import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Read the repo-root `.env` so the dev-server port can be configured in
  // one place alongside the API port.
  const env = loadEnv(mode, path.resolve(__dirname), "VITE_");

  // The web port is configurable because 5173 is often taken by another dev
  // server on the same machine. Keep it in sync with what your co-workers
  // use to reach the app (http://<lan-ip>:<port>).
  const webPort = Number(env.VITE_DEV_PORT || 5173);

  return {
    server: {
      host: "::",
      port: webPort,
      // Fail loudly if the port is taken instead of silently hopping to the
      // next free one. A silent hop breaks the "share http://<lan-ip>:5173"
      // instructions and is very easy to miss.
      strictPort: true,
      hmr: {
        overlay: false,
      },
    },
    plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "@tanstack/react-query", "@tanstack/query-core"],
    },
  };
});
