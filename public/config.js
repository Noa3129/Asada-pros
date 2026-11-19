let _CONFIG = {};

// Split deployment only (frontend on a static host such as Cloudflare Pages,
// Wisp backend elsewhere): set the external Wisp endpoint, e.g.
//   window.__WISP_URL__ = "wss://proxy-backend.example.com/wisp/";
// Leave empty for the normal all-in-one Node server deployment.
window.__WISP_URL__ = "";
