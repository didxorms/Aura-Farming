"use strict";

const path = require("node:path");

function parseBoolean(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function parseInteger(value, fallback, minimum = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function sqlitePathFromUrl(databaseUrl, rootDir) {
  const raw = String(databaseUrl || "").trim();
  if (!raw) return path.join(rootDir, "data", "viral-field-v07.db");
  if (raw === "sqlite::memory:" || raw === ":memory:") return ":memory:";

  const withoutScheme = raw.startsWith("sqlite:") ? raw.slice("sqlite:".length) : raw;
  if (/^[A-Za-z]:[\\/]/.test(withoutScheme)) return path.normalize(withoutScheme);
  if (path.isAbsolute(withoutScheme)) return path.normalize(withoutScheme);
  return path.resolve(rootDir, withoutScheme.replace(/^[/\\]+/, ""));
}

function loadConfig(env = process.env, rootDir = path.resolve(__dirname, "..")) {
  const databaseUrl = env.DATABASE_URL || "sqlite:./data/viral-field-v07.db";
  if (!String(databaseUrl).startsWith("sqlite:") && databaseUrl !== ":memory:") {
    throw new Error(
      "This build includes the SQLite storage adapter. Use DATABASE_URL=sqlite:... "
      + "or add a compatible storage adapter for the external database.",
    );
  }

  return {
    appVersion: "0.7.1",
    rootDir,
    publicDir: path.resolve(rootDir, env.PUBLIC_DIR || "."),
    host: env.HOST || "0.0.0.0",
    port: parseInteger(env.PORT, 4173, 1),
    publicApiBaseUrl: String(env.PUBLIC_API_BASE_URL || "").replace(/\/+$/, ""),
    allowedOrigins: parseList(env.CORS_ORIGINS),
    databaseUrl,
    databasePath: sqlitePathFromUrl(databaseUrl, rootDir),
    cookieName: env.SESSION_COOKIE_NAME || "viral_field_session",
    cookieSecure: parseBoolean(env.COOKIE_SECURE, false),
    cookieSameSite: ["Lax", "Strict", "None"].includes(env.COOKIE_SAME_SITE)
      ? env.COOKIE_SAME_SITE
      : "Lax",
    sessionDays: parseInteger(env.SESSION_DAYS, 90, 1),
    youtubeApiKey: String(env.YOUTUBE_API_KEY || "").trim(),
    collectorIntervalMinutes: parseInteger(env.COLLECTOR_INTERVAL_MINUTES, 15, 1),
    searchIntervalMinutes: parseInteger(env.SEARCH_INTERVAL_MINUTES, 180, 15),
    feedCandidateLimit: parseInteger(env.FEED_CANDIDATE_LIMIT, 500, 20),
    searchRegion: env.YOUTUBE_SEARCH_REGION || "KR",
    searchLanguage: env.YOUTUBE_SEARCH_LANGUAGE || "ko",
    searchLanes: parseList(env.YOUTUBE_SEARCH_LANES).length > 0
      ? parseList(env.YOUTUBE_SEARCH_LANES)
      : [
        "웃긴|밈|챌린지",
        "강아지|고양이|반려동물",
        "음식|요리|먹방",
        "게임|엔터테인먼트",
      ],
  };
}

module.exports = {
  loadConfig,
  parseBoolean,
  parseInteger,
  parseList,
  sqlitePathFromUrl,
};
