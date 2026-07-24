"use strict";

const path = require("node:path");
const { createSqliteStore } = require("./sqlite-store");

function createStore(config) {
  return createSqliteStore({
    databasePath: config.databasePath,
    migrationsDir: path.join(config.rootDir, "db", "migrations"),
  });
}

module.exports = {
  createStore,
};
