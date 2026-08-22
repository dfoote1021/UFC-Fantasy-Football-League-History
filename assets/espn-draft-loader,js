/**
 * espn-draft-loader.js
 * Loads and normalizes historical ESPN-era draft data (2012-2021) from a
 * local CSV export, in the standard ESPN Fantasy draft-recap format
 * (snake draft only - no auction leagues in this league's history).
 *
 * Data source: assets/data/espn-draft.csv
 *
 * Expected columns (case-insensitive; header aliases below cover common
 * ESPN export variations):
 *   Season, Overall Pick, Round, Round Pick, Team, Owner, Player ID,
 *   Player Name, Keeper
 *
 * `Team` is the real fun team display name for that pick's season (e.g.
 * "Gotham City Rogues"), and `Owner` is that team's owner name/username
 * (e.g. "Dan"). Both are read directly from this file - no join against
 * espn-standings.csv or espn-matchups.csv is required, since the sheet
 * now carries both values explicitly. The draft board displays them as
 * "Team Name (Owner)", matching the display convention used elsewhere on
 * the site (e.g. matchup records).
 *
 * Everything is wrapped in an IIFE and attached only to window.EspnDraftLoader.
 */

(function () {
  "use strict";

  var DRAFT_CSV_PATH = "assets/data/espn-draft.csv";

  var ALIAS_MAP = {
    year: ["year", "season"],
    overall_pick: ["overall_pick", "overall pick", "pick", "pick_no", "pick no"],
    round: ["round"],
    round_pick: ["round_pick", "round pick", "pick_in_round", "slot"],
    team: ["team"],
    owner: ["owner", "team_owner", "team owner"],
    player_id: ["player_id", "player id", "playerid"],
    player_name: ["player_name", "player name", "player"],
    keeper: ["keeper", "is_keeper"],
  };

  var _draftCache = {};

  function parseCSV(text) {
    var rows = [];
    var row = [];
    var field = "";
    var inQuotes = false;

    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      var next = text[i + 1];

      if (inQuotes) {
        if (c === '"' && next === '"') {
          field += '"';
          i++;
        } else if (c === '"') {
          inQuotes = false;
        } else {
          field += c;
        }
      } else {
        if (c === '"') {
          inQuotes = true;
        } else if (c === ",") {
          row.push(field);
          field = "";
        } else if (c === "\r") {
          // skip, \n (or end) will terminate the row
        } else if (c === "\n") {
          row.push(field);
          rows.push(row);
          row = [];
          field = "";
        } else {
          field += c;
        }
      }
    }
    if (field.length > 0 || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter(function (r) {
      return r.length > 1 || (r.length === 1 && r[0] !== "");
    });
  }

  function rowsToObjects(rows) {
    if (rows.length === 0) return [];
    var headers = rows[0].map(function (h) {
      return h.trim();
    });
    return rows.slice(1).map(function (r) {
      var obj = {};
      headers.forEach(function (h, idx) {
        obj[h] = r[idx] !== undefined ? r[idx].trim() : "";
      });
      return obj;
    });
  }

  function getField(row, name) {
    if (row[name] !== undefined) return row[name];
    var keys = Object.keys(row);
    var lowerKeys = keys.map(function (k) {
      return k.toLowerCase();
    });
    var candidates = ALIAS_MAP[name] ? ALIAS_MAP[name] : [name];
    for (var c = 0; c < candidates.length; c++) {
      var lowerCandidate = candidates[c].toLowerCase();
      var idx = lowerKeys.indexOf(lowerCandidate);
      if (idx !== -1) return row[keys[idx]];
    }
    return "";
  }

  function toNumberOrNull(v) {
    if (v === null || v === undefined || v === "") return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  }

  function toBool(v) {
    var u = String(v).trim().toUpperCase();
    return u === "TRUE" || u === "YES" || u === "Y" || u === "1";
  }

  function fetchCsv(path, cache) {
    if (cache.promise) return cache.promise;
    cache.promise = fetch(path)
      .then(function (res) {
        if (!res.ok) {
          throw new Error("Failed to load " + path + ": " + res.status);
        }
        return res.text();
      })
      .then(function (text) {
        return rowsToObjects(parseCSV(text));
      });
    return cache.promise;
  }

  function fetchRawDraftRows() {
    return fetchCsv(DRAFT_CSV_PATH, _draftCache).catch(function () {
      return []; // draft CSV is optional; board just won't render if absent
    });
  }

  /**
   * All parsed+normalized draft-pick rows for one season, sorted by
   * overall pick number ascending. `team` and `owner` are read directly
   * from the sheet - no cross-file join required.
   */
  function getDraftRows(year) {
    return fetchRawDraftRows().then(function (allRows) {
      return allRows
        .filter(function (r) {
          return Number(getField(r, "year")) === Number(year);
        })
        .map(function (r) {
          return {
            year: Number(getField(r, "year")),
            overallPick: toNumberOrNull(getField(r, "overall_pick")),
            round: toNumberOrNull(getField(r, "round")),
            roundPick: toNumberOrNull(getField(r, "round_pick")),
            team: getField(r, "team"),
            owner: getField(r, "owner"),
            playerId: getField(r, "player_id"),
            playerName: getField(r, "player_name"),
            isKeeper: toBool(getField(r, "keeper")),
          };
        })
        .sort(function (a, b) {
          return (a.overallPick || 0) - (b.overallPick || 0);
        });
    });
  }

  /**
   * Group picks by round, for rendering a round-by-round draft board
   * (mirrors the layout used for Sleeper draft boards elsewhere in the
   * site).
   */
  function buildDraftBoard(draftRows) {
    var roundsMap = {};
    draftRows.forEach(function (pick) {
      var round = pick.round || 0;
      if (!roundsMap[round]) roundsMap[round] = [];
      roundsMap[round].push(pick);
    });

    return Object.keys(roundsMap)
      .map(Number)
      .sort(function (a, b) {
        return a - b;
      })
      .map(function (round) {
        var picks = roundsMap[round].sort(function (a, b) {
          return (a.roundPick || 0) - (b.roundPick || 0);
        });
        return { round: round, picks: picks };
      });
  }

  /** Full draft history for one team (by team name), sorted by overall pick number. */
  function getTeamDraftHistory(draftRows, teamName) {
    return draftRows
      .filter(function (pick) {
        return pick.team === teamName;
      })
      .sort(function (a, b) {
        return (a.overallPick || 0) - (b.overallPick || 0);
      });
  }

  /**
   * High-level entry point: load and fully process one ESPN season's
   * draft. No rosterMap join needed since team + owner are both carried
   * directly on each row of the CSV.
   */
  function loadDraft(year) {
    return getDraftRows(year).then(function (rows) {
      var board = buildDraftBoard(rows);
      return {
        year: year,
        picks: rows,
        board: board,
        totalRounds: board.length,
        getTeamHistory: function (teamName) {
          return getTeamDraftHistory(rows, teamName);
        },
      };
    });
  }

  window.EspnDraftLoader = {
    loadDraft: loadDraft,
    getDraftRows: getDraftRows,
    buildDraftBoard: buildDraftBoard,
    getTeamDraftHistory: getTeamDraftHistory,
  };
})();
