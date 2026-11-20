importScripts("/scram/scramjet.all.js");

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();

function escapeHtml(s) {
	return String(s).replace(
		/[&<>"']/g,
		(c) =>
			({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
				"'": "&#39;",
			})[c]
	);
}

function errorResponse(err) {
	const body = `<!doctype html><html><head><meta charset="utf-8"><title>Proxy error</title></head><body style="font-family:sans-serif;background:#111;color:#eee;padding:2em"><h1>Uh oh!</h1><p>The proxy could not load its configuration (browser storage may be unavailable or was cleared).</p><p>Reloading the app usually fixes this.</p><pre style="white-space:pre-wrap;color:#f66">${escapeHtml(err && err.message ? err.message : err)}</pre></body></html>`;
	return new Response(body, {
		status: 502,
		headers: { "Content-Type": "text/html; charset=utf-8" },
	});
}

async function handleRequest(event) {
	// loadConfig() reads the engine config from IndexedDB on every fetch.
	// If that throws (storage evicted/unavailable), a rejected respondWith
	// leaves the page blank with no explanation, so retry once and then
	// degrade gracefully instead (audit #2).
	try {
		await scramjet.loadConfig();
	} catch {
		try {
			await scramjet.loadConfig();
		} catch {
			// Without config we cannot route proxied URLs; fall back to a
			// plain fetch so shell assets still load and proxied URLs get
			// the server's readable 404 page rather than a silent hang.
			return fetch(event.request);
		}
	}
	if (scramjet.route(event)) {
		try {
			return await scramjet.fetch(event);
		} catch (err) {
			return errorResponse(err);
		}
	}
	return fetch(event.request);
}

self.addEventListener("fetch", (event) => {
	event.respondWith(handleRequest(event));
});
