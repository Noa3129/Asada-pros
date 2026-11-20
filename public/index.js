"use strict";

// ---- Elements ----
const startView = document.getElementById("start-view");
const browserView = document.getElementById("browser-view");
const form = document.getElementById("sj-form");
const address = document.getElementById("sj-address");
const searchEngine = document.getElementById("sj-search-engine");
const error = document.getElementById("sj-error");
const errorCode = document.getElementById("sj-error-code");
const tbForm = document.getElementById("tb-form");
const tbAddress = document.getElementById("tb-address");
const btnBack = document.getElementById("btn-back");
const btnForward = document.getElementById("btn-forward");
const btnReload = document.getElementById("btn-reload");
const btnHome = document.getElementById("btn-home");
const progress = document.getElementById("progress");

// ---- Scramjet setup (same as before) ----
const { ScramjetController } = $scramjetLoadController();

const scramjet = new ScramjetController({
	files: {
		wasm: "/scram/scramjet.wasm.wasm",
		all: "/scram/scramjet.all.js",
		sync: "/scram/scramjet.sync.js",
	},
});

scramjet.init();

const connection = new BareMux.BareMuxConnection("/baremux/worker.js");

// ---- Browser state ----
let frame = null; // ScramjetFrame, created lazily on first navigation
let transportReady = false;
let lastTransportAt = 0; // when the Wisp transport was last (re)created
let currentUrl = ""; // last known real (unproxified) URL, from frame events
let loadingTimer = null;

// The libcurl transport holds ONE Wisp WebSocket for everything, and it has
// no auto-reconnect: when the server sleeps (Render free tier, ~15 min idle)
// the socket dies and every later navigation fails with a proxy error page
// until the app is restarted. Recreating the transport rebuilds the socket,
// so we do that whenever the old one may have gone stale.
async function applyTransport() {
	// Split deployment: window.__WISP_URL__ in config.js can point at an
	// external Wisp backend. Empty = same host (all-in-one).
	const wispUrl =
		window.__WISP_URL__ ||
		(location.protocol === "https:" ? "wss" : "ws") +
			"://" +
			location.host +
			"/wisp/";
	await connection.setTransport("/libcurl/index.mjs", [
		{ websocket: wispUrl },
	]);
	transportReady = true;
	lastTransportAt = Date.now();
}

function transportStale() {
	return transportReady && Date.now() - lastTransportAt > 120000;
}

async function ensureTransport() {
	if (!transportReady || transportStale()) await applyTransport();
}

function setLoading(on) {
	if (on) {
		progress.className = "";
		// restart the CSS transition
		void progress.offsetWidth;
		progress.className = "loading";
		btnReload.classList.add("spinning");
		// Safety net: never leave the spinner stuck if a load event is missed.
		clearTimeout(loadingTimer);
		loadingTimer = setTimeout(() => setLoading(false), 20000);
	} else {
		clearTimeout(loadingTimer);
		progress.className = "done";
		btnReload.classList.remove("spinning");
		setTimeout(() => {
			if (progress.className === "done") progress.className = "";
		}, 700);
	}
}

function showBrowser() {
	startView.hidden = true;
	browserView.hidden = false;
}

function showStart() {
	browserView.hidden = true;
	startView.hidden = false;
}

function reflectUrl(url) {
	currentUrl = url;
	// Keep the address bar in sync unless the user is editing it.
	if (document.activeElement !== tbAddress) tbAddress.value = url;
	try {
		document.title = new URL(url).hostname || "Browser";
	} catch {
		document.title = "Browser";
	}
}

async function ensureFrame() {
	if (frame) return frame;

	await registerSW();
	await ensureTransport();

	frame = scramjet.createFrame();
	frame.frame.id = "sj-frame";
	frame.addEventListener("navigate", (e) => {
		setLoading(true);
		reflectUrl(e.url);
	});
	frame.addEventListener("urlchange", (e) => {
		reflectUrl(e.url);
	});
	frame.frame.addEventListener("load", () => setLoading(false));
	browserView.appendChild(frame.frame);
	return frame;
}

async function navigate(raw) {
	const value = (raw || "").trim();
	if (!value) return;
	const url = search(value, searchEngine.value);
	try {
		const f = await ensureFrame();
		await ensureTransport();
		showBrowser();
		setLoading(true);
		f.go(url);
	} catch (err) {
		showStart();
		error.textContent = "Failed to register service worker.";
		errorCode.textContent = err.toString();
		throw err;
	}
}

// ---- Start page ----
form.addEventListener("submit", (event) => {
	event.preventDefault();
	navigate(address.value);
});

document.querySelectorAll(".shortcut").forEach((el) => {
	el.addEventListener("click", () => navigate(el.dataset.url));
});

// ---- Toolbar ----
tbForm.addEventListener("submit", (event) => {
	event.preventDefault();
	navigate(tbAddress.value);
	tbAddress.blur();
});

tbAddress.addEventListener("focus", () => tbAddress.select());

btnBack.addEventListener("click", () => frame && frame.back());
btnForward.addEventListener("click", () => frame && frame.forward());
btnReload.addEventListener("click", async () => {
	if (!frame) return;
	setLoading(true);
	await ensureTransport();
	// ScramjetFrame.reload() is just contentWindow.location.reload(), which
	// re-requests whatever document the frame currently holds — if that
	// document is a proxy error page or a stalled load, reload just brings
	// the error back. Instead, re-navigate to the current real URL through
	// the normal encode path. location.replace() is used so the reload
	// does not add a duplicate history entry (Back keeps working as-is).
	try {
		if (currentUrl) {
			frame.frame.contentWindow.location.replace(
				scramjet.encodeUrl(currentUrl)
			);
		} else {
			frame.reload();
		}
	} catch {
		try {
			frame.go(currentUrl);
		} catch {
			frame.reload();
		}
	}
});
btnHome.addEventListener("click", showStart);

// Self-healing: rebuild the Wisp connection when the app comes back to the
// foreground after a while, or when the network returns. This covers the
// "server slept while the app was idle" case without an app restart.
let hiddenAt = null;
document.addEventListener("visibilitychange", () => {
	if (document.hidden) {
		hiddenAt = Date.now();
		return;
	}
	if (hiddenAt && Date.now() - hiddenAt > 60000) {
		hiddenAt = null;
		applyTransport().catch(() => {});
	}
});
window.addEventListener("online", () => {
	if (transportReady) applyTransport().catch(() => {});
});
