"use strict";

const { URL, URLSearchParams } = require("node:url");

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
  return /^[A-Za-z0-9_-]{11}$/.test(videoId || "") ? videoId : null;
}

function canonicalYoutubeWatchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function youtubeThumbnailUrl(videoId) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function ageHoursFromPublishedAt(publishedAt, now = Date.now()) {
  const publishedTime = Date.parse(publishedAt);
  if (!Number.isFinite(publishedTime)) return null;
  return Math.max(0, (Number(now) - publishedTime) / 3_600_000);
}

function decodeHtmlEntities(value) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    quot: "\"",
  };
  return String(value ?? "").replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi,
    (entity, decimal, hexadecimal, name) => {
      if (name) return named[name.toLowerCase()] ?? entity;
      const codePoint = Number.parseInt(decimal || hexadecimal, hexadecimal ? 16 : 10);
      if (
        !Number.isInteger(codePoint)
        || codePoint < 0
        || codePoint > 0x10ffff
        || (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        return entity;
      }
      return String.fromCodePoint(codePoint);
    },
  );
}

function bestThumbnail(thumbnails, fallback) {
  return thumbnails?.maxres?.url
    || thumbnails?.standard?.url
    || thumbnails?.high?.url
    || thumbnails?.medium?.url
    || thumbnails?.default?.url
    || fallback;
}

function parseIsoDurationSeconds(value) {
  const match = String(value || "").match(
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/,
  );
  if (!match) return null;
  return Math.round(
    (Number(match[1]) || 0) * 86400
    + (Number(match[2]) || 0) * 3600
    + (Number(match[3]) || 0) * 60
    + (Number(match[4]) || 0),
  );
}

async function fetchJson(url, appVersion = "0.8.1") {
  const response = await fetch(url, {
    headers: { "User-Agent": `ViralFieldPrototype/${appVersion}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const error = new Error(`YouTube responded with ${response.status}`);
    error.statusCode = response.status === 404 ? 404 : 502;
    error.responseBody = body.slice(0, 500);
    throw error;
  }
  return response.json();
}

function createYoutubeClient({ apiKey, appVersion = "0.8.1" }) {
  async function resolveVideo(rawUrl) {
    const videoId = extractYoutubeVideoId(rawUrl);
    if (!videoId) {
      const error = new Error("올바른 YouTube 영상 링크를 입력해 주세요.");
      error.statusCode = 400;
      throw error;
    }

    const canonicalUrl = canonicalYoutubeWatchUrl(videoId);
    const fallbackThumbnail = youtubeThumbnailUrl(videoId);
    if (apiKey) {
      const query = new URLSearchParams({
        part: "snippet,statistics,contentDetails",
        id: videoId,
        key: apiKey,
      });
      const payload = await fetchJson(
        `https://www.googleapis.com/youtube/v3/videos?${query}`,
        appVersion,
      );
      const item = payload.items?.[0];
      if (!item) {
        const error = new Error("공개된 YouTube 영상을 찾지 못했습니다.");
        error.statusCode = 404;
        throw error;
      }
      return {
        youtubeId: videoId,
        url: canonicalUrl,
        title: decodeHtmlEntities(item.snippet.title),
        channelId: item.snippet.channelId || null,
        channelTitle: item.snippet.channelTitle,
        categoryId: item.snippet.categoryId || null,
        thumbnailUrl: bestThumbnail(item.snippet.thumbnails, fallbackThumbnail),
        publishedAt: item.snippet.publishedAt,
        durationSeconds: parseIsoDurationSeconds(item.contentDetails?.duration),
        views: Number(item.statistics?.viewCount) || 0,
        likes: Number(item.statistics?.likeCount) || 0,
        comments: Number(item.statistics?.commentCount) || 0,
        capturedAt: new Date().toISOString(),
        metadataMode: "youtube-api",
        statsMode: "youtube-api",
      };
    }

    const query = new URLSearchParams({ url: canonicalUrl, format: "json" });
    const payload = await fetchJson(`https://www.youtube.com/oembed?${query}`, appVersion);
    return {
      youtubeId: videoId,
      url: canonicalUrl,
      title: decodeHtmlEntities(payload.title),
      channelId: null,
      channelTitle: payload.author_name,
      categoryId: null,
      thumbnailUrl: payload.thumbnail_url || fallbackThumbnail,
      publishedAt: null,
      durationSeconds: null,
      views: null,
      likes: null,
      comments: null,
      capturedAt: new Date().toISOString(),
      metadataMode: "youtube-oembed",
      statsMode: "unavailable",
    };
  }

  async function searchRecent({ query, publishedAfter, regionCode, relevanceLanguage }) {
    if (!apiKey) return [];
    const params = new URLSearchParams({
      part: "snippet",
      type: "video",
      order: "date",
      maxResults: "50",
      safeSearch: "moderate",
      videoDuration: "short",
      q: query,
      publishedAfter,
      regionCode,
      relevanceLanguage,
      key: apiKey,
    });
    const payload = await fetchJson(
      `https://www.googleapis.com/youtube/v3/search?${params}`,
      appVersion,
    );
    return (payload.items || []).map((item) => ({
      youtubeId: item.id?.videoId,
      url: canonicalYoutubeWatchUrl(item.id?.videoId),
      title: decodeHtmlEntities(item.snippet?.title || "제목 미확인"),
      channelId: item.snippet?.channelId || null,
      channelTitle: item.snippet?.channelTitle || "채널 미확인",
      categoryId: null,
      thumbnailUrl: bestThumbnail(item.snippet?.thumbnails, youtubeThumbnailUrl(item.id?.videoId)),
      publishedAt: item.snippet?.publishedAt || null,
      durationSeconds: null,
      views: null,
      likes: null,
      comments: null,
      capturedAt: new Date().toISOString(),
      metadataMode: "youtube-search",
      statsMode: "pending",
    })).filter((item) => item.youtubeId);
  }

  async function batchGetStats(rawIds) {
    if (!apiKey) return [];
    const videoIds = Array.from(new Set(rawIds || []))
      .map((id) => String(id).trim())
      .filter((id) => /^[A-Za-z0-9_-]{11}$/.test(id))
      .slice(0, 50);
    if (videoIds.length === 0) return [];

    const params = new URLSearchParams({
      part: "id,snippet,statistics,contentDetails",
      id: videoIds.join(","),
      key: apiKey,
    });
    const payload = await fetchJson(
      `https://www.googleapis.com/youtube/v3/videos?${params}`,
      appVersion,
    );
    const capturedAt = new Date().toISOString();
    return (payload.items || []).map((item) => ({
      youtubeId: item.id,
      publishedAt: item.snippet?.publishedAt || null,
      categoryId: item.snippet?.categoryId || null,
      durationSeconds: Number(item.contentDetails?.durationMillis)
        ? Math.round(Number(item.contentDetails.durationMillis) / 1000)
        : parseIsoDurationSeconds(item.contentDetails?.duration),
      views: Number(item.statistics?.viewCount) || 0,
      likes: Number(item.statistics?.likeCount) || 0,
      comments: Number(item.statistics?.commentCount) || 0,
      capturedAt,
    }));
  }

  return {
    apiKeyConfigured: Boolean(apiKey),
    batchGetStats,
    resolveVideo,
    searchRecent,
  };
}

module.exports = {
  ageHoursFromPublishedAt,
  bestThumbnail,
  canonicalYoutubeWatchUrl,
  createYoutubeClient,
  decodeHtmlEntities,
  extractYoutubeVideoId,
  parseIsoDurationSeconds,
  youtubeThumbnailUrl,
};
