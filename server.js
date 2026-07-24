"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { loadConfig } = require("./lib/config");
const { createStore } = require("./lib/store");
const {
  ageHoursFromPublishedAt,
  canonicalYoutubeWatchUrl,
  createYoutubeClient,
  decodeHtmlEntities,
  extractYoutubeVideoId,
  youtubeThumbnailUrl,
} = require("./lib/youtube");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
const publicFiles = new Set([
  "/index.html",
  "/app.js",
  "/api-client.js",
  "/runtime-config.js",
  "/styles.css",
]);

function normalizeYoutubeVideoIds(rawIds) {
  const ids = Array.isArray(rawIds) ? rawIds : String(rawIds || "").split(",");
  return Array.from(new Set(ids
    .map((id) => String(id).trim())
    .filter((id) => /^[A-Za-z0-9_-]{11}$/.test(id))))
    .slice(0, 50);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function parseCookies(header) {
  return String(header || "").split(";").reduce((cookies, part) => {
    const index = part.indexOf("=");
    if (index === -1) return cookies;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function jsonBody(request, maximumBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maximumBytes) {
        const error = new Error("요청 본문이 너무 큽니다.");
        error.statusCode = 413;
        reject(error);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        const error = new Error("올바른 JSON 요청이 아닙니다.");
        error.statusCode = 400;
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function applyCors(request, response, config) {
  const origin = request.headers.origin;
  if (!origin || config.allowedOrigins.length === 0) return true;
  if (!config.allowedOrigins.includes(origin)) return false;
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Credentials", "true");
  response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  return true;
}

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  response.end(JSON.stringify(payload));
}

function sendError(response, error) {
  const statusCode = Number(error.statusCode) || 500;
  if (statusCode >= 500) {
    console.error("[server]", error.stack || error.message);
  }
  sendJson(response, statusCode, {
    error: statusCode >= 500 ? "서버에서 요청을 처리하지 못했습니다." : error.message,
    code: error.code || null,
  });
}

function sessionCookie(config, token) {
  const parts = [
    `${config.cookieName}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${config.cookieSameSite}`,
    `Max-Age=${config.sessionDays * 86400}`,
  ];
  if (config.cookieSecure) parts.push("Secure");
  return parts.join("; ");
}

function mapResolvedVideo(video) {
  return {
    videoId: video.youtubeId,
    sourceId: `yt:${video.youtubeId}`,
    url: video.url,
    title: video.title,
    handle: video.channelTitle,
    platform: "YOUTUBE SHORTS",
    thumbnailUrl: video.thumbnailUrl,
    publishedAt: video.publishedAt,
    ageHours: video.publishedAt
      ? Math.max(1, Math.round(ageHoursFromPublishedAt(video.publishedAt)))
      : null,
    initialViews: video.views,
    syncedAt: video.snapshotAt || null,
    metadataMode: video.metadataMode,
    statsMode: video.statsMode,
  };
}

function createApplication(options = {}) {
  const config = options.config || loadConfig();
  const store = options.store || createStore(config);
  const youtube = options.youtube || createYoutubeClient({
    apiKey: config.youtubeApiKey,
    appVersion: config.appVersion,
  });

  function currentPlayer(request) {
    const cookies = parseCookies(request.headers.cookie);
    const authorization = String(request.headers.authorization || "");
    const bearerToken = authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : "";
    const token = bearerToken || cookies[config.cookieName];
    return token ? store.getPlayerBySession(hashToken(token)) : null;
  }

  function requirePlayer(request) {
    const player = currentPlayer(request);
    if (!player) {
      const error = new Error("익명 세션이 필요합니다.");
      error.statusCode = 401;
      throw error;
    }
    return player;
  }

  async function resolveAndStore(rawUrl, lane = "direct") {
    const resolved = await youtube.resolveVideo(rawUrl);
    return store.upsertVideo(resolved, { lane, candidate: true });
  }

  async function syncYoutubeIds(videoIds, { autoHarvest = true } = {}) {
    const ids = normalizeYoutubeVideoIds(videoIds);
    if (!youtube.apiKeyConfigured || ids.length === 0) return [];
    const items = await youtube.batchGetStats(ids);
    items.forEach((item) => store.addSnapshotByYoutubeId(item.youtubeId, item));
    if (autoHarvest) store.autoHarvestDue();
    return items;
  }

  async function handleApi(request, response, requestUrl) {
    if (request.method === "POST" && requestUrl.pathname === "/api/session/anonymous") {
      store.deleteExpiredSessions();
      const existing = currentPlayer(request);
      if (existing) {
        sendJson(response, 200, { player: existing, reused: true });
        return;
      }
      const token = crypto.randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + config.sessionDays * 86400_000).toISOString();
      const player = store.createAnonymousSession({ tokenHash: hashToken(token), expiresAt });
      sendJson(response, 201, { player, reused: false, token }, {
        "Set-Cookie": sessionCookie(config, token),
      });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/bootstrap") {
      const player = requirePlayer(request);
      store.autoHarvestDue();
      sendJson(response, 200, store.getBootstrap(player.id));
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/feed") {
      const player = requirePlayer(request);
      const sort = requestUrl.searchParams.get("sort") || "signal";
      const limit = Number(requestUrl.searchParams.get("limit") || 30);
      const feed = store.listFeed(player.id, { sort, limit });
      sendJson(response, 200, {
        ...feed,
        serverTime: new Date().toISOString(),
      });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/videos/resolve") {
      requirePlayer(request);
      const body = await jsonBody(request);
      const video = await resolveAndStore(body.url);
      sendJson(response, 200, mapResolvedVideo(video));
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/youtube") {
      requirePlayer(request);
      const video = await resolveAndStore(requestUrl.searchParams.get("url") || "");
      sendJson(response, 200, mapResolvedVideo(video));
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/youtube/stats") {
      requirePlayer(request);
      const items = await syncYoutubeIds(requestUrl.searchParams.get("ids"));
      sendJson(response, 200, {
        apiKeyConfigured: youtube.apiKeyConfigured,
        items: items.map((item) => ({
          videoId: item.youtubeId,
          views: item.views,
        })),
        syncedAt: items[0]?.capturedAt || new Date().toISOString(),
      });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/youtube/sync") {
      const player = requirePlayer(request);
      const bootstrap = store.getBootstrap(player.id);
      await syncYoutubeIds(bootstrap.positions.map((position) => position.videoId));
      sendJson(response, 200, store.getBootstrap(player.id));
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/positions") {
      const player = requirePlayer(request);
      const body = await jsonBody(request);
      let youtubeId = body.videoId || extractYoutubeVideoId(body.url);
      if (!youtubeId || !store.findVideoByYoutubeId(youtubeId)) {
        const video = await resolveAndStore(body.url);
        youtubeId = video.youtubeId;
      }
      await syncYoutubeIds([youtubeId]);
      store.plantPosition(player.id, youtubeId, {
        replacePositionId: body.replacePositionId || null,
      });
      sendJson(response, 201, store.getBootstrap(player.id));
      return;
    }

    const harvestMatch = requestUrl.pathname.match(/^\/api\/positions\/([^/]+)\/harvest$/);
    if (request.method === "POST" && harvestMatch) {
      const player = requirePlayer(request);
      const positionId = decodeURIComponent(harvestMatch[1]);
      const position = store.getBootstrap(player.id).positions
        .find((item) => item.id === positionId);
      if (position) await syncYoutubeIds([position.videoId], { autoHarvest: false });
      store.harvestPosition(player.id, positionId);
      sendJson(response, 200, store.getBootstrap(player.id));
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/positions/harvest-all") {
      const player = requirePlayer(request);
      const positions = store.getBootstrap(player.id).positions;
      await syncYoutubeIds(
        positions.map((position) => position.videoId),
        { autoHarvest: false },
      );
      store.harvestAll(player.id);
      sendJson(response, 200, store.getBootstrap(player.id));
      return;
    }

    const watchMatch = requestUrl.pathname.match(/^\/api\/watches\/([A-Za-z0-9_-]{11})$/);
    if (watchMatch && request.method === "PUT") {
      const player = requirePlayer(request);
      const body = await jsonBody(request);
      store.setWatch(player.id, watchMatch[1], body.alertMode);
      sendJson(response, 200, store.getBootstrap(player.id));
      return;
    }
    if (watchMatch && request.method === "DELETE") {
      const player = requirePlayer(request);
      store.removeWatch(player.id, watchMatch[1]);
      sendJson(response, 200, store.getBootstrap(player.id));
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/system/status") {
      sendJson(response, 200, {
        version: config.appVersion,
        apiKeyConfigured: youtube.apiKeyConfigured,
        storage: "sqlite",
        ...store.systemStatus(),
      });
      return;
    }

    const error = new Error("API 경로를 찾지 못했습니다.");
    error.statusCode = 404;
    throw error;
  }

  function serveRuntimeConfig(response) {
    const content = `globalThis.__VIRAL_FIELD_CONFIG__ = ${JSON.stringify({
      apiBaseUrl: config.publicApiBaseUrl,
      appVersion: config.appVersion,
    })};\n`;
    response.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(content);
  }

  function serveStaticFile(requestUrl, response) {
    const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
    if (!publicFiles.has(pathname)) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    const decoded = decodeURIComponent(pathname);
    const filePath = path.resolve(config.publicDir, `.${decoded}`);
    const relative = path.relative(config.publicDir, filePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Forbidden");
      return;
    }
    fs.readFile(filePath, (error, data) => {
      if (error) {
        response.writeHead(error.code === "ENOENT" ? 404 : 500, {
          "Content-Type": "text/plain; charset=utf-8",
        });
        response.end(error.code === "ENOENT" ? "Not found" : "Server error");
        return;
      }
      response.writeHead(200, {
        "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      response.end(data);
    });
  }

  async function handler(request, response) {
    if (!applyCors(request, response, config)) {
      sendJson(response, 403, { error: "허용되지 않은 Origin입니다." });
      return;
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (requestUrl.pathname === "/health/live") {
      sendJson(response, 200, { status: "ok", version: config.appVersion });
      return;
    }
    if (requestUrl.pathname === "/health/ready") {
      sendJson(response, 200, { status: "ready", database: true });
      return;
    }
    if (requestUrl.pathname === "/runtime-config.js") {
      serveRuntimeConfig(response);
      return;
    }

    try {
      if (requestUrl.pathname.startsWith("/api/")) {
        await handleApi(request, response, requestUrl);
        return;
      }
      serveStaticFile(requestUrl, response);
    } catch (error) {
      sendError(response, error);
    }
  }

  return {
    config,
    handler,
    store,
    youtube,
  };
}

function createServer(options = {}) {
  const application = createApplication(options);
  const server = http.createServer(application.handler);
  server.on("close", () => {
    if (!options.store) application.store.close();
  });
  return server;
}

async function fetchYoutubeStatistics(rawIds) {
  const client = createYoutubeClient({
    apiKey: process.env.YOUTUBE_API_KEY?.trim() || "",
    appVersion: "0.8.1",
  });
  const items = await client.batchGetStats(normalizeYoutubeVideoIds(rawIds));
  return {
    apiKeyConfigured: client.apiKeyConfigured,
    syncedAt: items[0]?.capturedAt || new Date().toISOString(),
    items: items.map((item) => ({
      videoId: item.youtubeId,
      views: item.views,
    })),
  };
}

if (require.main === module) {
  const application = createApplication();
  const server = http.createServer(application.handler);
  server.listen(application.config.port, application.config.host, () => {
    const statsMode = application.youtube.apiKeyConfigured
      ? "live discovery + statistics"
      : "metadata only";
    console.log(
      `떡상농장 v${application.config.appVersion}: `
      + `http://${application.config.host}:${application.config.port} · YouTube ${statsMode}`,
    );
  });
  const shutdown = () => {
    server.close(() => {
      application.store.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

module.exports = {
  ageHoursFromPublishedAt,
  canonicalYoutubeWatchUrl,
  createApplication,
  createServer,
  decodeHtmlEntities,
  extractYoutubeVideoId,
  fetchYoutubeStatistics,
  hashToken,
  normalizeYoutubeVideoIds,
  parseCookies,
  youtubeThumbnailUrl,
};
