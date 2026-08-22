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
 * ── IMPORTANT: one row per GAME, not per team ───────────────────────────
 * espn-matchups.csv has exactly one row per game (12 teams = 6 rows per
 * week), with a "team" side and an "opponent" side. Any code that derives
 * wins/losses/points from these rows MUST credit BOTH sides of every row -
 * crediting only the `team` column and ignoring `opponent` silently drops
 * half the league's results. This file is careful to do that everywhere
 * records are derived (see buildRunningRecordsThroughWeek below).
 *
 * ── IMPORTANT: how teams are matched across the two files ──────────────
 * Fantasy team NAMES change from year to year (e.g. the same owner might
 * be "Team McFarland" in 2012 and "Caucasion Sasquatch" in 2013), but the
 * OWNER behind a team is stable. So this loader joins standings rows to
 * matchup rows using `owner` (case-insensitive, trimmed) as the primary
 * key for a given year, not the team display name. The real team name
 * shown throughout the site always comes from espn-matchups.csv (since
 * that's the fun display name), while wins/losses/points/division/
 * champion flags come from espn-standings.csv via the owner match.
 *
 * Matchups CSV columns: year,week,team,team_owner,team_score,opponent,
 *   opponent_owner,opponent_score,result,is_playoff,bracket_type,
 *   playoff_round,team_seed,opponent_seed
 *
 *   `result` is treated as informational only (it may say WIN/LOSS,
 *   HOME/AWAY, or anything else). The actual winner/loser/tie is always
 *   computed by comparing team_score vs opponent_score directly. BYE is
 *   detected when `opponent` is literally the string "BYE".
 *
 * Standings CSV columns (case-insensitive; common header aliases such as
 * "season" for "year" and "final_standing" for "final_rank" are accepted
 * automatically - see ALIAS_MAP below):
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

  var ALIAS_MAP = {
    year: ["year", "season"],
    final_rank: ["final_rank", "final_standing", "finalstanding", "rank"],
  };

  var _matchupsCache = {};
  var _standingsCache = {};

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

  function normalizeKey(v) {
    return String(v || "").trim().toLowerCase();
  }

  function toNumberOrNull(v) {
    if (v === null || v === undefined || v === "") return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  }

  function toBool(v) {
    return String(v).trim().toUpperCase() === "TRUE";
  }

  function deriveResultFromScores(teamScore, opponentScore, opponentName) {
    if (String(opponentName).trim().toUpperCase() === "BYE") return "BYE";
    if (teamScore === null || opponentScore === null) return "";
    if (teamScore > opponentScore) return "W";
    if (teamScore < opponentScore) return "L";
    return "T";
  }

  /** Inverse of a team-side result, for crediting the opponent side of the same row. */
  function invertResult(result) {
    if (result === "W") return "L";
    if (result === "L") return "W";
    return result; // T and BYE mirror themselves
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
      return [];
    });
  }

  /**
   * All parsed+normalized matchup rows for one season. Each CSV row
   * represents ONE game (both sides), not one team - `result` here is
   * always from the `team` side's perspective; use invertResult() when
   * you need the opponent side's outcome for the same row.
   */
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
          var team = getField(r, "team");
          var teamOwner = getField(r, "team_owner") || getField(r, "owner");
          var opponentOwner = getField(r, "opponent_owner");

          return {
            year: Number(getField(r, "year")),
            week: Number(getField(r, "week")),
            team: team,
            teamOwner: teamOwner,
            teamScore: teamScore,
            opponent: opponent,
            opponentOwner: opponentOwner,
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
   * Authoritative final standings rows for one season, keyed by OWNER
   * (normalized lowercase/trimmed) so they can be joined reliably to
   * matchup rows even when the team display name changed that year.
   * Also indexed by team name as a fallback for sheets without owner
   * filled in.
   */
  function getStandingsRows(year) {
    return fetchRawStandingsRows().then(function (allRows) {
      var byOwner = {};
      var byTeamName = {};

      allRows
        .filter(function (r) {
          return Number(getField(r, "year")) === Number(year);
        })
        .forEach(function (r) {
          var team = getField(r, "team");
          var owner = getField(r, "owner");
          var entry = {
            team: team,
            owner: owner,
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
          if (owner) byOwner[normalizeKey(owner)] = entry;
          if (team) byTeamName[normalizeKey(team)] = entry;
        });

      return { byOwner: byOwner, byTeamName: byTeamName };
    });
  }

  function resolveStandingsEntry(standingsIndex, teamName, teamOwner) {
    if (teamOwner) {
      var byOwnerHit = standingsIndex.byOwner[normalizeKey(teamOwner)];
      if (byOwnerHit) return byOwnerHit;
    }
    if (teamName) {
      var byNameHit = standingsIndex.byTeamName[normalizeKey(teamName)];
      if (byNameHit) return byNameHit;
    }
    return null;
  }

  /** Distinct team names appearing anywhere in a season's matchup rows (excluding BYE), with owner attached. */
  function getTeamsForSeason(rows) {
    var teams = {};
    rows.forEach(function (r) {
      if (r.team && r.team !== "BYE" && !teams[r.team]) {
        teams[r.team] = r.teamOwner || "";
      }
      if (r.opponent && r.opponent !== "BYE" && !teams[r.opponent]) {
        teams[r.opponent] = r.opponentOwner || "";
      }
    });
    return teams; // { teamName: ownerName }
  }

  function buildRosterMap(rows, standingsIndex) {
    var teamOwnerMap = getTeamsForSeason(rows);
    var teamNames = Object.keys(teamOwnerMap);

    var hasStandings =
      standingsIndex &&
      (Object.keys(standingsIndex.byOwner).length > 0 ||
        Object.keys(standingsIndex.byTeamName).length > 0);

    var rosterMap = {};

    teamNames.forEach(function (team) {
      var owner = teamOwnerMap[team];
      var standingsEntry = hasStandings
        ? resolveStandingsEntry(standingsIndex, team, owner)
        : null;

      rosterMap[team] = {
        rosterId: team,
        ownerId: owner || team,
        teamName: team,
        displayName: owner || (standingsEntry ? standingsEntry.owner : team) || team,
        avatar: null,
        division: standingsEntry ? standingsEntry.division : null,
        divisionStanding: standingsEntry ? standingsEntry.divisionStanding : null,
        wins: standingsEntry ? standingsEntry.wins : 0,
        losses: standingsEntry ? standingsEntry.losses : 0,
        ties: standingsEntry ? standingsEntry.ties : 0,
        fpts: standingsEntry ? Math.round(standingsEntry.pointsFor * 100) / 100 : 0,
        fptsAgainst: standingsEntry
          ? Math.round(standingsEntry.pointsAgainst * 100) / 100
          : 0,
        waiverBudgetUsed: 0,
        totalMoves: 0,
        starters: [],
        players: [],
        finalRank: standingsEntry ? standingsEntry.finalRank : null,
        madePlayoffs: standingsEntry ? standingsEntry.madePlayoffs : null,
        isChampionFlag: standingsEntry ? standingsEntry.champion : false,
        isRunnerUpFlag: standingsEntry ? standingsEntry.runnerUp : false,
        _hasStandingsMatch: !!standingsEntry,
      };
    });

    if (!hasStandings) {
      var regularRows = rows.filter(function (r) {
        return !r.isPlayoff;
      });
      regularRows.forEach(function (r) {
        var teamSide = rosterMap[r.team];
        var oppSide = rosterMap[r.opponent];
        var oppResult = invertResult(r.result);

        if (teamSide) {
          if (r.teamScore !== null) teamSide.fpts += r.teamScore;
          if (r.opponentScore !== null) teamSide.fptsAgainst += r.opponentScore;
          if (r.result === "W") teamSide.wins += 1;
          else if (r.result === "L") teamSide.losses += 1;
          else if (r.result === "T") teamSide.ties += 1;
        }
        if (oppSide && r.opponent !== "BYE") {
          if (r.opponentScore !== null) oppSide.fpts += r.opponentScore;
          if (r.teamScore !== null) oppSide.fptsAgainst += r.teamScore;
          if (oppResult === "W") oppSide.wins += 1;
          else if (oppResult === "L") oppSide.losses += 1;
          else if (oppResult === "T") oppSide.ties += 1;
        }
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

    var pairs = [];

    weekRows.forEach(function (r) {
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
   * Compute every team's running (cumulative) record through and
   * including a given week, for the regular season only. Each matchup
   * row is one GAME (both sides) - so both the `team` side AND the
   * `opponent` side must be credited from the same row, using the
   * inverse result for the opponent. Failing to credit the opponent
   * side is what causes teams to appear stuck at 0-0 despite having
   * played real games.
   */
  function buildRunningRecordsThroughWeek(rows, week) {
    var regularRows = rows.filter(function (r) {
      return !r.isPlayoff && r.week <= week;
    });

    var teamOwnerMap = getTeamsForSeason(rows);
    var tally = {};
    Object.keys(teamOwnerMap).forEach(function (t) {
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
          var teamTally = tally[r.team];
          if (teamTally) {
            if (r.result === "W") teamTally.wins += 1;
            else if (r.result === "L") teamTally.losses += 1;
            else if (r.result === "T") teamTally.ties += 1;
          }

          if (r.opponent && r.opponent !== "BYE") {
            var oppTally = tally[r.opponent];
            if (oppTally) {
              var oppResult = invertResult(r.result);
              if (oppResult === "W") oppTally.wins += 1;
              else if (oppResult === "L") oppTally.losses += 1;
              else if (oppResult === "T") oppTally.ties += 1;
            }
          }
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
   * Full season schedule for one team. Since matchups CSV rows are keyed
   * by whichever side is listed as `team`, a team's full schedule must
   * include games where it appears as `team` AND games where it appears
   * as `opponent` (mirrored so the schedule always reads from that
   * team's own perspective).
   */
  function buildTeamSchedule(rows, teamName) {
    var asTeam = rows
      .filter(function (r) {
        return r.team === teamName;
      })
      .map(function (r) {
        return {
          week: r.week,
          opponentName: r.opponent,
          myPoints: r.teamScore || 0,
          opponentPoints: r.opponent === "BYE" ? null : r.opponentScore,
          result: r.result,
          isPlayoff: r.isPlayoff,
        };
      });

    var asOpponent = rows
      .filter(function (r) {
        return r.opponent === teamName;
      })
      .map(function (r) {
        return {
          week: r.week,
          opponentName: r.team,
          myPoints: r.opponentScore || 0,
          opponentPoints: r.teamScore,
          result: invertResult(r.result),
          isPlayoff: r.isPlayoff,
        };
      });

    var combined = asTeam.concat(asOpponent).sort(function (a, b) {
      return a.week - b.week;
    });

    var runningWins = 0;
    var runningLosses = 0;
    var runningTies = 0;

    return combined.map(function (game) {
      var recordAfter = "-";
      if (!game.isPlayoff) {
        if (game.result === "W") runningWins += 1;
        else if (game.result === "L") runningLosses += 1;
        else if (game.result === "T") runningTies += 1;
        recordAfter =
          runningTies > 0
            ? runningWins + "-" + runningLosses + "-" + runningTies
            : runningWins + "-" + runningLosses;
      }
      game.recordAfter = recordAfter;
      game.opponentRosterId = game.opponentName;
      return game;
    });
  }

  function buildBracketView(rows, bracketType) {
    var playoffRows = rows.filter(function (r) {
      return r.isPlayoff && r.bracketType === bracketType;
    });

    if (playoffRows.length === 0) return [];

    var roundsMap = {};

    playoffRows.forEach(function (r) {
      var round = r.playoffRound;
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

  function loadSeason(year) {
    return Promise.all([getSeasonRows(year), getStandingsRows(year)]).then(function (results) {
      var rows = results[0];
      var standingsIndex = results[1];

      var rosterMap = buildRosterMap(rows, standingsIndex);
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
