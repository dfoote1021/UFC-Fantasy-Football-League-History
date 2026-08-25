/**
 * keeper-overrides.js
 *
 * Manual keeper lists for Sleeper-era drafts (2022+).
 *
 * Sleeper's standard draft-pick API does not reliably mark a pick as a
 * keeper, so this file is the source of truth for the gold KEEPER label
 * shown on Sleeper draft cards.
 *
 * Add exact player names below, one per line, in the season where that
 * player was kept. The player name must match the name shown in the
 * Draft tab. Matching ignores capitalization and extra spaces.
 *
 * Example:
 *   2024: ["C.J. Stroud", "Amon-Ra St. Brown"],
 *
 * Leave a season as [] when it has no keepers or has not been entered.
 */

(function () {
  "use strict";

  var KEEPERS_BY_SEASON = {
    2022: [],
    2023: [],
    2024: [],
    2025: [],
    2026: []
  };

  function normalize(name) {
    return String(name || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function isKeeper(season, playerName) {
    var keepers = KEEPERS_BY_SEASON[Number(season)] || [];
    var needle = normalize(playerName);
    return keepers.some(function (name) {
      return normalize(name) === needle;
    });
  }

  window.KeeperOverrides = {
    KEEPERS_BY_SEASON: KEEPERS_BY_SEASON,
    isKeeper: isKeeper
  };
})();
