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

const DEFAULT_SEARCH_LANES = [
  { label: "유머·밈", query: "웃긴|밈|챌린지" },
  { label: "동물", query: "강아지|고양이|반려동물" },
  { label: "푸드", query: "음식|요리|먹방" },
  { label: "게임·엔터", query: "게임|엔터테인먼트" },
];

function parseSearchLanes(value) {
  const entries = parseList(value);
  if (entries.length === 0) return DEFAULT_SEARCH_LANES.map((lane) => ({ ...lane }));
  const defaultLabels = new Map(DEFAULT_SEARCH_LANES.map((lane) => [lane.query, lane.label]));
  return entries.map((entry, index) => {
    const separator = entry.indexOf("::");
    if (separator !== -1) {
      const label = entry.slice(0, separator).trim();
      const query = entry.slice(separator + 2).trim();
      if (label && query) return { label, query };
    }
    return {
      label: defaultLabels.get(entry) || `레인 ${index + 1}`,
      query: entry,
    };
  });
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
    appVersion: "0.8.0",
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
    searchLanes: parseSearchLanes(env.YOUTUBE_SEARCH_LANES),
  };
}

module.exports = {
  loadConfig,
  parseBoolean,
  parseInteger,
  parseList,
  parseSearchLanes,
  sqlitePathFromUrl,
};
