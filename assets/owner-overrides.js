/**
 * owner-overrides.js
 * Maps Sleeper usernames/display names to the friendly names you want
 * shown on the site instead. Applies only to Sleeper-era seasons
 * (2022+); ESPN-era seasons already carry their own Owner column
 * directly in espn-standings.csv / espn-matchups.csv / espn-draft.csv.
 *
 * How to add or change a mapping:
 *   Add a line to OWNER_OVERRIDES below in the form:
 *     "<sleeper_username_lowercase>": "<Display Name>",
 *
 * Matching is case-insensitive and trims whitespace, so "DFoote93",
 * "dfoote93", and " dfoote93 " all resolve to the same override.
 * If a username isn't listed here, the site falls back to whatever
 * Sleeper reports as that user's display_name - nothing breaks if you
 * haven't added every owner yet.
 *
 * Everything is wrapped in an IIFE and attached only to window.OwnerOverrides.
 */

(function () {
  "use strict";

  var OWNER_OVERRIDES = {
    "dfoote93": "Dan",
    "dfoote": "Dan",
    "jfoote99": "James",
    "gavinhaus27": "Gavin",
    "Tonytacos7": "Cameron",
    "Spencerwhy": "Spencer",
    "dclark1694": "Dylan",
    "tom511": "Tom",
    "tfoote511": "Tom",
    "tsizz33": "Tsizz", 
    "Bush1018": "Eric",
    "zachbowman231": "Zach",
    "cwcushnie": "Connor",
    "wwalk841": "Wes",
    "TheYTPreachers": "Rob",
    "Betterthantsizz": "Rob",
    "user12664532": "Rob",
    "SkoochKen": "Ken",
    "GeoffM": "Geoff",
    "jspear3": "Spear",
    // Add more mappings below, one per line, following the same pattern:
    // "sleeper_username": "Display Name",
  };

  function normalizeKey(v) {
    return String(v || "").trim().toLowerCase();
  }

  /**
   * Resolve a Sleeper username or display_name to its override, if one
   * exists. Falls back to the original value unchanged when no override
   * is configured for that key.
   */
  function resolveOwnerName(rawName) {
    var key = normalizeKey(rawName);
    if (OWNER_OVERRIDES[key] !== undefined) {
      return OWNER_OVERRIDES[key];
    }
    return rawName;
  }

  window.OwnerOverrides = {
    OWNER_OVERRIDES: OWNER_OVERRIDES,
    resolveOwnerName: resolveOwnerName,
  };
})();
