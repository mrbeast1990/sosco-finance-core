// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    plugins: [
      VitePWA({
        registerType: "autoUpdate",
        injectRegister: null, // we register manually with iframe/preview guard
        devOptions: { enabled: false },
        includeAssets: ["icon-192.png", "icon-512.png"],
        manifest: {
          name: "نظام سوسكو المحاسبي",
          short_name: "سوسكو",
          description: "نظام محاسبي متكامل لإدارة المشاريع والممولين والمصروفات",
          lang: "ar",
          dir: "rtl",
          theme_color: "#0c2340",
          background_color: "#0c2340",
          display: "standalone",
          orientation: "portrait",
          start_url: "/dashboard",
          scope: "/",
          icons: [
            { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        workbox: {
          navigateFallback: "/dashboard",
          navigateFallbackDenylist: [/^\/api\//, /^\/~/],
          globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          runtimeCaching: [
            {
              urlPattern: ({ request }) => request.mode === "navigate",
              handler: "NetworkFirst",
              options: { cacheName: "html-pages", networkTimeoutSeconds: 3 },
            },
            {
              urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
              handler: "StaleWhileRevalidate",
              options: { cacheName: "google-fonts" },
            },
            {
              urlPattern: /^https:\/\/[a-z0-9-]+\.supabase\.co\/rest\/v1\/.*/i,
              handler: "NetworkFirst",
              method: "GET",
              options: {
                cacheName: "supabase-rest",
                networkTimeoutSeconds: 5,
                expiration: { maxEntries: 200, maxAgeSeconds: 24 * 60 * 60 },
              },
            },
          ],
        },
      }),
    ],
  },
});
