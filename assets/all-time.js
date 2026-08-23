/**
 * all-time.js
 * Builds career (all-time, cross-season) statistics by loading every
 * ESPN CSV year AND every Sleeper league year, then aggregating by
 * OWNER display name - since that's the one identifier that stays
 * consistent for the same real person across both eras (ESPN CSVs
 * already use real names like "Dan"/"Spencer" as their owner column,
 * and owner-overrides.js maps Sleeper usernames to those same names).
 *
 * Three things this module produces:
 *   1. Career totals: one row per owner, W-L-T and points for/against
 *      split into REGULAR SEASON and PLAYOFFS separately (plus a
 *      combined total), championships, playoff appearances, seasons
 *      played - across every year of the league's history.
 *   2. Head-to-head: for any two owners, every individual matchup
 *      they've ever played against each other, with regular-season
 *      and playoff results broken out separately.
 *   3. Owner vs. the field: for a single owner, their regular-season
 *      and playoff record against EVERY opponent they've ever played,
 *      one row per opponent, plus their overall combined record across
 *      all opponents.
 *
 * Each game is classified into exactly one of three buckets:
 *   - "regular"     games during the normal season schedule.
 *   - "playoff"     games that are on a team's ACTIVE championship
 *                   path in the winners bracket - i.e. neither team in
 *                   the game has lost an earlier winners-bracket round
 *                   this postseason.
 *   - "consolation" everything else during playoff weeks: the
 *                   separate loser's/toilet-bowl bracket, PLUS any
 *                   placement game (3rd place, etc.) inside the
 *                   winners-bracket data structure, PLUS any
 *                   later-round winners-bracket game for a team that
 *                   already lost an earlier round.
 *
 * IMPORTANT - resolving bracket slots via t1_from/t2_from: Sleeper's
 * winners bracket does NOT always populate a match's t1/t2 fields with
 * literal roster IDs. For any bracket slot that is filled by the
 * WINNER (or LOSER, for placement games) of an earlier match rather
 * than being a fixed starting seed, Sleeper instead sets
 * t1_from: {w: matchId} or {l: matchId} (and t2_from similarly) and
 * leaves the literal t1/t2 field null/undefined - the consumer is
 * expected to resolve it by looking up that referenced match's actual
 * winner or loser once it's been played.
 *
 * A previous version of this code only ever read the literal t1/t2
 * fields and skipped any match where they were missing. That silently
 * dropped real games from the "active championship path" pair set -
 * most visibly, a CHAMPIONSHIP game between two teams that both had
 * byes (so neither has a fixed t1/t2 in that match; both sides are
 * resolved via t1_from/t2_from pointing at their semifinal wins) was
 * never recognized as a playoff pairing at all, and fell through to
 * "consolation" even though it was very much a real, active-path
 * playoff game.
 *
 * FIX: buildActivePlayoffPairs (Sleeper) now resolves each match's
 * participants by first checking the literal t1/t2 field, and if
 * absent, following t1_from/t2_from to the referenced match (by its
 * `m` id) and reading that match's winner (`w`) or loser (`l`) as
 * appropriate. This correctly handles every bracket-slot origin:
 * fixed bye seeds (literal t1/t2), winners advancing from an earlier
 * round (t1_from: {w: matchId}), and losers dropping into a placement
 * game (t1_from: {l: matchId}).
 *
 * Eligibility itself is still tracked as an ELIMINATION block-list (a
 * roster is only excluded once it actually LOSES a non-placement
 * match), and the resulting pair set is NOT partitioned by week -
 * every real game during a playoff week is checked against this set
 * purely by roster-ID pair, since bracket round numbers don't reliably
 * map 1-to-1 with elapsed calendar weeks once any bye is involved.
 *
 * For ESPN seasons, the per-row bracket type from espn-loader.js is
 * used if available; otherwise the loader falls back to the same
 * resolved-graph, elimination-tracking simulation against the winners
 * bracket built by EspnLoader.
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
   * Resolves a bracket match's t1 or t2 participant. Tries the literal
   * field first; if that's missing, follows the corresponding
   * t1_from/t2_from reference to the match it points at (by matchId)
   * and returns that match's winner (`w`) or loser (`l`) roster id,
   * whichever the reference specifies. Returns null if the participant
   * can't be resolved yet (e.g. the referenced match hasn't been
   * played, or the reference itself is missing).
   */
  function resolveBracketSlot(match, side, byMatchId) {
    var direct = match[side];
    if (direct) return direct;

    var fromRef = match[side + "_from"];
    if (!fromRef) return null;

    var refMatchId = fromRef.w !== undefined ? fromRef.w : fromRef.l;
    var refMatch = byMatchId[refMatchId];
    if (!refMatch) return null;

    if (fromRef.w !== undefined) return refMatch.w || null;
    return refMatch.l || null;
  }

  /**
   * Walks a Sleeper-style winners bracket round by round to find the
   * set of roster-id pairings that represent a real "still alive on
   * the championship path" playoff game, ANYWHERE in the bracket -
   * deliberately NOT tied to a specific calendar week, and correctly
   * resolving each match's participants even when they're only
   * available via t1_from/t2_from rather than a literal t1/t2.
   *
   * Placement games (p is set, e.g. p:3 for the 3rd place game) are
   * always excluded - their participants are explicitly the losers of
   * an earlier round, never the championship path.
   *
   * Eligibility is tracked as an ELIMINATION block-list: a roster is
   * excluded from any later round only once it actually LOSES a
   * non-placement match. A team with a bye - whether for one round or
   * for multiple rounds in a row - never appears in a match it didn't
   * play, so it's never marked eliminated and remains correctly
   * eligible for whichever round it next appears in.
   *
   * Returns a flat object keyed by pairKey(t1, t2) - one entry per
   * legitimate championship-path pairing across the WHOLE bracket, not
   * partitioned by week. Callers match a real game against this set
   * purely by roster-id pair; the game's actual calendar week is
   * irrelevant to whether it counts as "playoff".
   */
  function buildActivePlayoffPairs(winnersBracket) {
    var activePairs = {};
    if (!winnersBracket || winnersBracket.length === 0) return activePairs;

    var byMatchId = {};
    winnersBracket.forEach(function (m) {
      byMatchId[m.m] = m;
    });

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

    var eliminatedRosterIds = {};

    rounds.forEach(function (round) {
      var matches = byRound[round] || [];

      matches.forEach(function (m) {
        if (m.p) return; // placement game (3rd place, etc.) - never a real playoff game

        var t1 = resolveBracketSlot(m, "t1", byMatchId);
        var t2 = resolveBracketSlot(m, "t2", byMatchId);
        if (!t1 || !t2) return; // not yet resolvable (referenced match unplayed) or a bye with no opponent

        var t1Eliminated = !!eliminatedRosterIds[t1];
        var t2Eliminated = !!eliminatedRosterIds[t2];

        if (!t1Eliminated && !t2Eliminated) {
          activePairs[pairKey(t1, t2)] = true;

          if (m.w) {
            var loser = m.w === t1 ? t2 : t1;
            eliminatedRosterIds[loser] = true;
          }
        }
      });
    });

    return activePairs;
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
   *   1. If the CSV row itself exposes an elimination-tracking field
   *      (isEliminatedBeforeThisGame / bracketRoundStatus), trust it
   *      directly.
   *   2. Otherwise, cross-reference against EspnLoader's own
   *      winnersBracket for that season using the same elimination-
   *      tracking pair-set simulation used for Sleeper.
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

      var activeNamePairs = null;
      if (!hasExplicitEliminationField && data.winnersBracket) {
        activeNamePairs = buildActivePlayoffPairsEspn(data.winnersBracket);
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
          } else if (activeNamePairs) {
            var isActivePair = !!activeNamePairs[pairKey(r.team, r.opponent)];
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
   * Same resolved-graph, elimination-tracking pair-set simulation as
   * buildActivePlayoffPairs, but for EspnLoader's bracket shape (rounds
   * of { round, matches: [{ slot1, slot2, winnerRosterId/winnerName }] })
   * and keyed by team NAME pairs since ESPN rows identify teams by
   * name. ESPN's loader is assumed to already resolve each slot's
   * teamName/ownerName directly (it doesn't expose a raw t1_from-style
   * reference the way Sleeper's API does), so no additional graph
   * resolution is needed here beyond the elimination tracking itself.
   */
  function buildActivePlayoffPairsEspn(winnersBracket) {
    var activePairs = {};
    if (!winnersBracket) return activePairs;

    var eliminatedNames = {};

    winnersBracket.forEach(function (roundData) {
      (roundData.matches || []).forEach(function (m) {
        var isPlacementGame = !!(m.isPlacementGame || m.placement || (m.p && m.p > 1));
        if (isPlacementGame) return;

        var nameA = m.slot1 && (m.slot1.teamName || m.slot1.ownerName);
        var nameB = m.slot2 && (m.slot2.teamName || m.slot2.ownerName);
        if (!nameA || !nameB) return; // bye slot with no opponent yet

        var aEliminated = !!eliminatedNames[nameA];
        var bEliminated = !!eliminatedNames[nameB];

        if (!aEliminated && !bEliminated) {
          activePairs[pairKey(nameA, nameB)] = true;

          var winnerName =
            m.winnerName ||
            (m.winnerRosterId && m.slot1 && m.slot1.rosterId === m.winnerRosterId
              ? nameA
              : m.winnerRosterId
              ? nameB
              : null);

          if (winnerName) {
            var loserName = winnerName === nameA ? nameB : nameA;
            eliminatedNames[loserName] = true;
          }
        }
      });
    });

    return activePairs;
  }

  /**
   * Loads and normalizes ONE Sleeper season into the same shape as
   * loadEspnSeasonForAllTime, resolving each roster's owner through
   * SleeperAPI.buildRosterMap (which already applies owner-overrides.js).
   * madePlayoffs is derived by checking whether the roster appears
   * anywhere in that season's winners bracket. Each game is classified
   * as "regular", "playoff" (a legitimate championship-path pairing,
   * correctly resolved even when a bracket slot only ever appears via
   * t1_from/t2_from rather than a literal t1/t2 - e.g. a championship
   * game between two teams who both had byes), or "consolation"
   * (losers bracket, placement games, or any winners-bracket game for
   * a team already eliminated from the title path).
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

      var activePairs = buildActivePlayoffPairs(winnersBracket);

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
              var isActivePair = !!activePairs[pairKey(a.roster_id, b.roster_id)];
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
   * career totals, head-to-head, and owner-vs-field, or re-picking
   * owners, doesn't re-fetch everything from scratch).
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
   * entirely here - they don't count toward either total.
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

  function summarizeGames(list) {
    var summary = {
      totalGames: list.length,
      wins: 0,
      losses: 0,
      ties: 0,
      pointsFor: 0,
      pointsAgainst: 0,
    };
    list.forEach(function (m) {
      summary.pointsFor += m.myScore;
      summary.pointsAgainst += m.oppScore;
      if (m.myScore > m.oppScore) summary.wins += 1;
      else if (m.myScore < m.oppScore) summary.losses += 1;
      else summary.ties += 1;
    });
    summary.pointsFor = Math.round(summary.pointsFor * 100) / 100;
    summary.pointsAgainst = Math.round(summary.pointsAgainst * 100) / 100;
    summary.avgFor = summary.totalGames > 0 ? summary.pointsFor / summary.totalGames : 0;
    summary.avgAgainst = summary.totalGames > 0 ? summary.pointsAgainst / summary.totalGames : 0;
    summary.winPct = winPct(summary);
    return summary;
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

  /**
   * For a single owner, builds their regular-season and playoff record
   * against EVERY opponent they've ever played (one row per opponent),
   * plus their overall regular-season and playoff record combined
   * across all opponents. Consolation games are excluded from both
   * the per-opponent rows and the overall totals, same as everywhere
   * else in this module. Opponent rows are sorted alphabetically by
   * opponent name.
   */
  function buildOwnerVsAll(allSeasonsData, ownerQuery) {
    var ownerKey = normalizeOwnerKey(ownerQuery);

    var byOpponent = {}; // opponentKey -> { opponentName, regularGames: [], playoffGames: [] }
    var overallRegularGames = [];
    var overallPlayoffGames = [];

    allSeasonsData.forEach(function (season) {
      season.games.forEach(function (g) {
        if (g.gameType === "consolation") return;
        if (g.ownerAKey !== ownerKey && g.ownerBKey !== ownerKey) return;

        var iAmA = g.ownerAKey === ownerKey;
        var opponentKey = iAmA ? g.ownerBKey : g.ownerAKey;
        var opponentName = iAmA ? g.ownerBName : g.ownerAName;
        var myScore = iAmA ? g.ownerAScore : g.ownerBScore;
        var oppScore = iAmA ? g.ownerBScore : g.ownerAScore;

        if (!byOpponent[opponentKey]) {
          byOpponent[opponentKey] = {
            opponentKey: opponentKey,
            opponentName: opponentName,
            regularGames: [],
            playoffGames: [],
          };
        }

        var gameRecord = { year: g.year, week: g.week, myScore: myScore, oppScore: oppScore };

        if (g.gameType === "playoff") {
          byOpponent[opponentKey].playoffGames.push(gameRecord);
          overallPlayoffGames.push(gameRecord);
        } else {
          byOpponent[opponentKey].regularGames.push(gameRecord);
          overallRegularGames.push(gameRecord);
        }
      });
    });

    var rows = Object.keys(byOpponent)
      .map(function (k) {
        var entry = byOpponent[k];
        return {
          opponentKey: entry.opponentKey,
          opponentName: entry.opponentName,
          regularSummary: summarizeGames(entry.regularGames),
          playoffSummary: summarizeGames(entry.playoffGames),
        };
      })
      .filter(function (row) {
        return row.regularSummary.totalGames > 0 || row.playoffSummary.totalGames > 0;
      })
      .sort(function (a, b) {
        return a.opponentName.localeCompare(b.opponentName);
      });

    return {
      overallRegular: summarizeGames(overallRegularGames),
      overallPlayoff: summarizeGames(overallPlayoffGames),
      byOpponent: rows,
    };
  }

  /** Distinct list of owner names seen across all seasons, for populating head-to-head and owner-vs-field dropdowns. */
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
    buildOwnerVsAll: buildOwnerVsAll,
    getAllOwnerNames: getAllOwnerNames,
  };
})();
