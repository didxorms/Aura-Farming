"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const {
  AUTO_HARVEST_MINUTES,
  MAX_SLOTS,
  RULES_VERSION,
  SEED_COST,
  calculateEarlyBonus,
  calculatePayout,
  gradeForRatio,
} = require("./game-rules");
const { ageHoursFromPublishedAt } = require("./youtube");

function createId() {
  return crypto.randomUUID();
}

function hasFiniteNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function isoNow(now = Date.now()) {
  return new Date(Number(now)).toISOString();
}

function addMinutes(value, minutes) {
  return new Date(Date.parse(value) + minutes * 60_000).toISOString();
}

function toVideo(row) {
  if (!row) return null;
  return {
    id: row.id,
    youtubeId: row.youtube_id,
    url: row.url,
    title: row.title,
    channelId: row.channel_id,
    channelTitle: row.channel_title,
    thumbnailUrl: row.thumbnail_url,
    publishedAt: row.published_at,
    durationSeconds: row.duration_seconds,
    views: row.latest_views,
    likes: row.latest_likes,
    comments: row.latest_comments,
    snapshotAt: row.latest_snapshot_at,
    metadataMode: row.metadata_mode,
    statsMode: row.stats_mode,
  };
}

function createSqliteStore({ databasePath, migrationsDir }) {
  if (databasePath !== ":memory:") {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA busy_timeout = 5000");

  function transaction(work) {
    database.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      database.exec("COMMIT");
      return result;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  function migrate() {
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `);
    const files = fs.readdirSync(migrationsDir)
      .filter((file) => /^\d+.*\.sql$/.test(file))
      .sort();
    files.forEach((file) => {
      const version = path.basename(file, ".sql");
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      transaction(() => {
        const alreadyApplied = database.prepare(
          "SELECT 1 FROM schema_migrations WHERE version = ?",
        ).get(version);
        if (alreadyApplied) return;
        database.exec(sql);
        database.prepare(
          "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
        ).run(version, isoNow());
      });
    });
  }

  function createAnonymousSession({ tokenHash, expiresAt }, now = Date.now()) {
    const createdAt = isoNow(now);
    const playerId = createId();
    transaction(() => {
      database.prepare(`
        INSERT INTO players(id, balance, created_at, updated_at)
        VALUES (?, 3200, ?, ?)
      `).run(playerId, createdAt, createdAt);
      database.prepare(`
        INSERT INTO player_sessions(token_hash, player_id, expires_at, created_at)
        VALUES (?, ?, ?, ?)
      `).run(tokenHash, playerId, expiresAt, createdAt);
      database.prepare(`
        INSERT INTO wallet_transactions(id, player_id, amount, kind, reference_id, created_at)
        VALUES (?, ?, 3200, 'initial_balance', NULL, ?)
      `).run(createId(), playerId, createdAt);
    });
    return getPlayer(playerId);
  }

  function getPlayer(playerId) {
    const row = database.prepare(`
      SELECT id, balance, created_at, updated_at
      FROM players
      WHERE id = ?
    `).get(playerId);
    return row ? {
      id: row.id,
      balance: row.balance,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    } : null;
  }

  function getPlayerBySession(tokenHash, now = Date.now()) {
    const row = database.prepare(`
      SELECT p.id, p.balance, p.created_at, p.updated_at
      FROM player_sessions s
      JOIN players p ON p.id = s.player_id
      WHERE s.token_hash = ? AND s.expires_at > ?
    `).get(tokenHash, isoNow(now));
    return row ? {
      id: row.id,
      balance: row.balance,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    } : null;
  }

  function deleteExpiredSessions(now = Date.now()) {
    return database.prepare("DELETE FROM player_sessions WHERE expires_at <= ?")
      .run(isoNow(now)).changes;
  }

  function findVideoByYoutubeId(youtubeId) {
    return toVideo(database.prepare("SELECT * FROM videos WHERE youtube_id = ?").get(youtubeId));
  }

  function addSnapshotByVideoId(videoId, snapshot) {
    if (!hasFiniteNumber(snapshot.views)) return false;
    const capturedAt = snapshot.capturedAt || isoNow();
    database.prepare(`
      INSERT OR IGNORE INTO video_snapshots(
        id, video_id, captured_at, views, likes, comments
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      createId(),
      videoId,
      capturedAt,
      Math.max(0, Math.round(Number(snapshot.views))),
      hasFiniteNumber(snapshot.likes) ? Math.max(0, Math.round(Number(snapshot.likes))) : null,
      hasFiniteNumber(snapshot.comments) ? Math.max(0, Math.round(Number(snapshot.comments))) : null,
    );
    database.prepare(`
      UPDATE videos
      SET latest_views = ?,
          latest_likes = ?,
          latest_comments = ?,
          latest_snapshot_at = ?,
          stats_mode = 'youtube-api',
          updated_at = ?
      WHERE id = ?
    `).run(
      Math.max(0, Math.round(Number(snapshot.views))),
      hasFiniteNumber(snapshot.likes) ? Math.max(0, Math.round(Number(snapshot.likes))) : null,
      hasFiniteNumber(snapshot.comments) ? Math.max(0, Math.round(Number(snapshot.comments))) : null,
      capturedAt,
      capturedAt,
      videoId,
    );
    return true;
  }

  function upsertVideo(video, { lane = "direct", candidate = true } = {}, now = Date.now()) {
    const updatedAt = video.capturedAt || isoNow(now);
    const existing = database.prepare(
      "SELECT id FROM videos WHERE youtube_id = ?",
    ).get(video.youtubeId);
    const videoId = existing?.id || createId();

    database.prepare(`
      INSERT INTO videos(
        id, youtube_id, url, title, channel_id, channel_title, thumbnail_url,
        published_at, duration_seconds, latest_views, latest_likes, latest_comments,
        latest_snapshot_at, metadata_mode, stats_mode, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(youtube_id) DO UPDATE SET
        url = excluded.url,
        title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE videos.title END,
        channel_id = COALESCE(excluded.channel_id, videos.channel_id),
        channel_title = CASE
          WHEN excluded.channel_title <> '' THEN excluded.channel_title
          ELSE videos.channel_title
        END,
        thumbnail_url = COALESCE(excluded.thumbnail_url, videos.thumbnail_url),
        published_at = COALESCE(excluded.published_at, videos.published_at),
        duration_seconds = COALESCE(excluded.duration_seconds, videos.duration_seconds),
        metadata_mode = excluded.metadata_mode,
        stats_mode = CASE
          WHEN excluded.latest_views IS NOT NULL THEN 'youtube-api'
          ELSE videos.stats_mode
        END,
        updated_at = excluded.updated_at
    `).run(
      videoId,
      video.youtubeId,
      video.url,
      video.title || "제목 미확인",
      video.channelId || null,
      video.channelTitle || "채널 미확인",
      video.thumbnailUrl || null,
      video.publishedAt || null,
      hasFiniteNumber(video.durationSeconds) ? Number(video.durationSeconds) : null,
      hasFiniteNumber(video.views) ? Math.max(0, Math.round(Number(video.views))) : null,
      hasFiniteNumber(video.likes) ? Math.max(0, Math.round(Number(video.likes))) : null,
      hasFiniteNumber(video.comments) ? Math.max(0, Math.round(Number(video.comments))) : null,
      hasFiniteNumber(video.views) ? updatedAt : null,
      video.metadataMode || "youtube-api",
      hasFiniteNumber(video.views) ? "youtube-api" : (video.statsMode || "pending"),
      updatedAt,
      updatedAt,
    );

    const stored = database.prepare("SELECT id FROM videos WHERE youtube_id = ?")
      .get(video.youtubeId);
    if (hasFiniteNumber(video.views)) {
      addSnapshotByVideoId(stored.id, video);
    }
    if (candidate) {
      database.prepare(`
        INSERT INTO feed_candidates(
          video_id, lane, status, signal_score, signal_label,
          first_seen_at, last_evaluated_at, expires_at
        ) VALUES (?, ?, 'observing', NULL, 'NEW · 관측 중', ?, NULL, ?)
        ON CONFLICT(video_id) DO UPDATE SET
          lane = CASE
            WHEN feed_candidates.lane = 'direct' THEN excluded.lane
            ELSE feed_candidates.lane
          END,
          expires_at = MAX(feed_candidates.expires_at, excluded.expires_at)
      `).run(stored.id, lane, updatedAt, addMinutes(updatedAt, 48 * 60));
    }
    return findVideoByYoutubeId(video.youtubeId);
  }

  function addSnapshotByYoutubeId(youtubeId, snapshot) {
    const video = findVideoByYoutubeId(youtubeId);
    if (!video) return false;
    if (snapshot.publishedAt || hasFiniteNumber(snapshot.durationSeconds)) {
      database.prepare(`
        UPDATE videos
        SET published_at = COALESCE(?, published_at),
            duration_seconds = COALESCE(?, duration_seconds),
            updated_at = ?
        WHERE id = ?
      `).run(
        snapshot.publishedAt || null,
        hasFiniteNumber(snapshot.durationSeconds) ? Number(snapshot.durationSeconds) : null,
        snapshot.capturedAt || isoNow(),
        video.id,
      );
    }
    return addSnapshotByVideoId(video.id, snapshot);
  }

  function snapshotRows(videoId, limit = 48) {
    return database.prepare(`
      SELECT captured_at, views, likes, comments
      FROM video_snapshots
      WHERE video_id = ?
      ORDER BY captured_at DESC
      LIMIT ?
    `).all(videoId, limit).reverse().map((row) => ({
      at: row.captured_at,
      views: row.views,
      likes: row.likes,
      comments: row.comments,
    }));
  }

  function positionRows(playerId) {
    return database.prepare(`
      SELECT
        p.*, d.discovery_rank,
        v.youtube_id, v.url, v.title, v.channel_title, v.thumbnail_url,
        v.published_at, v.duration_seconds, v.latest_views, v.latest_snapshot_at,
        v.metadata_mode, v.stats_mode,
        (SELECT COUNT(*) FROM discoveries all_d WHERE all_d.video_id = p.video_id)
          AS discoverer_count
      FROM positions p
      JOIN discoveries d ON d.id = p.discovery_id
      JOIN videos v ON v.id = p.video_id
      WHERE p.player_id = ? AND p.status = 'active'
      ORDER BY p.planted_at ASC
    `).all(playerId);
  }

  function toPosition(row, now = Date.now()) {
    const elapsed = Math.max(0, (Number(now) - Date.parse(row.planted_at)) / 60000);
    return {
      id: row.id,
      videoId: row.youtube_id,
      sourceId: `yt:${row.youtube_id}`,
      url: row.url,
      title: row.title,
      handle: row.channel_title,
      platform: "YOUTUBE SHORTS",
      thumbnailUrl: row.thumbnail_url,
      publishedAt: row.published_at,
      durationSeconds: row.duration_seconds,
      metadataMode: row.metadata_mode,
      statsMode: row.stats_mode,
      entryViews: row.entry_views,
      actualEntryViews: row.entry_views,
      liveViews: Number(row.latest_views ?? row.entry_views),
      lastSyncedAt: row.latest_snapshot_at,
      viewSnapshots: snapshotRows(row.video_id),
      earlyBonus: row.early_bonus,
      discoveryRank: row.discovery_rank,
      discovererCount: row.discoverer_count,
      plantedAt: row.planted_at,
      elapsedMinutes: elapsed,
      autoHarvestAt: row.auto_harvest_at,
      rulesVersion: row.rules_version,
    };
  }

  function watchRows(playerId) {
    return database.prepare(`
      SELECT
        w.alert_mode, w.created_at,
        v.*, fc.signal_score, fc.signal_label,
        (SELECT COUNT(*) FROM discoveries d WHERE d.video_id = v.id) AS discoverer_count
      FROM watches w
      JOIN videos v ON v.id = w.video_id
      LEFT JOIN feed_candidates fc ON fc.video_id = v.id
      WHERE w.player_id = ?
      ORDER BY w.created_at DESC
    `).all(playerId);
  }

  function harvestRows(playerId) {
    return database.prepare(`
      SELECT
        h.*, v.youtube_id, v.url, v.title, v.channel_title, v.thumbnail_url,
        v.published_at, v.metadata_mode, v.stats_mode,
        (SELECT COUNT(*) FROM discoveries d WHERE d.video_id = h.video_id)
          AS discoverer_count
      FROM harvests h
      JOIN videos v ON v.id = h.video_id
      WHERE h.player_id = ?
      ORDER BY h.harvested_at DESC
      LIMIT 100
    `).all(playerId);
  }

  function getBootstrap(playerId, now = Date.now()) {
    const player = getPlayer(playerId);
    if (!player) return null;
    return {
      player,
      positions: positionRows(playerId).map((row) => toPosition(row, now)),
      watches: watchRows(playerId).map((row) => ({
        ...toVideo(row),
        alertMode: row.alert_mode,
        watchedAt: row.created_at,
        signalScore: row.signal_score,
        signalLabel: row.signal_label,
        discovererCount: row.discoverer_count,
      })),
      harvests: harvestRows(playerId).map((row) => ({
        id: row.id,
        positionId: row.position_id,
        videoId: row.youtube_id,
        sourceId: `yt:${row.youtube_id}`,
        url: row.url,
        title: row.title,
        handle: row.channel_title,
        platform: "YOUTUBE SHORTS",
        thumbnailUrl: row.thumbnail_url,
        publishedAt: row.published_at,
        metadataMode: row.metadata_mode,
        statsMode: row.stats_mode,
        entryViews: row.entry_views,
        currentViews: row.final_views,
        ratio: row.ratio,
        earlyBonus: row.early_bonus,
        payout: row.payout,
        profit: row.profit,
        discoveryRank: row.discovery_rank,
        discoverersAtHarvest: row.discoverer_count,
        grade: row.grade,
        gradeLabel: row.grade_label,
        plantedAt: row.planted_at,
        harvestedAt: row.harvested_at,
        elapsed: Math.max(0, (Date.parse(row.harvested_at) - Date.parse(row.planted_at)) / 60000),
        rulesVersion: row.rules_version,
      })),
      serverTime: isoNow(now),
    };
  }

  function listFeed(playerId, { sort = "signal", limit = 50 } = {}, now = Date.now()) {
    const orderBy = {
      signal: "COALESCE(fc.signal_score, -1) DESC, fc.first_seen_at DESC",
      new: "v.published_at DESC, fc.first_seen_at DESC",
      early: "COALESCE(v.latest_views, 0) ASC, v.published_at DESC",
    }[sort] || "COALESCE(fc.signal_score, -1) DESC, fc.first_seen_at DESC";
    const rows = database.prepare(`
      SELECT
        v.*, fc.lane, fc.status AS candidate_status, fc.signal_score,
        fc.signal_label, fc.first_seen_at, fc.last_evaluated_at,
        (SELECT COUNT(*) FROM discoveries d WHERE d.video_id = v.id) AS discoverer_count,
        EXISTS(
          SELECT 1 FROM watches w WHERE w.video_id = v.id AND w.player_id = ?
        ) AS watched_by_me,
        EXISTS(
          SELECT 1 FROM positions p
          WHERE p.video_id = v.id AND p.player_id = ? AND p.status = 'active'
        ) AS planted_by_me,
        EXISTS(
          SELECT 1 FROM discoveries d2 WHERE d2.video_id = v.id AND d2.player_id = ?
        ) AS discovered_by_me
      FROM feed_candidates fc
      JOIN videos v ON v.id = fc.video_id
      WHERE fc.expires_at > ?
        AND (v.duration_seconds IS NULL OR v.duration_seconds <= 180)
      ORDER BY ${orderBy}
      LIMIT ?
    `).all(playerId, playerId, playerId, isoNow(now), Math.min(100, Math.max(1, limit)));
    return rows.map((row) => ({
      ...toVideo(row),
      lane: row.lane,
      candidateStatus: row.candidate_status,
      signalScore: row.signal_score,
      signalLabel: row.signal_label,
      firstSeenAt: row.first_seen_at,
      lastEvaluatedAt: row.last_evaluated_at,
      discovererCount: row.discoverer_count,
      watchedByMe: Boolean(row.watched_by_me),
      plantedByMe: Boolean(row.planted_by_me),
      discoveredByMe: Boolean(row.discovered_by_me),
      snapshots: snapshotRows(row.id, 3),
    }));
  }

  function setWatch(playerId, youtubeId, alertMode = "all", now = Date.now()) {
    const video = database.prepare("SELECT id FROM videos WHERE youtube_id = ?").get(youtubeId);
    if (!video) throw Object.assign(new Error("영상을 찾지 못했습니다."), { statusCode: 404 });
    const discovered = database.prepare(`
      SELECT 1 FROM discoveries WHERE player_id = ? AND video_id = ?
    `).get(playerId, video.id);
    if (discovered) {
      throw Object.assign(new Error("이미 발견한 영상은 후보로 보관할 수 없습니다."), { statusCode: 409 });
    }
    database.prepare(`
      INSERT INTO watches(player_id, video_id, alert_mode, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(player_id, video_id) DO UPDATE SET alert_mode = excluded.alert_mode
    `).run(
      playerId,
      video.id,
      ["all", "surge", "off"].includes(alertMode) ? alertMode : "all",
      isoNow(now),
    );
  }

  function removeWatch(playerId, youtubeId) {
    return database.prepare(`
      DELETE FROM watches
      WHERE player_id = ?
        AND video_id = (SELECT id FROM videos WHERE youtube_id = ?)
    `).run(playerId, youtubeId).changes > 0;
  }

  function harvestInsideTransaction(playerId, positionId, now = Date.now()) {
    const row = database.prepare(`
      SELECT
        p.*, d.discovery_rank,
        v.latest_views, v.youtube_id
      FROM positions p
      JOIN discoveries d ON d.id = p.discovery_id
      JOIN videos v ON v.id = p.video_id
      WHERE p.id = ? AND p.player_id = ? AND p.status = 'active'
    `).get(positionId, playerId);
    if (!row) {
      throw Object.assign(new Error("수확할 활성 포지션을 찾지 못했습니다."), { statusCode: 404 });
    }

    const harvestedAt = isoNow(now);
    const finalViews = Math.max(row.entry_views, Number(row.latest_views ?? row.entry_views));
    const ratio = finalViews / Math.max(1, row.entry_views);
    const payout = calculatePayout(row.entry_views, finalViews, row.early_bonus);
    const grade = gradeForRatio(ratio);
    const harvestId = createId();

    database.prepare(`
      UPDATE positions SET status = 'harvested', harvested_at = ? WHERE id = ?
    `).run(harvestedAt, row.id);
    database.prepare(`
      INSERT INTO harvests(
        id, player_id, position_id, video_id, entry_views, final_views,
        ratio, early_bonus, payout, profit, discovery_rank, grade, grade_label,
        rules_version, planted_at, harvested_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      harvestId,
      playerId,
      row.id,
      row.video_id,
      row.entry_views,
      finalViews,
      ratio,
      row.early_bonus,
      payout,
      payout - SEED_COST,
      row.discovery_rank,
      grade.grade,
      grade.label,
      row.rules_version,
      row.planted_at,
      harvestedAt,
    );
    database.prepare(`
      UPDATE players SET balance = balance + ?, updated_at = ? WHERE id = ?
    `).run(payout, harvestedAt, playerId);
    database.prepare(`
      INSERT INTO wallet_transactions(id, player_id, amount, kind, reference_id, created_at)
      VALUES (?, ?, ?, 'harvest', ?, ?)
    `).run(createId(), playerId, payout, harvestId, harvestedAt);
    return harvestId;
  }

  function plantPosition(
    playerId,
    youtubeId,
    { replacePositionId = null } = {},
    now = Date.now(),
  ) {
    return transaction(() => {
      const player = getPlayer(playerId);
      if (!player) throw Object.assign(new Error("플레이어를 찾지 못했습니다."), { statusCode: 401 });
      const videoRow = database.prepare("SELECT * FROM videos WHERE youtube_id = ?").get(youtubeId);
      if (!videoRow) throw Object.assign(new Error("영상을 찾지 못했습니다."), { statusCode: 404 });
      if (!hasFiniteNumber(videoRow.latest_views)) {
        throw Object.assign(
          new Error("실제 조회수를 확인할 수 있는 YouTube 영상만 라이브 밭에 심을 수 있습니다."),
          { statusCode: 409 },
        );
      }
      const priorDiscovery = database.prepare(`
        SELECT discovery_rank FROM discoveries WHERE player_id = ? AND video_id = ?
      `).get(playerId, videoRow.id);
      if (priorDiscovery) {
        throw Object.assign(new Error("이미 발견했거나 수확한 영상입니다."), { statusCode: 409 });
      }

      const activeCount = database.prepare(`
        SELECT COUNT(*) AS count FROM positions WHERE player_id = ? AND status = 'active'
      `).get(playerId).count;
      if (activeCount >= MAX_SLOTS) {
        if (!replacePositionId) {
          throw Object.assign(new Error("밭이 가득 찼습니다. 교체할 포지션을 선택해 주세요."), { statusCode: 409 });
        }
        harvestInsideTransaction(playerId, replacePositionId, now);
      }

      const refreshedPlayer = getPlayer(playerId);
      if (refreshedPlayer.balance < SEED_COST) {
        throw Object.assign(new Error("씨앗을 살 코인이 부족합니다."), { statusCode: 409 });
      }

      const discoveryRank = Number(database.prepare(`
        SELECT COALESCE(MAX(discovery_rank), 0) + 1 AS next_rank
        FROM discoveries WHERE video_id = ?
      `).get(videoRow.id).next_rank);
      const plantedAt = isoNow(now);
      const discoveryId = createId();
      const positionId = createId();
      const ageHours = ageHoursFromPublishedAt(videoRow.published_at, now) || 0;
      const earlyBonus = calculateEarlyBonus(videoRow.latest_views, ageHours);

      database.prepare(`
        INSERT INTO discoveries(id, player_id, video_id, discovery_rank, discovered_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(discoveryId, playerId, videoRow.id, discoveryRank, plantedAt);
      database.prepare(`
        INSERT INTO positions(
          id, player_id, video_id, discovery_id, entry_views, early_bonus,
          rules_version, planted_at, auto_harvest_at, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
      `).run(
        positionId,
        playerId,
        videoRow.id,
        discoveryId,
        videoRow.latest_views,
        earlyBonus,
        RULES_VERSION,
        plantedAt,
        addMinutes(plantedAt, AUTO_HARVEST_MINUTES),
      );
      database.prepare(`
        UPDATE players SET balance = balance - ?, updated_at = ? WHERE id = ?
      `).run(SEED_COST, plantedAt, playerId);
      database.prepare(`
        INSERT INTO wallet_transactions(id, player_id, amount, kind, reference_id, created_at)
        VALUES (?, ?, ?, 'plant', ?, ?)
      `).run(createId(), playerId, -SEED_COST, positionId, plantedAt);
      database.prepare("DELETE FROM watches WHERE player_id = ? AND video_id = ?")
        .run(playerId, videoRow.id);
      return { positionId, discoveryRank };
    });
  }

  function harvestPosition(playerId, positionId, now = Date.now()) {
    const harvestId = transaction(() => harvestInsideTransaction(playerId, positionId, now));
    return harvestRows(playerId).find((row) => row.id === harvestId);
  }

  function harvestAll(playerId, now = Date.now()) {
    return transaction(() => {
      const ids = database.prepare(`
        SELECT id FROM positions WHERE player_id = ? AND status = 'active'
      `).all(playerId).map((row) => row.id);
      return ids.map((id) => harvestInsideTransaction(playerId, id, now));
    });
  }

  function autoHarvestDue(now = Date.now()) {
    const due = database.prepare(`
      SELECT id, player_id FROM positions
      WHERE status = 'active' AND auto_harvest_at <= ?
      ORDER BY auto_harvest_at ASC
    `).all(isoNow(now));
    const harvested = [];
    due.forEach((row) => {
      try {
        const harvestId = transaction(() => harvestInsideTransaction(row.player_id, row.id, now));
        harvested.push(harvestId);
      } catch (error) {
        if (error.statusCode !== 404) throw error;
      }
    });
    return harvested;
  }

  function listTrackableYoutubeIds(limit = 500, now = Date.now()) {
    return database.prepare(`
      SELECT DISTINCT v.youtube_id
      FROM videos v
      LEFT JOIN feed_candidates fc ON fc.video_id = v.id AND fc.expires_at > ?
      LEFT JOIN positions p ON p.video_id = v.id AND p.status = 'active'
      WHERE fc.video_id IS NOT NULL OR p.id IS NOT NULL
      ORDER BY COALESCE(v.latest_snapshot_at, v.created_at) ASC
      LIMIT ?
    `).all(isoNow(now), limit).map((row) => row.youtube_id);
  }

  function candidateMeasurements(now = Date.now()) {
    const rows = database.prepare(`
      SELECT v.id, v.youtube_id, v.published_at, v.latest_views
      FROM feed_candidates fc
      JOIN videos v ON v.id = fc.video_id
      WHERE fc.expires_at > ?
    `).all(isoNow(now));
    return rows.map((row) => ({
      videoId: row.id,
      youtubeId: row.youtube_id,
      publishedAt: row.published_at,
      latestViews: row.latest_views,
      snapshots: snapshotRows(row.id, 4),
    }));
  }

  function updateCandidateSignal(videoId, { score, label }, now = Date.now()) {
    database.prepare(`
      UPDATE feed_candidates
      SET status = ?, signal_score = ?, signal_label = ?,
          last_evaluated_at = ?
      WHERE video_id = ?
    `).run(
      Number.isFinite(score) ? "ranked" : "observing",
      Number.isFinite(score) ? score : null,
      label,
      isoNow(now),
      videoId,
    );
  }

  function lastSuccessfulRun(kind) {
    return database.prepare(`
      SELECT * FROM collector_runs
      WHERE kind = ? AND status = 'success'
      ORDER BY finished_at DESC
      LIMIT 1
    `).get(kind) || null;
  }

  function recordCollectorRun(run) {
    database.prepare(`
      INSERT INTO collector_runs(
        id, kind, status, requests_used, items_seen, error_message,
        started_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      run.id || createId(),
      run.kind,
      run.status,
      run.requestsUsed || 0,
      run.itemsSeen || 0,
      run.errorMessage || null,
      run.startedAt,
      run.finishedAt,
    );
  }

  function systemStatus() {
    const latestSearch = lastSuccessfulRun("search");
    const latestStats = lastSuccessfulRun("stats");
    const counts = database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM videos) AS videos,
        (SELECT COUNT(*) FROM video_snapshots) AS snapshots,
        (SELECT COUNT(*) FROM feed_candidates WHERE expires_at > ?) AS candidates,
        (SELECT COUNT(*) FROM players) AS players,
        (SELECT COUNT(*) FROM positions WHERE status = 'active') AS active_positions
    `).get(isoNow());
    return {
      ...counts,
      latestSearchAt: latestSearch?.finished_at || null,
      latestStatsAt: latestStats?.finished_at || null,
    };
  }

  function close() {
    database.close();
  }

  migrate();
  return {
    addSnapshotByYoutubeId,
    autoHarvestDue,
    candidateMeasurements,
    close,
    createAnonymousSession,
    deleteExpiredSessions,
    findVideoByYoutubeId,
    getBootstrap,
    getPlayer,
    getPlayerBySession,
    harvestAll,
    harvestPosition,
    lastSuccessfulRun,
    listFeed,
    listTrackableYoutubeIds,
    plantPosition,
    recordCollectorRun,
    removeWatch,
    setWatch,
    systemStatus,
    updateCandidateSignal,
    upsertVideo,
  };
}

module.exports = {
  createSqliteStore,
};
