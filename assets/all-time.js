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
 *   - "playoff"     games that are on a team's ACTIVE championship
 *                   path in the winners bracket - i.e. both teams in
 *                   the game won every one of their prior
 *                   winners-bracket rounds this postseason. This is
 *                   NOT the same as "any game inside the winners
 *                   bracket data structure": Sleeper's winners bracket
 *                   also contains placement games (3rd place, 5th
 *                   place, etc.) whose participants are the LOSERS of
 *                   earlier rounds. Those are intentionally excluded
 *                   here, along with a first-round loser's later-round
 *                   games of any kind, because once a team is
 *                   eliminated from the title path none of their
 *                   remaining "playoff bracket" games are really
 *                   playoff games anymore.
 *   - "consolation" everything else during playoff weeks: the
 *                   separate loser's/toilet-bowl bracket, PLUS any
 *                   placement game (3rd place, etc.) inside the
 *                   winners-bracket data structure, PLUS any
 *                   later-round winners-bracket game for a team that
 *                   already lost an earlier round. Excluded from both
 *                   the regular and playoff W-L/points totals. Still
 *                   shown in the head-to-head game log (tagged
 *                   "Consolation") for transparency.
 *
 * For Sleeper seasons, this is determined by SIMULATING the winners
 * bracket round by round using each match's actual winner (the `w`
 * field once played), tracking which roster IDs are still "alive" on
 * the championship path. A round-N match counts as "playoff" only if
 * BOTH of its participants were alive entering round N. This correctly
 * excludes: the separate losers/consolation bracket entirely, 3rd
 * place / placement games within the winners bracket structure, and -
 * per league rules - any game an eliminated team plays in a later
 * round of the winners bracket (e.g. a 3-round format where a
 * round-1 loser's round-2 and round-3 games, including any 3rd place
 * game, no longer count as playoff games for them).
 *
 * For ESPN seasons, the per-row bracket type from espn-loader.js is
 * used if available (checked defensively across a few possible field
 * names); otherwise the loader falls back to the same round-by-round
 * "alive path" simulation against the winners bracket built by
 * EspnLoader.
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

  function pairKey(a, b) {
    var x = String(a);
    var y = String(b);
    return x < y ? x + "|" + y : y + "|" + x;
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
   * Simulates a Sleeper-style winners bracket round by round to find,
   * for each week, the set of roster-id pairings that represent a real
   * "still alive on the championship path" playoff game.
   *
   * winnersBracket entries look like:
   *   { r: round, m: matchId, t1, t2, w: winnerRosterId, l: loserRosterId,
   *     t1_from: {w: matchId} | {l: matchId}, t2_from: {...}, p: placementRank }
   *
   * Placement games (p is set, e.g. p:3 for the 3rd place game) are
   * always excluded - their participants are explicitly the losers of
   * an earlier round, never the championship path.
   *
   * For non-placement games, a roster is only "alive" entering round N
   * if it won every one of its prior non-placement rounds. Round 1
   * participants are alive by definition (everyone starts on the
   * championship path). t1/t2 that are resolved via t1_from/t2_from
   * pointing at a match's winner (`w`) are only alive if that
   * referenced team was itself alive and actually won.
   */
  function buildActivePlayoffPairsByWeek(winnersBracket, playoffStartWeek) {
    var pairsByWeek = {};
    if (!winnersBracket || !playoffStartWeek) return pairsByWeek;

    var byRound = {};
    winnersBracket.forEach(function (m) {
      var r = m.r || 1;
      if (!byRound[r]) byRound[r] = [];
      byRound[r].push(m);
    });

    var rounds = Object.keys(byRound)
      .map(Number)
      .sort(function (a, b) {
        return a - b;
      });

    var aliveRosterIds = null; // null = round 1, everyone who appears is alive by definition

    rounds.forEach(function (round) {
      var matches = byRound[round] || [];
      var week = playoffStartWeek + (round - 1);
      var stillAliveAfterThisRound = {};

      matches.forEach(function (m) {
        if (m.p) return; // placement game (3rd place, etc.) - never a real playoff game

        var t1 = m.t1;
        var t2 = m.t2;
        if (!t1 || !t2) return;

        var t1Alive = aliveRosterIds === null ? true : !!aliveRosterIds[t1];
        var t2Alive = aliveRosterIds === null ? true : !!aliveRosterIds[t2];

        if (t1Alive && t2Alive) {
          if (!pairsByWeek[week]) pairsByWeek[week] = {};
          pairsByWeek[week][pairKey(t1, t2)] = true;

          // Whoever wins (or, if unplayed yet, both provisionally) stays alive for next round.
          if (m.w) {
            stillAliveAfterThisRound[m.w] = true;
          } else {
            stillAliveAfterThisRound[t1] = true;
            stillAliveAfterThisRound[t2] = true;
          }
        }
        // If either side wasn't alive, this is a placement/consolation game
        // in disguise (shouldn't normally happen for non-`p` matches, but
        // if it does, neither team carries forward as "alive").
      });

      aliveRosterIds = stillAliveAfterThisRound;
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
   *      (bracketType / isConsolation / isWinnersBracket / isLosersBracket)
   *      AND an explicit elimination/placement signal, trust it directly.
   *   2. Otherwise, cross-reference against EspnLoader's own
   *      winnersBracket for that season using the same round-by-round
   *      "alive path" simulation used for Sleeper.
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

      var hasExplicitEliminationField = (data.rows || []).some(function (r) {
        return r.isEliminatedBeforeThisGame !== undefined || r.bracketRoundStatus !== undefined;
      });

      var winnersPairsByWeek = null;
      if (!hasExplicitEliminationField && data.winnersBracket) {
        var espnPlayoffStartWeek = (data.rows || []).reduce(function (min, r) {
          return r.isPlayoff && r.week < min ? r.week : min;
        }, Infinity);
        if (espnPlayoffStartWeek !== Infinity) {
          winnersPairsByWeek = buildActivePlayoffPairsByWeekEspn(
            data.winnersBracket,
            espnPlayoffStartWeek
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
          if (hasExplicitEliminationField) {
            gameType = r.isEliminatedBeforeThisGame ? "consolation" : "playoff";
          } else if (winnersPairsByWeek) {
            var isActivePair = isPairActive(winnersPairsByWeek, r.week, r.team, r.opponent);
            gameType = isActivePair ? "playoff" : "consolation";
          } else {
            if (!loggedFallbackWarning) {
              console.warn(
                "All-time: ESPN season " +
                  year +
                  " has no elimination-tracking field and no winners bracket to simulate; " +
                  "treating all playoff-week games as 'playoff' (post-elimination games may be included)."
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
   * Same round-by-round "alive path" simulation as
   * buildActivePlayoffPairsByWeek, but for EspnLoader's bracket shape
   * (rounds of { round, matches: [{ slot1, slot2, winnerRosterId/winnerName }] })
   * and keyed by team NAME pairs since ESPN rows identify teams by name.
   * A match is treated as a placement/non-championship game if either
   * slot is marked as coming from a prior round's LOSER (slot.fromLoserOf
   * or similar), mirroring Sleeper's t1_from/t2_from {l: matchId} signal;
   * if that metadata isn't present, placement games are identified by
   * simply not being reachable via the winner-chain from round 1.
   */
  function buildActivePlayoffPairsByWeekEspn(winnersBracket, playoffStartWeek) {
    var pairsByWeek = {};
    if (!winnersBracket) return pairsByWeek;

    var aliveNames = null;

    winnersBracket.forEach(function (roundData) {
      var round = roundData.round;
      var week = playoffStartWeek + (round - 1);
      var stillAliveAfterThisRound = {};

      (roundData.matches || []).forEach(function (m) {
        var isPlacementGame = !!(m.isPlacementGame || m.placement || (m.p && m.p > 1));
        if (isPlacementGame) return;

        var nameA = m.slot1 && (m.slot1.teamName || m.slot1.ownerName);
        var nameB = m.slot2 && (m.slot2.teamName || m.slot2.ownerName);
        if (!nameA || !nameB) return;

        var aAlive = aliveNames === null ? true : !!aliveNames[nameA];
        var bAlive = aliveNames === null ? true : !!aliveNames[nameB];

        if (aAlive && bAlive) {
          if (!pairsByWeek[week]) pairsByWeek[week] = {};
          pairsByWeek[week][pairKey(nameA, nameB)] = true;

          var winnerName =
            m.winnerName ||
            (m.winnerRosterId && m.slot1 && m.slot1.rosterId === m.winnerRosterId
              ? nameA
              : m.winnerRosterId
              ? nameB
              : null);

          if (winnerName) {
            stillAliveAfterThisRound[winnerName] = true;
          } else {
            stillAliveAfterThisRound[nameA] = true;
            stillAliveAfterThisRound[nameB] = true;
          }
        }
      });

      aliveNames = stillAliveAfterThisRound;
    });

    return pairsByWeek;
  }

  function isPairActive(pairsByWeek, week, nameA, nameB) {
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
   * as "regular", "playoff" (still alive on the championship path that
   * round), or "consolation" (losers bracket, placement games, or any
   * winners-bracket game for a team already eliminated from the title path).
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

      var activePairsByWeek = buildActivePlayoffPairsByWeek(winnersBracket, playoffStartWeek);

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
              var isActivePair = isPairActive(activePairsByWeek, week, a.roster_id, b.roster_id);
              gameType = isActivePair ? "playoff" : "consolation";
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
   * entirely here - they don't count toward either total. This
   * includes: the separate losers/toilet-bowl bracket, placement games
   * (3rd place, etc.) within the winners bracket, and any later-round
   * winners-bracket game played by a team already eliminated from the
   * championship path that postseason.
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
   * across all seasons, split into regular-season, playoff (active
   * championship-path games only), and consolation games, each with
   * its own aggregate head-to-head summary. Consolation games are
   * included in the full game log (tagged accordingly) but excluded
   * from the regular and playoff summaries. ownerAQuery/ownerBQuery
   * are matched case-insensitively against ownerKey.
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
