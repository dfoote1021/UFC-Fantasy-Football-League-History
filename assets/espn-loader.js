/**
 * espn-loader.js
 * Loads and normalizes historical ESPN-era season data (2012-2021) from a
 * local CSV file, producing the exact same data shapes that
 * sleeper-common.js produces for Sleeper seasons. This lets season.js
 * render ESPN years through the identical Standings / Matchups / Bracket
 * UI code used for Sleeper years, with no duplicate rendering logic.
 *
 * Data source: assets/data/espn-matchups.csv
 * Columns: year,week,team,team_score,opponent,opponent_score,result,
 *          is_playoff,bracket_type,playoff_round,team_seed,opponent_seed
 *
 * result is one of: WIN, LOSS, TIE, BYE (from the perspective of `team`).
 * bracket_type is one of: Winners, Consolation (case-insensitive, blank
 * for regular season rows).
 *
 * Everything is wrapped in an IIFE and attached only to window.EspnLoader,
 * mirroring the defensive pattern used in sleeper-common.js.
 */

(function () {
  "use strict";

  var ESPN_SEASONS = [2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021];
  var MATCHUPS_CSV_PATH = "assets/data/espn-matchups.csv";

  var _rawRowsPromise = null;

  /** Minimal CSV parser: handles quoted fields, commas inside quotes, CRLF/LF. */
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

  function toNumberOrNull(v) {
    if (v === null || v === undefined || v === "") return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  }

  function toBool(v) {
    return String(v).trim().toUpperCase() === "TRUE";
  }

  /** Normalize the result column (WIN/LOSS/TIE/BYE) into W/L/T/BYE used internally. */
  function normalizeResult(v) {
    var u = String(v).trim().toUpperCase();
    if (u === "WIN") return "W";
    if (u === "LOSS") return "L";
    if (u === "TIE") return "T";
    if (u === "BYE") return "BYE";
    return u;
  }

  function normalizeBracketType(v) {
    var u = String(v).trim().toLowerCase();
    if (u === "winners") return "winners";
    if (u === "consolation") return "consolation";
    return null;
  }

  function fetchRawRows() {
    if (_rawRowsPromise) return _rawRowsPromise;
    _rawRowsPromise = fetch(MATCHUPS_CSV_PATH)
      .then(function (res) {
        if (!res.ok) {
          throw new Error("Failed to load ESPN matchups CSV: " + res.status);
        }
        return res.text();
      })
      .then(function (text) {
        return rowsToObjects(parseCSV(text));
      });
    return _rawRowsPromise;
  }

  /** All parsed+normalized rows for one season. */
  function getSeasonRows(year) {
    return fetchRawRows().then(function (allRows) {
      return allRows
        .filter(function (r) {
          return Number(r.year) === Number(year);
        })
        .map(function (r) {
          return {
            year: Number(r.year),
            week: Number(r.week),
            team: r.team,
            teamScore: toNumberOrNull(r.team_score),
            opponent: r.opponent,
            opponentScore: toNumberOrNull(r.opponent_score),
            result: normalizeResult(r.result),
            isPlayoff: toBool(r.is_playoff),
            bracketType: normalizeBracketType(r.bracket_type),
            playoffRound: toNumberOrNull(r.playoff_round),
            teamSeed: toNumberOrNull(r.team_seed),
            opponentSeed: toNumberOrNull(r.opponent_seed),
          };
        });
    });
  }

  /** Distinct team names appearing anywhere in a season's rows (excluding BYE). */
  function getTeamsForSeason(rows) {
    var names = {};
    rows.forEach(function (r) {
      if (r.team && r.team !== "BYE") names[r.team] = true;
      if (r.opponent && r.opponent !== "BYE") names[r.opponent] = true;
    });
    return Object.keys(names);
  }

  /**
   * Build a rosterMap-shaped object compatible with SleeperAPI.sortStandings /
   * buildFinalStandings. Since ESPN data has no numeric roster_id, team name
   * itself is used as the id (rosterId = team name string).
   */
  function buildRosterMap(rows) {
    var teams = getTeamsForSeason(rows);
    var rosterMap = {};

    teams.forEach(function (team) {
      rosterMap[team] = {
        rosterId: team,
        ownerId: team,
        teamName: team,
        displayName: team,
        avatar: null,
        division: null,
        wins: 0,
        losses: 0,
        ties: 0,
        fpts: 0,
        fptsAgainst: 0,
        waiverBudgetUsed: 0,
        totalMoves: 0,
        starters: [],
        players: [],
      };
    });

    var regularRows = rows.filter(function (r) {
      return !r.isPlayoff;
    });

    regularRows.forEach(function (r) {
      var team = rosterMap[r.team];
      if (!team) return;
      if (r.teamScore !== null) team.fpts += r.teamScore;
      if (r.opponentScore !== null) team.fptsAgainst += r.opponentScore;
      if (r.result === "W") team.wins += 1;
      else if (r.result === "L") team.losses += 1;
      else if (r.result === "T") team.ties += 1;
      // BYE rows in the regular season do not affect win/loss/tie counts.
    });

    Object.keys(rosterMap).forEach(function (team) {
      rosterMap[team].fpts = Math.round(rosterMap[team].fpts * 100) / 100;
      rosterMap[team].fptsAgainst = Math.round(rosterMap[team].fptsAgainst * 100) / 100;
    });

    return rosterMap;
  }

  /** Sort standings the same way SleeperAPI.sortStandings does. */
  function sortStandings(rosterMap) {
    return Object.keys(rosterMap)
      .map(function (k) {
        return rosterMap[k];
      })
      .sort(function (a, b) {
        if (b.wins !== a.wins) return b.wins - a.wins;
        return b.fpts - a.fpts;
      });
  }

  /** Seed map derived from regular-season standings (1 = best record). */
  function buildSeedMap(rosterMap) {
    var standings = sortStandings(rosterMap);
    var seedMap = {};
    standings.forEach(function (team, idx) {
      seedMap[team.rosterId] = idx + 1;
    });
    return seedMap;
  }

  /** All distinct weeks present for a season, sorted ascending. */
  function getWeeksForSeason(rows) {
    var weeks = {};
    rows.forEach(function (r) {
      weeks[r.week] = true;
    });
    return Object.keys(weeks)
      .map(Number)
      .sort(function (a, b) {
        return a - b;
      });
  }

  /**
   * Build matchup pairs for one week, in the same {teamA, teamB} shape
   * SleeperAPI.pairMatchups produces (minus per-player roster data, which
   * ESPN weekly-rosters CSV would supply separately if loaded).
   */
  function pairMatchupsForWeek(rows, week, rosterMap) {
    var weekRows = rows.filter(function (r) {
      return r.week === week;
    });

    var seen = {};
    var pairs = [];

    weekRows.forEach(function (r) {
      var key1 = r.team + "|" + r.opponent + "|" + week;
      var key2 = r.opponent + "|" + r.team + "|" + week;
      if (seen[key1] || seen[key2]) return;
      seen[key1] = true;

      var teamAInfo = rosterMap[r.team] || { teamName: r.team, rosterId: r.team };
      var teamA = Object.assign({}, teamAInfo, {
        points: r.teamScore || 0,
        starters: [],
        players: [],
        players_points: {},
      });

      var teamB = null;
      if (r.opponent && r.opponent !== "BYE") {
        var teamBInfo = rosterMap[r.opponent] || { teamName: r.opponent, rosterId: r.opponent };
        teamB = Object.assign({}, teamBInfo, {
          points: r.opponentScore || 0,
          starters: [],
          players: [],
          players_points: {},
        });
      }

      pairs.push({
        matchupId: r.team + "-" + r.opponent + "-" + week,
        teamA: teamA,
        teamB: teamB,
      });
    });

    return pairs;
  }

  /** Full season schedule for one team, matching SleeperAPI.buildTeamSchedule's shape. */
  function buildTeamSchedule(rows, teamName) {
    return rows
      .filter(function (r) {
        return r.team === teamName && !r.isPlayoff;
      })
      .sort(function (a, b) {
        return a.week - b.week;
      })
      .map(function (r) {
        return {
          week: r.week,
          opponentRosterId: r.opponent,
          opponentName: r.opponent,
          myPoints: r.teamScore || 0,
          opponentPoints: r.opponent === "BYE" ? null : r.opponentScore,
          result: r.result,
        };
      });
  }

  /**
   * Build a bracket view (winners or consolation) matching the shape
   * SleeperAPI.buildBracketView produces, so the existing bracket renderer
   * in season.js works unmodified. ESPN data already has explicit outcomes
   * recorded per game, so no "Winner of Match X" placeholders are needed -
   * every round is fully resolved historical fact.
   */
  function buildBracketView(rows, bracketType) {
    var playoffRows = rows.filter(function (r) {
      return r.isPlayoff && r.bracketType === bracketType;
    });

    if (playoffRows.length === 0) return [];

    var seen = {};
    var roundsMap = {};

    playoffRows.forEach(function (r) {
      var round = r.playoffRound;
      var key1 = round + "|" + r.team + "|" + r.opponent;
      var key2 = round + "|" + r.opponent + "|" + r.team;
      if (seen[key1] || seen[key2]) return;
      seen[key1] = true;

      var isBye = r.opponent === "BYE";

      var slot1 = {
        rosterId: r.team,
        teamName: r.team,
        seed: r.teamSeed,
        resolved: true,
      };
      var slot2 = isBye
        ? { rosterId: null, teamName: "BYE", seed: null, resolved: false }
        : {
            rosterId: r.opponent,
            teamName: r.opponent,
            seed: r.opponentSeed,
            resolved: true,
          };

      var winnerRosterId = null;
      if (r.result === "W") winnerRosterId = r.team;
      else if (r.result === "L") winnerRosterId = isBye ? r.team : r.opponent;
      else if (r.result === "BYE") winnerRosterId = r.team;

      if (!roundsMap[round]) roundsMap[round] = [];
      roundsMap[round].push({
        matchId: round + "-" + r.team + "-" + r.opponent,
        position: null,
        week: r.week,
        slot1: slot1,
        slot1Score: r.teamScore,
        slot2: slot2,
        slot2Score: isBye ? null : r.opponentScore,
        winnerRosterId: winnerRosterId,
        loserRosterId: isBye ? null : winnerRosterId === r.team ? r.opponent : r.team,
      });
    });

    return Object.keys(roundsMap)
      .sort(function (a, b) {
        return Number(a) - Number(b);
      })
      .map(function (r) {
        return { round: Number(r), matches: roundsMap[r] };
      });
  }

  /** Determine champion/runner-up from the final round of the winners bracket. */
  function buildFinalStandings(rosterMap, rows) {
    var standings = sortStandings(rosterMap);
    var winnersRounds = buildBracketView(rows, "winners");

    var champion = null;
    var runnerUp = null;

    if (winnersRounds.length > 0) {
      var lastRound = winnersRounds[winnersRounds.length - 1];
      var champMatch =
        lastRound.matches.length === 1
          ? lastRound.matches[0]
          : lastRound.matches.reduce(function (best, m) {
              var bestSeed = Math.min(best.slot1.seed || 99, best.slot2.seed || 99);
              var mSeed = Math.min(m.slot1.seed || 99, m.slot2.seed || 99);
              return mSeed < bestSeed ? m : best;
            }, lastRound.matches[0]);

      if (champMatch && champMatch.winnerRosterId) {
        champion = rosterMap[champMatch.winnerRosterId] || null;
        var loserId = champMatch.loserRosterId;
        runnerUp = loserId ? rosterMap[loserId] || null : null;
      }
    }

    if (champion) {
      standings = standings.filter(function (t) {
        return t.rosterId !== champion.rosterId;
      });
      standings.unshift(champion);
    }
    if (runnerUp) {
      standings = standings.filter(function (t) {
        return t.rosterId !== runnerUp.rosterId || t === champion;
      });
      var idx = standings.findIndex(function (t) {
        return t.rosterId === runnerUp.rosterId;
      });
      if (idx > 0) standings.splice(idx, 1);
      standings.splice(champion ? 1 : 0, 0, runnerUp);
    }

    return {
      standings: standings,
      champion: champion,
      runnerUp: runnerUp,
      playoffRounds: winnersRounds,
    };
  }

  /**
   * High-level entry point: load and fully process one ESPN season, returning
   * everything season.js needs in the same shapes SleeperAPI produces.
   */
  function loadSeason(year) {
    return getSeasonRows(year).then(function (rows) {
      var rosterMap = buildRosterMap(rows);
      var seedMap = buildSeedMap(rosterMap);
      var weeks = getWeeksForSeason(rows);
      var winnersBracket = buildBracketView(rows, "winners");
      var consolationBracket = buildBracketView(rows, "consolation");
      var finalStandingsInfo = buildFinalStandings(rosterMap, rows);

      return {
        year: year,
        rows: rows,
        rosterMap: rosterMap,
        seedMap: seedMap,
        weeks: weeks,
        winnersBracket: winnersBracket,
        consolationBracket: consolationBracket,
        finalStandingsInfo: finalStandingsInfo,
        getMatchupsForWeek: function (week) {
          return pairMatchupsForWeek(rows, week, rosterMap);
        },
        getTeamSchedule: function (teamName) {
          return buildTeamSchedule(rows, teamName);
        },
      };
    });
  }

  window.EspnLoader = {
    ESPN_SEASONS: ESPN_SEASONS,
    loadSeason: loadSeason,
    getSeasonRows: getSeasonRows,
    buildRosterMap: buildRosterMap,
    sortStandings: sortStandings,
    buildSeedMap: buildSeedMap,
    getWeeksForSeason: getWeeksForSeason,
    pairMatchupsForWeek: pairMatchupsForWeek,
    buildTeamSchedule: buildTeamSchedule,
    buildBracketView: buildBracketView,
    buildFinalStandings: buildFinalStandings,
  };
})();
