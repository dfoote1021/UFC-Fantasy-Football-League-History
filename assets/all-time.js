/**
 * all-time.js
 * Builds career (all-time, cross-season) statistics by loading every
 * ESPN CSV year AND every Sleeper league year, then aggregating by
 * OWNER display name - since that's the one identifier that stays
 * consistent for the same real person across both eras (ESPN CSVs
 * already use real names like "Dan"/"Spencer" as their owner column,
 * and owner-overrides.js maps Sleeper usernames to those same names).
 *
 * Two things this module produces:
 *   1. Career totals: one row per owner, W-L-T and points for/against
 *      split into REGULAR SEASON and PLAYOFFS separately (plus a
 *      combined total), championships, playoff appearances, seasons
 *      played - across every year of the league's history.
 *   2. Head-to-head: for any two owners, every individual matchup
 *      they've ever played against each other, with regular-season
 *      and playoff results broken out separately.
 *
 * Each game is classified into exactly one of three buckets:
 *   - "regular"     games during the normal season schedule.
 *   - "playoff"     games that are part of the actual WINNERS bracket
 *                   (the championship path).
 *   - "consolation" games played during playoff weeks by teams that
 *                   are NOT in the winners bracket that week (toilet
 *                   bowl / consolation ladder games, including
 *                   third-place or seeding games outside the title
 *                   path). These are excluded from both the regular
 *                   and playoff W-L/points totals, since they're
 *                   neither part of the real regular-season schedule
 *                   nor the championship bracket. They still appear
 *                   in the head-to-head game log (tagged "Consolation")
 *                   for transparency, just not in any aggregate totals.
 *
 * For Sleeper seasons, "playoff" is determined by cross-referencing
 * each playoff-week game's roster-id pair against the ACTUAL winners
 * bracket matchups for that round (round r maps to week
 * playoffStartWeek + r - 1) - not just "week >= playoffStartWeek",
 * which would incorrectly sweep in consolation-bracket games too.
 *
 * For ESPN seasons, the per-row bracket type from espn-loader.js is
 * used if available (checked defensively across a few possible field
 * names); otherwise the loader falls back to cross-referencing against
 * the winners bracket built by EspnLoader, same as Sleeper.
 *
 * This is intentionally a separate module from season.js/espn-loader.js
 * /sleeper-common.js - it READS data through those existing loaders
 * (EspnLoader.loadSeason, SleeperAPI.*) rather than duplicating any
 * parsing logic, so a fix made in one of those files automatically
 * flows through to the all-time aggregation too.
 *
 * Everything is wrapped in an IIFE and attached only to window.AllTimeStats.
 */

(function () {
  "use strict";

  var _allSeasonsCache = null;

  function normalizeOwnerKey(name) {
    return String(name || "").trim().toLowerCase();
  }

  function pairKey(rosterIdA, rosterIdB) {
    var a = String(rosterIdA);
    var b = String(rosterIdB);
    return a < b ? a + "|" + b : b + "|" + a;
  }

  function newSplitRecord() {
    return {
      wins: 0,
      losses: 0,
      ties: 0,
      pointsFor: 0,
      pointsAgainst: 0,
    };
  }

  /**
   * Builds the set of valid winners-bracket roster-id pairings, keyed
   * by week, from a Sleeper-style winners bracket array (entries with
   * {r: round, t1, t2}). Round r is assumed to map to week
   * playoffStartWeek + r - 1, which matches how Sleeper brackets are
   * laid out (one round per week).
   */
  function buildWinnersBracketPairsByWeek(winnersBracket, playoffStartWeek) {
    var pairsByWeek = {};
    if (!winnersBracket || !playoffStartWeek) return pairsByWeek;

    winnersBracket.forEach(function (m) {
      if (!m.t1 || !m.t2 || !m.r) return;
      var week = playoffStartWeek + (m.r - 1);
      if (!pairsByWeek[week]) pairsByWeek[week] = {};
      pairsByWeek[week][pairKey(m.t1, m.t2)] = true;
    });

    return pairsByWeek;
  }

  /**
   * Loads and normalizes ONE ESPN season into the shape used by the
   * aggregator: a list of per-team season summaries (championship /
   * runner-up / playoff-appearance flags only - no W-L here, those are
   * derived from games), plus a flat list of individual games (one
   * entry per game, with both owners' identities, scores, and a
   * gameType of "regular" | "playoff" | "consolation").
   *
   * Bracket-type detection order:
   *   1. If the CSV row itself exposes a bracket-type field
   *      (bracketType / isConsolation / isWinnersBracket / isLosersBracket),
   *      trust it directly - this is the most accurate source when present.
   *   2. Otherwise, cross-reference against EspnLoader's own
   *      winnersBracket for that season (same technique used for
   *      Sleeper) to tell playoff from consolation.
   *   3. If neither is available, fall back to treating every
   *      r.isPlayoff row as "playoff" (old behavior) so nothing breaks,
   *      but this case is logged so it's visible during QA.
   */
  function loadEspnSeasonForAllTime(year) {
    return window.EspnLoader.loadSeason(year).then(function (data) {
      var teamSummaries = Object.keys(data.rosterMap).map(function (teamKey) {
        var t = data.rosterMap[teamKey];
        return {
          year: year,
          source: "espn",
          ownerKey: normalizeOwnerKey(t.displayName || t.ownerId),
          ownerName: t.displayName || t.ownerId,
          teamName: t.teamName,
          madePlayoffs: !!t.madePlayoffs,
          isChampion: !!t.isChampionFlag,
          isRunnerUp: !!t.isRunnerUpFlag,
        };
      });

      var hasExplicitBracketField = (data.rows || []).some(function (r) {
        return (
          r.bracketType !== undefined ||
          r.isConsolation !== undefined ||
          r.isWinnersBracket !== undefined ||
          r.isLosersBracket !== undefined
        );
      });

      var winnersPairsByWeek = null;
      if (!hasExplicitBracketField && data.winnersBracket) {
        var espnPlayoffStartWeek = (data.rows || []).reduce(function (min, r) {
          return r.isPlayoff && r.week < min ? r.week : min;
        }, Infinity);
        if (espnPlayoffStartWeek !== Infinity) {
          winnersPairsByWeek = buildWinnersBracketPairsByWeekEspn(
            data.winnersBracket,
            espnPlayoffStartWeek,
            data.rosterMap
          );
        }
      }

      var loggedFallbackWarning = false;

      var games = [];
      (data.rows || []).forEach(function (r) {
        if (r.opponent === "BYE" || !r.opponent) return;
        var teamOwner = normalizeOwnerKey(r.teamOwner);
        var oppOwner = normalizeOwnerKey(r.opponentOwner);
        if (!teamOwner || !oppOwner) return;

        var gameType = "regular";
        if (r.isPlayoff) {
          if (hasExplicitBracketField) {
            if (r.isConsolation || r.isLosersBracket || r.bracketType === "consolation") {
              gameType = "consolation";
            } else {
              gameType = "playoff";
            }
          } else if (winnersPairsByWeek) {
            var teamKeyName = r.team;
            var oppKeyName = r.opponent;
            var isWinnersPair = isPairInWinnersBracket(
              winnersPairsByWeek,
              r.week,
              teamKeyName,
              oppKeyName
            );
            gameType = isWinnersPair ? "playoff" : "consolation";
          } else {
            if (!loggedFallbackWarning) {
              console.warn(
                "All-time: ESPN season " +
                  year +
                  " has no bracket-type field and no winners bracket to cross-reference; " +
                  "treating all playoff-week games as 'playoff' (consolation games may be included)."
              );
              loggedFallbackWarning = true;
            }
            gameType = "playoff";
          }
        }

        games.push({
          year: year,
          source: "espn",
          week: r.week,
          gameType: gameType,
          isPlayoff: gameType === "playoff",
          ownerAKey: teamOwner,
          ownerAName: r.teamOwner,
          ownerATeamName: r.team,
          ownerAScore: r.teamScore,
          ownerBKey: oppOwner,
          ownerBName: r.opponentOwner,
          ownerBTeamName: r.opponent,
          ownerBScore: r.opponentScore,
        });
      });

      return { year: year, source: "espn", teamSummaries: teamSummaries, games: games };
    });
  }

  /**
   * Same idea as buildWinnersBracketPairsByWeek but keyed by team NAME
   * pairs instead of roster IDs, since ESPN's per-row data identifies
   * teams by name/owner rather than a numeric roster id. Falls back to
   * matching whatever identifier is present on the bracket entries
   * (teamName or ownerName).
   */
  function buildWinnersBracketPairsByWeekEspn(winnersBracket, playoffStartWeek, rosterMap) {
    var pairsByWeek = {};
    if (!winnersBracket) return pairsByWeek;

    winnersBracket.forEach(function (roundData) {
      var round = roundData.round;
      var week = playoffStartWeek + (round - 1);
      (roundData.matches || []).forEach(function (m) {
        var nameA = m.slot1 && (m.slot1.teamName || m.slot1.ownerName);
        var nameB = m.slot2 && (m.slot2.teamName || m.slot2.ownerName);
        if (!nameA || !nameB) return;
        if (!pairsByWeek[week]) pairsByWeek[week] = {};
        pairsByWeek[week][pairKey(nameA, nameB)] = true;
      });
    });

    return pairsByWeek;
  }

  function isPairInWinnersBracket(pairsByWeek, week, nameA, nameB) {
    var weekPairs = pairsByWeek[week];
    if (!weekPairs) return false;
    return !!weekPairs[pairKey(nameA, nameB)];
  }

  /**
   * Loads and normalizes ONE Sleeper season into the same shape as
   * loadEspnSeasonForAllTime, resolving each roster's owner through
   * SleeperAPI.buildRosterMap (which already applies owner-overrides.js).
   * madePlayoffs is derived by checking whether the roster appears
   * anywhere in that season's winners bracket. Each game is classified
   * as "regular", "playoff" (real winners-bracket pairing), or
   * "consolation" (playoff-week game that isn't a winners-bracket pairing).
   */
  function loadSleeperSeasonForAllTime(year) {
    var leagueId = SleeperAPI.SLEEPER_SEASONS[year];
    if (!leagueId) return Promise.resolve(null);

    return Promise.all([
      SleeperAPI.getLeague(leagueId),
      SleeperAPI.getUsers(leagueId),
      SleeperAPI.getRosters(leagueId),
      SleeperAPI.getWinnersBracket(leagueId).catch(function () {
        return [];
      }),
    ]).then(function (results) {
      var league = results[0];
      var users = results[1];
      var rosters = results[2];
      var winnersBracket = results[3];

      var rosterMap = SleeperAPI.buildRosterMap(users, rosters);
      var finalStandingsInfo = SleeperAPI.buildFinalStandings(rosterMap, winnersBracket);
      var playoffStartWeek = (league.settings && league.settings.playoff_week_start) || null;

      var playoffRosterIds = {};
      (winnersBracket || []).forEach(function (m) {
        if (m.t1) playoffRosterIds[m.t1] = true;
        if (m.t2) playoffRosterIds[m.t2] = true;
      });

      var winnersPairsByWeek = buildWinnersBracketPairsByWeek(winnersBracket, playoffStartWeek);

      var teamSummaries = Object.keys(rosterMap).map(function (rid) {
        var t = rosterMap[rid];
        var isChamp = finalStandingsInfo.champion && finalStandingsInfo.champion.rosterId === t.rosterId;
        var isRunnerUp = finalStandingsInfo.runnerUp && finalStandingsInfo.runnerUp.rosterId === t.rosterId;
        return {
          year: year,
          source: "sleeper",
          ownerKey: normalizeOwnerKey(t.displayName),
          ownerName: t.displayName,
          teamName: t.teamName,
          madePlayoffs: !!playoffRosterIds[t.rosterId],
          isChampion: !!isChamp,
          isRunnerUp: !!isRunnerUp,
        };
      });

      return SleeperAPI.getAllWeeksMatchups(leagueId, SleeperAPI.MAX_SLEEPER_WEEK).then(function (allWeeksMatchups) {
        var games = [];
        var playedWeeks = SleeperAPI.getPlayedWeeks(allWeeksMatchups);

        playedWeeks.forEach(function (week) {
          var isPlayoffWeek = !!playoffStartWeek && week >= playoffStartWeek;
          var weekMatchups = allWeeksMatchups[week] || [];
          var grouped = {};
          weekMatchups.forEach(function (m) {
            if (!grouped[m.matchup_id]) grouped[m.matchup_id] = [];
            grouped[m.matchup_id].push(m);
          });

          Object.keys(grouped).forEach(function (matchupId) {
            var pair = grouped[matchupId];
            var a = pair[0];
            var b = pair[1];
            if (!a || !b) return; // skip byes - no head-to-head data

            var teamA = rosterMap[a.roster_id];
            var teamB = rosterMap[b.roster_id];
            if (!teamA || !teamB) return;

            var gameType = "regular";
            if (isPlayoffWeek) {
              var isWinnersPair =
                winnersPairsByWeek[week] && winnersPairsByWeek[week][pairKey(a.roster_id, b.roster_id)];
              gameType = isWinnersPair ? "playoff" : "consolation";
            }

            games.push({
              year: year,
              source: "sleeper",
              week: week,
              gameType: gameType,
              isPlayoff: gameType === "playoff",
              ownerAKey: normalizeOwnerKey(teamA.displayName),
              ownerAName: teamA.displayName,
              ownerATeamName: teamA.teamName,
              ownerAScore: a.points || 0,
              ownerBKey: normalizeOwnerKey(teamB.displayName),
              ownerBName: teamB.displayName,
              ownerBTeamName: teamB.teamName,
              ownerBScore: b.points || 0,
            });
          });
        });

        return { year: year, source: "sleeper", teamSummaries: teamSummaries, games: games };
      });
    });
  }

  /**
   * Loads every ESPN + Sleeper season once and caches the combined
   * result for the rest of the page session (so switching between
   * career totals and head-to-head, or re-picking owners, doesn't
   * re-fetch everything from scratch).
   */
  function loadAllSeasons() {
    if (_allSeasonsCache) return _allSeasonsCache;

    var espnYears = (window.EspnLoader && window.EspnLoader.ESPN_SEASONS) || [];
    var sleeperYears = Object.keys(SleeperAPI.SLEEPER_SEASONS).map(Number);

    var espnPromises = espnYears.map(function (year) {
      return loadEspnSeasonForAllTime(year).catch(function (err) {
        console.error("All-time: failed to load ESPN season " + year, err);
        return null;
      });
    });
    var sleeperPromises = sleeperYears.map(function (year) {
      return loadSleeperSeasonForAllTime(year).catch(function (err) {
        console.error("All-time: failed to load Sleeper season " + year, err);
        return null;
      });
    });

    _allSeasonsCache = Promise.all(espnPromises.concat(sleeperPromises)).then(function (results) {
      return results.filter(function (r) {
        return r !== null;
      });
    });

    return _allSeasonsCache;
  }

  /**
   * Walks every game across every season once and buckets each game's
   * result (win/loss/tie + points) onto the correct owner AND the
   * correct split (regular vs playoff). Consolation games are skipped
   * entirely here - they don't count toward either total, per league
   * rules that only winners-bracket games count as "playoff" and only
   * the normal schedule counts as "regular season".
   */
  function accumulateGameRecords(allSeasonsData) {
    var byOwner = {}; // ownerKey -> { regular: {...}, playoff: {...} }

    function ensure(ownerKey) {
      if (!byOwner[ownerKey]) {
        byOwner[ownerKey] = { regular: newSplitRecord(), playoff: newSplitRecord() };
      }
      return byOwner[ownerKey];
    }

    function applyResult(record, myScore, oppScore) {
      record.pointsFor += myScore;
      record.pointsAgainst += oppScore;
      if (myScore > oppScore) record.wins += 1;
      else if (myScore < oppScore) record.losses += 1;
      else record.ties += 1;
    }

    allSeasonsData.forEach(function (season) {
      season.games.forEach(function (g) {
        if (g.gameType === "consolation") return; // excluded from both totals

        var splitKey = g.gameType === "playoff" ? "playoff" : "regular";
        var entryA = ensure(g.ownerAKey);
        var entryB = ensure(g.ownerBKey);
        applyResult(entryA[splitKey], g.ownerAScore, g.ownerBScore);
        applyResult(entryB[splitKey], g.ownerBScore, g.ownerAScore);
      });
    });

    return byOwner;
  }

  /**
   * Aggregates every season's teamSummaries (for seasons/championships/
   * playoff appearances) plus the game-derived regular/playoff records
   * (for W-L-T and points) into one row per owner, covering their
   * entire career across both ESPN and Sleeper eras.
   */
  function buildCareerTotals(allSeasonsData) {
    var byOwner = {};
    var gameRecords = accumulateGameRecords(allSeasonsData);

    allSeasonsData.forEach(function (season) {
      season.teamSummaries.forEach(function (t) {
        if (!byOwner[t.ownerKey]) {
          byOwner[t.ownerKey] = {
            ownerKey: t.ownerKey,
            ownerName: t.ownerName,
            seasons: 0,
            championships: 0,
            runnerUps: 0,
            playoffAppearances: 0,
            yearsList: [],
          };
        }
        var entry = byOwner[t.ownerKey];
        entry.seasons += 1;
        if (t.isChampion) entry.championships += 1;
        if (t.isRunnerUp) entry.runnerUps += 1;
        if (t.madePlayoffs) entry.playoffAppearances += 1;
        entry.yearsList.push(t.year);
      });
    });

    return Object.keys(byOwner)
      .map(function (k) {
        var e = byOwner[k];
        var rec = gameRecords[k] || { regular: newSplitRecord(), playoff: newSplitRecord() };

        e.regular = roundSplit(rec.regular);
        e.playoff = roundSplit(rec.playoff);

        e.combined = {
          wins: e.regular.wins + e.playoff.wins,
          losses: e.regular.losses + e.playoff.losses,
          ties: e.regular.ties + e.playoff.ties,
          pointsFor: Math.round((e.regular.pointsFor + e.playoff.pointsFor) * 100) / 100,
          pointsAgainst: Math.round((e.regular.pointsAgainst + e.playoff.pointsAgainst) * 100) / 100,
        };

        e.regular.winPct = winPct(e.regular);
        e.playoff.winPct = winPct(e.playoff);
        e.combined.winPct = winPct(e.combined);

        e.yearsList.sort(function (a, b) {
          return a - b;
        });
        return e;
      })
      .sort(function (a, b) {
        if (b.championships !== a.championships) return b.championships - a.championships;
        if (b.combined.winPct !== a.combined.winPct) return b.combined.winPct - a.combined.winPct;
        return b.combined.wins - a.combined.wins;
      });
  }

  function roundSplit(rec) {
    return {
      wins: rec.wins,
      losses: rec.losses,
      ties: rec.ties,
      pointsFor: Math.round(rec.pointsFor * 100) / 100,
      pointsAgainst: Math.round(rec.pointsAgainst * 100) / 100,
    };
  }

  function winPct(rec) {
    var total = rec.wins + rec.losses + rec.ties;
    return total > 0 ? rec.wins / total : 0;
  }

  /**
   * Every individual game ever played between two specific owners,
   * across all seasons, split into regular-season, playoff (winners
   * bracket only), and consolation games, each with its own aggregate
   * head-to-head summary. Consolation games are included in the full
   * game log (tagged accordingly) but excluded from the regular and
   * playoff summaries. ownerAQuery/ownerBQuery are matched
   * case-insensitively against ownerKey.
   */
  function buildHeadToHead(allSeasonsData, ownerAQuery, ownerBQuery) {
    var keyA = normalizeOwnerKey(ownerAQuery);
    var keyB = normalizeOwnerKey(ownerBQuery);

    var matchups = [];
    allSeasonsData.forEach(function (season) {
      season.games.forEach(function (g) {
        var isMatch =
          (g.ownerAKey === keyA && g.ownerBKey === keyB) ||
          (g.ownerAKey === keyB && g.ownerBKey === keyA);
        if (!isMatch) return;

        var aIsOwnerA = g.ownerAKey === keyA;
        matchups.push({
          year: g.year,
          week: g.week,
          gameType: g.gameType,
          isPlayoff: g.isPlayoff,
          source: g.source,
          ownerAName: aIsOwnerA ? g.ownerAName : g.ownerBName,
          ownerATeamName: aIsOwnerA ? g.ownerATeamName : g.ownerBTeamName,
          ownerAScore: aIsOwnerA ? g.ownerAScore : g.ownerBScore,
          ownerBName: aIsOwnerA ? g.ownerBName : g.ownerAName,
          ownerBTeamName: aIsOwnerA ? g.ownerBTeamName : g.ownerATeamName,
          ownerBScore: aIsOwnerA ? g.ownerBScore : g.ownerAScore,
        });
      });
    });

    matchups.sort(function (a, b) {
      if (a.year !== b.year) return a.year - b.year;
      return (a.week || 0) - (b.week || 0);
    });

    function summarize(list) {
      var summary = {
        totalGames: list.length,
        ownerAWins: 0,
        ownerBWins: 0,
        ties: 0,
        ownerATotalPoints: 0,
        ownerBTotalPoints: 0,
      };
      list.forEach(function (m) {
        summary.ownerATotalPoints += m.ownerAScore || 0;
        summary.ownerBTotalPoints += m.ownerBScore || 0;
        if (m.ownerAScore > m.ownerBScore) summary.ownerAWins += 1;
        else if (m.ownerBScore > m.ownerAScore) summary.ownerBWins += 1;
        else summary.ties += 1;
      });
      summary.ownerAvgA = summary.totalGames > 0 ? summary.ownerATotalPoints / summary.totalGames : 0;
      summary.ownerAvgB = summary.totalGames > 0 ? summary.ownerBTotalPoints / summary.totalGames : 0;
      return summary;
    }

    var regularMatchups = matchups.filter(function (m) {
      return m.gameType === "regular";
    });
    var playoffMatchups = matchups.filter(function (m) {
      return m.gameType === "playoff";
    });
    var consolationMatchups = matchups.filter(function (m) {
      return m.gameType === "consolation";
    });

    return {
      matchups: matchups,
      regularMatchups: regularMatchups,
      playoffMatchups: playoffMatchups,
      consolationMatchups: consolationMatchups,
      summary: summarize(regularMatchups.concat(playoffMatchups)),
      regularSummary: summarize(regularMatchups),
      playoffSummary: summarize(playoffMatchups),
    };
  }

  /** Distinct list of owner names seen across all seasons, for populating head-to-head dropdowns. */
  function getAllOwnerNames(allSeasonsData) {
    var seen = {};
    allSeasonsData.forEach(function (season) {
      season.teamSummaries.forEach(function (t) {
        if (t.ownerKey && !seen[t.ownerKey]) {
          seen[t.ownerKey] = t.ownerName;
        }
      });
    });
    return Object.keys(seen)
      .map(function (k) {
        return { key: k, name: seen[k] };
      })
      .sort(function (a, b) {
        return a.name.localeCompare(b.name);
      });
  }

  window.AllTimeStats = {
    loadAllSeasons: loadAllSeasons,
    buildCareerTotals: buildCareerTotals,
    buildHeadToHead: buildHeadToHead,
    getAllOwnerNames: getAllOwnerNames,
  };
})();
