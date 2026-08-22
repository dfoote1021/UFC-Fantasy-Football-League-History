/**
 * espn-loader.js
 * Loads and normalizes historical ESPN-era season data (2012-2021) from
 * local CSV files, producing data shapes compatible with sleeper-common.js
 * so season.js can render ESPN years through the same UI used for Sleeper
 * years, with no duplicate rendering logic.
 *
 * Data sources:
 *   assets/data/espn-matchups.csv   - week-by-week matchup results, playoffs
 *   assets/data/espn-standings.csv  - authoritative final win/loss/points/
 *                                     division per team per year (source of
 *                                     truth for the Standings tab)
 *
 * Matchups CSV columns: year,week,team,team_score,opponent,opponent_score,
 *   result,is_playoff,bracket_type,playoff_round,team_seed,opponent_seed
 *
 *   IMPORTANT: `result` is treated as informational only (it may contain
 *   WIN/LOSS, HOME/AWAY, or anything else depending on how the sheet was
 *   authored). The actual winner/loser/tie for every game is always
 *   determined by comparing team_score vs opponent_score directly, since
 *   scores are the one value guaranteed to be reliable and consistently
 *   formatted. The only exception is BYE weeks, detected when `opponent`
 *   is literally the string "BYE" (no opponent_score to compare against).
 *
 * Standings CSV columns (case-insensitive; header name ALIASES also
 * accepted - see ALIAS_MAP below - so "season" works the same as "year"
 * and "final_standing" works the same as "final_rank"):
 *   year (or season), team, division, division_standing, owner, wins,
 *   losses, ties, points_for, points_against, final_rank (or
 *   final_standing), made_playoffs, champion, runner_up
 *
 * Everything is wrapped in an IIFE and attached only to window.EspnLoader.
 */

(function () {
  "use strict";

  var ESPN_SEASONS = [2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021];
  var MATCHUPS_CSV_PATH = "assets/data/espn-matchups.csv";
  var STANDINGS_CSV_PATH = "assets/data/espn-standings.csv";

  /**
   * Canonical field name -> list of acceptable header spellings.
   * getField() checks each alias (case-insensitively) in order and
   * returns the first one present in the row. This means a CSV author
   * can use either name and the loader "just works" either way.
   */
  var ALIAS_MAP = {
    year: ["year", "season"],
    final_rank: ["final_rank", "final_standing", "finalstanding", "rank"],
  };

  var _matchupsCache = {};
  var _standingsCache = {};

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

  /**
   * Case-insensitive, alias-aware field lookup. `name` should be the
   * canonical field name (e.g. "year", "final_rank"). This checks the
   * exact key first (fast path), then any known aliases for that
   * canonical name, then finally falls back to a direct case-insensitive
   * match on `name` itself for fields with no aliases registered.
   */
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
    return String(v).trim().toUpperCase() === "TRUE";
  }

  /**
   * Determine W/L/T/BYE strictly from scores, ignoring whatever text is
   * in the `result` column (which may be WIN/LOSS, HOME/AWAY, etc. - its
   * wording is not reliable across different seasons/authors). `opponent`
   * literally equal to "BYE" (case-insensitive) is the only BYE signal.
   */
  function deriveResultFromScores(teamScore, opponentScore, opponentName) {
    if (String(opponentName).trim().toUpperCase() === "BYE") return "BYE";
    if (teamScore === null || opponentScore === null) return "";
    if (teamScore > opponentScore) return "W";
    if (teamScore < opponentScore) return "L";
    return "T";
  }

  function normalizeBracketType(v) {
    var u = String(v).trim().toLowerCase();
    if (u === "winners") return "winners";
    if (u === "consolation") return "consolation";
    return null;
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

  function fetchRawMatchupRows() {
    return fetchCsv(MATCHUPS_CSV_PATH, _matchupsCache);
  }

  function fetchRawStandingsRows() {
    return fetchCsv(STANDINGS_CSV_PATH, _standingsCache).catch(function () {
      return []; // standings CSV is optional; fall back to derived data if absent
    });
  }

  /** All parsed+normalized matchup rows for one season. */
  function getSeasonRows(year) {
    return fetchRawMatchupRows().then(function (allRows) {
      return allRows
        .filter(function (r) {
          return Number(getField(r, "year")) === Number(year);
        })
        .map(function (r) {
          var teamScore = toNumberOrNull(getField(r, "team_score"));
          var opponentScore = toNumberOrNull(getField(r, "opponent_score"));
          var opponent = getField(r, "opponent");

          return {
            year: Number(getField(r, "year")),
            week: Number(getField(r, "week")),
            team: getField(r, "team"),
            teamScore: teamScore,
            opponent: opponent,
            opponentScore: opponentScore,
            result: deriveResultFromScores(teamScore, opponentScore, opponent),
            isPlayoff: toBool(getField(r, "is_playoff")),
            bracketType: normalizeBracketType(getField(r, "bracket_type")),
            playoffRound: toNumberOrNull(getField(r, "playoff_round")),
            teamSeed: toNumberOrNull(getField(r, "team_seed")),
            opponentSeed: toNumberOrNull(getField(r, "opponent_seed")),
          };
        });
    });
  }

  /**
   * Authoritative final standings rows for one season, keyed by team name.
   * Reads: year (or season), team, division, division_standing, owner,
   * wins, losses, ties, points_for, points_against, final_rank (or
   * final_standing), made_playoffs, champion, runner_up. All lookups are
   * case-insensitive and alias-aware, see ALIAS_MAP and getField() above.
   */
  function getStandingsRows(year) {
    return fetchRawStandingsRows().then(function (allRows) {
      var byTeam = {};
      allRows
        .filter(function (r) {
          return Number(getField(r, "year")) === Number(year);
        })
        .forEach(function (r) {
          var team = getField(r, "team");
          byTeam[team] = {
            team: team,
            owner: getField(r, "owner"),
            division: getField(r, "division") || null,
            divisionStanding: toNumberOrNull(getField(r, "division_standing")),
            wins: toNumberOrNull(getField(r, "wins")) || 0,
            losses: toNumberOrNull(getField(r, "losses")) || 0,
            ties: toNumberOrNull(getField(r, "ties")) || 0,
            pointsFor: toNumberOrNull(getField(r, "points_for")) || 0,
            pointsAgainst: toNumberOrNull(getField(r, "points_against")) || 0,
            finalRank: toNumberOrNull(getField(r, "final_rank")),
            madePlayoffs: toBool(getField(r, "made_playoffs")),
            champion: toBool(getField(r, "champion")),
            runnerUp: toBool(getField(r, "runner_up")),
          };
        });
      return byTeam;
    });
  }

  /** Distinct team names appearing anywhere in a season's matchup rows (excluding BYE). */
  function getTeamsForSeason(rows) {
    var names = {};
    rows.forEach(function (r) {
      if (r.team && r.team !== "BYE") names[r.team] = true;
      if (r.opponent && r.opponent !== "BYE") names[r.opponent] = true;
    });
    return Object.keys(names);
  }

  /**
   * Build a rosterMap-shaped object. If authoritative standingsRows are
   * available for this team, those win/loss/points/division values are
   * used directly (source of truth). Otherwise falls back to deriving
   * totals by summing regular-season matchup rows.
   */
  function buildRosterMap(rows, standingsRows) {
    var matchupTeams = getTeamsForSeason(rows);
    var standingsTeams = standingsRows ? Object.keys(standingsRows) : [];
    var allTeamNames = {};
    matchupTeams.forEach(function (t) {
      allTeamNames[t] = true;
    });
    standingsTeams.forEach(function (t) {
      allTeamNames[t] = true;
    });
    var teams = Object.keys(allTeamNames);

    var rosterMap = {};

    teams.forEach(function (team) {
      rosterMap[team] = {
        rosterId: team,
        ownerId: team,
        teamName: team,
        displayName: team,
        avatar: null,
        division: null,
        divisionStanding: null,
        wins: 0,
        losses: 0,
        ties: 0,
        fpts: 0,
        fptsAgainst: 0,
        waiverBudgetUsed: 0,
        totalMoves: 0,
        starters: [],
        players: [],
        finalRank: null,
        madePlayoffs: null,
        isChampionFlag: false,
        isRunnerUpFlag: false,
      };
    });

    var hasStandings = standingsRows && Object.keys(standingsRows).length > 0;

    if (hasStandings) {
      Object.keys(rosterMap).forEach(function (team) {
        var s = standingsRows[team];
        if (!s) return;
        rosterMap[team].displayName = s.owner || team;
        rosterMap[team].division = s.division;
        rosterMap[team].divisionStanding = s.divisionStanding;
        rosterMap[team].wins = s.wins;
        rosterMap[team].losses = s.losses;
        rosterMap[team].ties = s.ties;
        rosterMap[team].fpts = Math.round(s.pointsFor * 100) / 100;
        rosterMap[team].fptsAgainst = Math.round(s.pointsAgainst * 100) / 100;
        rosterMap[team].finalRank = s.finalRank;
        rosterMap[team].madePlayoffs = s.madePlayoffs;
        rosterMap[team].isChampionFlag = s.champion;
        rosterMap[team].isRunnerUpFlag = s.runnerUp;
      });
    } else {
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
      });
      Object.keys(rosterMap).forEach(function (team) {
        rosterMap[team].fpts = Math.round(rosterMap[team].fpts * 100) / 100;
        rosterMap[team].fptsAgainst = Math.round(rosterMap[team].fptsAgainst * 100) / 100;
      });
    }

    return rosterMap;
  }

  function sortStandings(rosterMap) {
    return Object.keys(rosterMap)
      .map(function (k) {
        return rosterMap[k];
      })
      .sort(function (a, b) {
        if (a.finalRank !== null && b.finalRank !== null && a.finalRank !== b.finalRank) {
          return a.finalRank - b.finalRank;
        }
        if (b.wins !== a.wins) return b.wins - a.wins;
        return b.fpts - a.fpts;
      });
  }

  function buildSeedMap(rosterMap) {
    var standings = sortStandings(rosterMap);
    var seedMap = {};
    standings.forEach(function (team, idx) {
      seedMap[team.rosterId] = idx + 1;
    });
    return seedMap;
  }

  /**
   * Group standings by division (if the standings CSV supplied division
   * values for this season). Returns null if no team has a division set,
   * matching the behavior of the Sleeper-side division standings so the
   * "Final Standings by Division" section hides itself cleanly when a
   * season didn't use divisions.
   */
  function buildDivisionStandings(rosterMap, finalStandingsInfo) {
    var teams = Object.keys(rosterMap).map(function (k) {
      return rosterMap[k];
    });
    var hasDivisions = teams.some(function (t) {
      return t.division;
    });
    if (!hasDivisions) return null;

    var champion = finalStandingsInfo ? finalStandingsInfo.champion : null;
    var runnerUp = finalStandingsInfo ? finalStandingsInfo.runnerUp : null;

    var groups = {};
    teams.forEach(function (team) {
      var div = team.division || "Unassigned";
      if (!groups[div]) groups[div] = [];
      groups[div].push(team);
    });

    return Object.keys(groups)
      .sort()
      .map(function (divName) {
        var divTeams = groups[divName].sort(function (a, b) {
          if (a.divisionStanding !== null && b.divisionStanding !== null) {
            return a.divisionStanding - b.divisionStanding;
          }
          if (b.wins !== a.wins) return b.wins - a.wins;
          return b.fpts - a.fpts;
        });
        return {
          divisionNum: divName,
          divisionName: divName,
          standings: divTeams,
          champion: champion,
          runnerUp: runnerUp,
        };
      });
  }

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

  /**
   * Compute each team's running (cumulative) record through and including
   * a given week, for the regular season only. Returns a map of
   * teamName -> "W-L" (or "W-L-T" if any ties) string as of that week.
   */
  function buildRunningRecordsThroughWeek(rows, week) {
    var regularRows = rows.filter(function (r) {
      return !r.isPlayoff && r.week <= week;
    });

    var teams = getTeamsForSeason(rows);
    var tally = {};
    teams.forEach(function (t) {
      tally[t] = { wins: 0, losses: 0, ties: 0 };
    });

    var weeksSorted = {};
    regularRows.forEach(function (r) {
      if (!weeksSorted[r.week]) weeksSorted[r.week] = [];
      weeksSorted[r.week].push(r);
    });

    Object.keys(weeksSorted)
      .map(Number)
      .sort(function (a, b) {
        return a - b;
      })
      .forEach(function (w) {
        weeksSorted[w].forEach(function (r) {
          var t = tally[r.team];
          if (!t) return;
          if (r.result === "W") t.wins += 1;
          else if (r.result === "L") t.losses += 1;
          else if (r.result === "T") t.ties += 1;
        });
      });

    var recordStrings = {};
    Object.keys(tally).forEach(function (team) {
      var t = tally[team];
      recordStrings[team] =
        t.ties > 0 ? t.wins + "-" + t.losses + "-" + t.ties : t.wins + "-" + t.losses;
    });
    return recordStrings;
  }

  /**
   * Precompute running records for every regular-season week in one pass,
   * returning { week: { teamName: "W-L" } }.
   */
  function buildAllRunningRecords(rows) {
    var weeks = getWeeksForSeason(rows).filter(function (w) {
      return rows.some(function (r) {
        return r.week === w && !r.isPlayoff;
      });
    });
    var result = {};
    weeks.forEach(function (w) {
      result[w] = buildRunningRecordsThroughWeek(rows, w);
    });
    return result;
  }

  /**
   * Full season schedule for one team, with an added `recordAfter` field
   * showing the team's cumulative regular-season record immediately
   * following that week's game. Playoff weeks show "-" since they don't
   * affect regular season record.
   */
  function buildTeamSchedule(rows, teamName) {
    var runningWins = 0;
    var runningLosses = 0;
    var runningTies = 0;

    return rows
      .filter(function (r) {
        return r.team === teamName;
      })
      .sort(function (a, b) {
        return a.week - b.week;
      })
      .map(function (r) {
        var recordAfter = "-";
        if (!r.isPlayoff) {
          if (r.result === "W") runningWins += 1;
          else if (r.result === "L") runningLosses += 1;
          else if (r.result === "T") runningTies += 1;
          recordAfter =
            runningTies > 0
              ? runningWins + "-" + runningLosses + "-" + runningTies
              : runningWins + "-" + runningLosses;
        }

        return {
          week: r.week,
          opponentRosterId: r.opponent,
          opponentName: r.opponent,
          myPoints: r.teamScore || 0,
          opponentPoints: r.opponent === "BYE" ? null : r.opponentScore,
          result: r.result,
          isPlayoff: r.isPlayoff,
          recordAfter: recordAfter,
        };
      });
  }

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
      if (isBye) {
        winnerRosterId = r.team;
      } else if (r.result === "W") {
        winnerRosterId = r.team;
      } else if (r.result === "L") {
        winnerRosterId = r.opponent;
      }

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

  /**
   * Determine champion/runner-up. Prefers explicit champion/runner_up flags
   * from the standings CSV (authoritative); falls back to inferring from
   * the final round of the winners bracket if those flags are absent.
   */
  function buildFinalStandings(rosterMap, rows) {
    var standings = sortStandings(rosterMap);
    var winnersRounds = buildBracketView(rows, "winners");

    var champion = null;
    var runnerUp = null;

    var flaggedChampion = Object.keys(rosterMap).find(function (t) {
      return rosterMap[t].isChampionFlag;
    });
    var flaggedRunnerUp = Object.keys(rosterMap).find(function (t) {
      return rosterMap[t].isRunnerUpFlag;
    });

    if (flaggedChampion) {
      champion = rosterMap[flaggedChampion];
      runnerUp = flaggedRunnerUp ? rosterMap[flaggedRunnerUp] : null;
    } else if (winnersRounds.length > 0) {
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
   * High-level entry point: load and fully process one ESPN season.
   */
  function loadSeason(year) {
    return Promise.all([getSeasonRows(year), getStandingsRows(year)]).then(function (results) {
      var rows = results[0];
      var standingsRows = results[1];

      var rosterMap = buildRosterMap(rows, standingsRows);
      var seedMap = buildSeedMap(rosterMap);
      var weeks = getWeeksForSeason(rows);
      var winnersBracket = buildBracketView(rows, "winners");
      var consolationBracket = buildBracketView(rows, "consolation");
      var finalStandingsInfo = buildFinalStandings(rosterMap, rows);
      var divisionStandings = buildDivisionStandings(rosterMap, finalStandingsInfo);
      var runningRecordsByWeek = buildAllRunningRecords(rows);

      return {
        year: year,
        rows: rows,
        rosterMap: rosterMap,
        seedMap: seedMap,
        weeks: weeks,
        winnersBracket: winnersBracket,
        consolationBracket: consolationBracket,
        finalStandingsInfo: finalStandingsInfo,
        divisionStandings: divisionStandings,
        runningRecordsByWeek: runningRecordsByWeek,
        getMatchupsForWeek: function (week) {
          var pairs = pairMatchupsForWeek(rows, week, rosterMap);
          var recordsThisWeek = runningRecordsByWeek[week] || {};
          pairs.forEach(function (pair) {
            pair.teamA.recordAfter = recordsThisWeek[pair.teamA.rosterId] || null;
            if (pair.teamB) {
              pair.teamB.recordAfter = recordsThisWeek[pair.teamB.rosterId] || null;
            }
          });
          return pairs;
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
    getStandingsRows: getStandingsRows,
    buildRosterMap: buildRosterMap,
    sortStandings: sortStandings,
    buildSeedMap: buildSeedMap,
    buildDivisionStandings: buildDivisionStandings,
    getWeeksForSeason: getWeeksForSeason,
    pairMatchupsForWeek: pairMatchupsForWeek,
    buildTeamSchedule: buildTeamSchedule,
    buildBracketView: buildBracketView,
    buildFinalStandings: buildFinalStandings,
    buildRunningRecordsThroughWeek: buildRunningRecordsThroughWeek,
    buildAllRunningRecords: buildAllRunningRecords,
  };
})();
