import { defineConfig } from "vite";
import type { Plugin } from "vite";

/**
 * GitHub Pages ignores public/_headers, so production builds also embed the
 * policy as a meta tag. frame-ancestors is not honored in meta CSP; framing is
 * refused at runtime in src/main.ts instead.
 */
export const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'none'",
  "img-src 'self' data:",
  "font-src 'none'",
  "object-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");

function securityMeta(): Plugin {
  return {
    name: "wg-studio-security-meta",
    apply: "build",
    transformIndexHtml: () => [
      {
        tag: "meta",
        attrs: {
          "http-equiv": "Content-Security-Policy",
          content: contentSecurityPolicy,
        },
        injectTo: "head-prepend",
      },
      {
        tag: "meta",
        attrs: { name: "referrer", content: "no-referrer" },
        injectTo: "head-prepend",
      },
    ],
  };
}

export default defineConfig(({ command, isPreview }) => ({
  base: command === "serve" && !isPreview ? "/" : "/wg-studio/",
  plugins: [securityMeta()],
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
  // The modulepreload polyfill uses fetch(), which connect-src 'none' forbids.
  build: { target: "es2022", modulePreload: { polyfill: false } },
}));
