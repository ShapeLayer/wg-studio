// Meta CSP cannot express frame-ancestors, and GitHub Pages cannot send it as a
// header. Refuse to mount key-handling UI inside another site's frame.
if (window.top !== window.self) {
  document.documentElement.replaceChildren();
  throw new Error("wg-studio refuses to run inside a frame.");
}

import("./components/register.ts").then(
  // Mount light-DOM templates before controllers query their required elements.
  () => import("./app/controller.ts"),
);
