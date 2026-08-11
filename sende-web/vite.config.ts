import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Local dev proxy to the backend so the browser never needs CORS
      // wildcards; production should serve the API from its own subdomain
      // behind the same auth/session cookie policy.
      "/api": "http://localhost:3000",
    },
  },
});
