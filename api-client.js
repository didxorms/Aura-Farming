"use strict";

(function exposeApiClient(globalObject) {
  const runtime = globalObject.__VIRAL_FIELD_CONFIG__ || {};
  const baseUrl = String(runtime.apiBaseUrl || "").replace(/\/+$/, "");
  const tokenKey = `viral-field-session:${baseUrl || "same-origin"}`;

  function readToken() {
    try {
      return globalObject.localStorage?.getItem(tokenKey) || "";
    } catch {
      return "";
    }
  }

  function saveToken(token) {
    if (!token) return;
    try {
      globalObject.localStorage?.setItem(tokenKey, token);
    } catch {
      // Cookies remain available when browser storage is blocked.
    }
  }

  function endpoint(pathname) {
    return `${baseUrl}${pathname}`;
  }

  async function request(pathname, options = {}) {
    const headers = { ...(options.headers || {}) };
    const token = readToken();
    if (token && !headers.Authorization) headers.Authorization = `Bearer ${token}`;
    if (options.body != null && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    const response = await fetch(endpoint(pathname), {
      ...options,
      headers,
      credentials: "include",
      body: options.body != null && typeof options.body !== "string"
        ? JSON.stringify(options.body)
        : options.body,
    });
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json()
      : await response.text();
    if (!response.ok) {
      const error = new Error(payload?.error || `Server responded with ${response.status}`);
      error.statusCode = response.status;
      error.code = payload?.code || null;
      throw error;
    }
    return payload;
  }

  globalObject.ViralFieldApi = Object.freeze({
    baseUrl,
    request,
    ensureSession: async () => {
      const payload = await request("/api/session/anonymous", { method: "POST" });
      saveToken(payload.token);
      return payload;
    },
    bootstrap: () => request("/api/bootstrap"),
    feed: (sort = "signal") => request(`/api/feed?sort=${encodeURIComponent(sort)}`),
    resolveVideo: (url) => request("/api/videos/resolve", {
      method: "POST",
      body: { url },
    }),
    plant: (url, replacePositionId = null) => request("/api/positions", {
      method: "POST",
      body: { url, replacePositionId },
    }),
    harvest: (positionId) => request(
      `/api/positions/${encodeURIComponent(positionId)}/harvest`,
      { method: "POST" },
    ),
    harvestAll: () => request("/api/positions/harvest-all", { method: "POST" }),
    watch: (videoId, alertMode = "all") => request(
      `/api/watches/${encodeURIComponent(videoId)}`,
      { method: "PUT", body: { alertMode } },
    ),
    unwatch: (videoId) => request(
      `/api/watches/${encodeURIComponent(videoId)}`,
      { method: "DELETE" },
    ),
    syncYoutube: () => request("/api/youtube/sync", { method: "POST" }),
    status: () => request("/api/system/status"),
  });
}(globalThis));
