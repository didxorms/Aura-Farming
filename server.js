"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const host = "127.0.0.1";
const port = Number(process.env.PORT || 4173);
const root = __dirname;
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function extractYoutubeVideoId(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  const hostName = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const segments = parsed.pathname.split("/").filter(Boolean);
  let videoId = null;

  if (hostName === "youtu.be") {
    [videoId] = segments;
  } else if (["youtube.com", "m.youtube.com", "music.youtube.com"].includes(hostName)) {
    if (parsed.pathname === "/watch") videoId = parsed.searchParams.get("v");
    if (["shorts", "embed", "live"].includes(segments[0])) videoId = segments[1];
  }

  return /^[A-Za-z0-9_-]{6,20}$/.test(videoId || "") ? videoId : null;
}

function canonicalYoutubeWatchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function youtubeThumbnailUrl(videoId) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function ageHoursFromPublishedAt(publishedAt) {
  const publishedTime = Date.parse(publishedAt);
  if (!Number.isFinite(publishedTime)) return null;
  return Math.max(1, Math.round((Date.now() - publishedTime) / 3_600_000));
}

function bestThumbnail(thumbnails, fallback) {
  return thumbnails?.maxres?.url
    || thumbnails?.standard?.url
    || thumbnails?.high?.url
    || thumbnails?.medium?.url
    || thumbnails?.default?.url
    || fallback;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "ViralFieldPrototype/0.5" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    const error = new Error(`YouTube responded with ${response.status}`);
    error.statusCode = response.status === 404 ? 404 : 502;
    throw error;
  }
  return response.json();
}

async function fetchYoutubeMetadata(videoId) {
  const canonicalUrl = canonicalYoutubeWatchUrl(videoId);
  const fallbackThumbnail = youtubeThumbnailUrl(videoId);
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();

  if (apiKey) {
    try {
      const query = new URLSearchParams({
        part: "snippet,statistics",
        id: videoId,
        key: apiKey,
      });
      const payload = await fetchJson(`https://www.googleapis.com/youtube/v3/videos?${query}`);
      const item = payload.items?.[0];
      if (!item) {
        const error = new Error("YouTube video was not found");
        error.statusCode = 404;
        throw error;
      }

      return {
        videoId,
        url: canonicalUrl,
        title: item.snippet.title,
        handle: item.snippet.channelTitle,
        thumbnailUrl: bestThumbnail(item.snippet.thumbnails, fallbackThumbnail),
        publishedAt: item.snippet.publishedAt,
        ageHours: ageHoursFromPublishedAt(item.snippet.publishedAt),
        initialViews: Number(item.statistics?.viewCount) || null,
        metadataMode: "youtube-api",
        statsMode: "youtube-api",
      };
    } catch (error) {
      console.warn("[youtube] Data API unavailable; falling back to oEmbed:", error.cause?.message || error.message);
    }
  }

  const query = new URLSearchParams({ url: canonicalUrl, format: "json" });
  const payload = await fetchJson(`https://www.youtube.com/oembed?${query}`);
  return {
    videoId,
    url: canonicalUrl,
    title: payload.title,
    handle: payload.author_name,
    thumbnailUrl: payload.thumbnail_url || fallbackThumbnail,
    publishedAt: null,
    ageHours: null,
    initialViews: null,
    metadataMode: "youtube-oembed",
    statsMode: "simulated",
  };
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

async function handleYoutubeApi(requestUrl, response) {
  const rawUrl = requestUrl.searchParams.get("url") || "";
  const videoId = extractYoutubeVideoId(rawUrl);
  if (!videoId) {
    sendJson(response, 400, { error: "올바른 YouTube 영상 링크를 입력해 주세요." });
    return;
  }

  try {
    sendJson(response, 200, await fetchYoutubeMetadata(videoId));
  } catch (error) {
    console.error("[youtube] metadata request failed:", error.cause?.message || error.message);
    const statusCode = error.statusCode || 502;
    const message = statusCode === 404
      ? "공개된 YouTube 영상을 찾지 못했습니다."
      : "YouTube 정보를 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.";
    sendJson(response, statusCode, { error: message });
  }
}

function serveStaticFile(requestUrl, response) {
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const decoded = decodeURIComponent(pathname);
  const filePath = path.resolve(root, `.${decoded}`);

  if (!filePath.startsWith(root)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500, { "Content-Type": "text/plain; charset=utf-8" });
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

function createServer() {
  return http.createServer((request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);
    if (requestUrl.pathname === "/api/youtube") {
      handleYoutubeApi(requestUrl, response);
      return;
    }
    serveStaticFile(requestUrl, response);
  });
}

if (require.main === module) {
  createServer().listen(port, host, () => {
    const statsMode = process.env.YOUTUBE_API_KEY ? "metadata + live statistics" : "metadata + thumbnail";
    console.log(`떡상농장 v0.5: http://${host}:${port} · YouTube ${statsMode}`);
  });
}

module.exports = {
  ageHoursFromPublishedAt,
  canonicalYoutubeWatchUrl,
  createServer,
  extractYoutubeVideoId,
  fetchYoutubeMetadata,
  youtubeThumbnailUrl,
};
