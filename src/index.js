import { createServer } from "node:http";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "url";
import { hostname } from "node:os";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";

import { getIcon } from "./icons.js";
import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";

const publicPath = fileURLToPath(new URL("../public/", import.meta.url));

// ---------- Optional password gate (improvement over Tokyo Proxy V2: no auth) ----------
// Set ACCESS_PASSWORD to enable. Leave empty/unset for open access (not recommended
// when the instance is reachable from the internet).
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || "";
const authEnabled = ACCESS_PASSWORD.length > 0;
const authSecret = authEnabled
	? createHash("sha256").update(ACCESS_PASSWORD + "::tokyo-proxy-v3").digest()
	: null;
const authToken = authEnabled
	? createHmac("sha256", authSecret).update("authed").digest("hex")
	: null;

function parseCookies(req) {
	const out = {};
	const raw = (req.headers && req.headers.cookie) || "";
	for (const part of raw.split(";")) {
		const i = part.indexOf("=");
		if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
	}
	return out;
}

function isAuthed(req) {
	if (!authEnabled) return true;
	return parseCookies(req).tp_auth === authToken;
}

function passwordMatches(input) {
	if (typeof input !== "string") return false;
	const a = createHash("sha256").update(input).digest();
	const b = createHash("sha256").update(ACCESS_PASSWORD).digest();
	return timingSafeEqual(a, b);
}

// ---------- Wisp hardening ----------
// Upstream defaults already refuse private/loopback IPs; set them explicitly,
// forbid direct-IP connections so the hostname blacklist cannot be bypassed,
// and block internal names. This stops a public instance on a home server
// from being used as a pivot into the LAN (SSRF) - a risk Bare-based V2 had.
logging.set_level(logging.NONE);
Object.assign(wisp.options, {
	allow_udp_streams: false,
	allow_private_ips: false,
	allow_loopback_ips: false,
	allow_direct_ip: false,
	hostname_blacklist: [
		/^localhost$/i,
		/\.local$/i,
		/\.internal$/i,
		/\.home\.arpa$/i,
	],
	// Cap concurrent streams so one heavy page (or one abusive client)
	// cannot exhaust the small free instance (audit #7). Upstream default
	// is unlimited (-1).
	stream_limit_total: 256,
	stream_limit_per_host: 64,
	dns_servers: ["1.1.1.1", "1.0.0.1"],
});

const fastify = Fastify({
	serverFactory: (handler) => {
		return createServer()
			.on("request", (req, res) => {
				res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
				res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
				res.setHeader("X-Content-Type-Options", "nosniff");
				handler(req, res);
			})
			.on("upgrade", (req, socket, head) => {
				if (req.url.endsWith("/wisp/") && isAuthed(req))
					wisp.routeRequest(req, socket, head);
				else socket.end();
			});
	},
});

// Password gate: everything except the login page, the auth endpoint and
// the health check requires the auth cookie when ACCESS_PASSWORD is set.
fastify.addHook("onRequest", async (req, reply) => {
	const url = (req.url || "/").split("?")[0];
	if (url === "/healthz" || url === "/login" || url === "/auth") return;
	// PWA assets stay public so "Add to Home Screen" works smoothly.
	if (url === "/manifest.webmanifest" || url.startsWith("/icons/")) return;
	if (isAuthed(req.raw || req)) return;
	if (
		url.startsWith("/scram/") ||
		url.startsWith("/libcurl/") ||
		url.startsWith("/baremux/")
	) {
		return reply.code(401).send({ error: "auth required" });
	}
	return reply.redirect("/login");
});

fastify.get("/healthz", async () => ({ ok: true }));

// PWA icons are generated in code (see icons.js) so no binary files are stored.
for (const [path, size] of [
	["/icons/icon-192.png", 192],
	["/icons/icon-512.png", 512],
	["/icons/apple-touch-icon.png", 180],
]) {
	fastify.get(path, async (req, reply) => {
		return reply
			.type("image/png")
			.header("Cache-Control", "public, max-age=86400")
			.send(getIcon(size));
	});
}

fastify.post("/auth", async (req, reply) => {
	if (!authEnabled) return reply.code(400).send({ error: "auth not enabled" });
	const pw = req.body && typeof req.body === "object" ? req.body.password : "";
	if (!passwordMatches(pw)) return reply.code(401).send({ error: "wrong password" });
	const secure =
		req.headers["x-forwarded-proto"] === "https" || req.protocol === "https";
	// 90 days: when the cookie expires mid-session the Wisp upgrade is
	// rejected silently and every navigation fails until the app is
	// reopened and the user logs in again (audit #4).
	reply.header(
		"Set-Cookie",
		`tp_auth=${authToken}; HttpOnly; Path=/; SameSite=Lax; Max-Age=7776000${secure ? "; Secure" : ""}`
	);
	return { ok: true };
});

fastify.register(fastifyStatic, {
	root: publicPath,
	decorateReply: true,
});

fastify.register(fastifyStatic, {
	root: scramjetPath,
	prefix: "/scram/",
	decorateReply: false,
});

fastify.register(fastifyStatic, {
	root: libcurlPath,
	prefix: "/libcurl/",
	decorateReply: false,
});

fastify.register(fastifyStatic, {
	root: baremuxPath,
	prefix: "/baremux/",
	decorateReply: false,
});

fastify.get("/manifest.webmanifest", async (req, reply) => {
	return reply.type("application/manifest+json").sendFile("manifest.webmanifest");
});

// /login serves the login page file from public/
fastify.get("/login", async (req, reply) => {
	if (!authEnabled) return reply.redirect("/");
	if (isAuthed(req.raw || req)) return reply.redirect("/");
	return reply.sendFile("login.html");
});

fastify.setNotFoundHandler((res, reply) => {
	return reply.code(404).type("text/html").sendFile("404.html");
});

fastify.server.on("listening", () => {
	const address = fastify.server.address();
	console.log("Listening on:");
	console.log(`\thttp://localhost:${address.port}`);
	console.log(`\thttp://${hostname()}:${address.port}`);
	console.log(
		`\thttp://${address.family === "IPv6" ? `[${address.address}]` : address.address}:${address.port}`
	);
	console.log(`\tPassword gate: ${authEnabled ? "ON" : "OFF (open instance)"}`);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
	console.log("SIGTERM signal received: closing HTTP server");
	fastify.close();
	process.exit(0);
}

let port = parseInt(process.env.PORT || "");

if (isNaN(port)) port = 8080;

fastify.listen({
	port: port,
	host: "0.0.0.0",
});
