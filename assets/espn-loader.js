/**
 * all-time.js
 * Builds career (all-time, cross-season) statistics by loading every
 * ESPN CSV year AND every Sleeper league year, then aggregating by
 * OWNER display name - since that's the one identifier that stays
 * consistent for the same real person across both eras (ESPN CSVs
 * already use real names like "Dan"/"Spencer" as their owner column,
 * and owner-overrides.js maps Sleeper usernames to those same names).
 *
 * Five things this module produces:
 *   1. Career totals: one row per owner, W-L-T and points for/against
 *      split into REGULAR SEASON and PLAYOFFS separately (plus a
 *      combined total), championships, playoff appearances, seasons
 *      played, and total transactions - across every year of the
 *      league's history.
 *   2. Head-to-head: for any two owners, every individual matchup
 *      they've ever played against each other, with regular-season
 *      and playoff results broken out separately.
 *   3. Owner vs. the field: for a single owner, their regular-season
 *      and playoff record against EVERY opponent they've ever played.
 *   4. League-wide records: "fun stat" leaderboards (most/least points
 *      in a week, largest/smallest margin of victory/defeat) - both a
 *      league-wide MASTER leaderboard and a PER-MEMBER personal-best
 *      view, each computed separately for regular season vs playoffs.
 *   5. Single-SEASON records: the exact same six stats and Master/
 *      Per-Member views, but scoped to just one season - used by
 *      season.js's own "Records" tab so a single season's page can
 *      show that year's own bests/worsts using the identical
 *      classification logic as the All-Time view (no drift between
 *      the two - see buildSeasonMasterRecords/buildSeasonMemberRecords
 *      near the bottom of this file).
 *
 * Each game is classified into exactly one of three buckets - see the
 * detailed bracket-resolution comments above buildActivePlayoffPairs
 * for the full history of bugs found/fixed in that classification
 * logic (byes, t1_from/t2_from resolution, and the p:1-is-the-
 * championship fix, all confirmed against Sleeper's official API docs):
 *   - "regular"     games during the normal season schedule.
 *   - "playoff"     games on a team's ACTIVE championship path in the
 *                   winners bracket, including the championship game
 *                   itself.
 *   - "consolation" the separate loser's/toilet-bowl bracket, any
 *                   non-championship placement game (3rd place, etc.),
 *                   and any later-round winners-bracket game for a
 *                   team already eliminated from the title path.
 *                   Excluded from every total in every view.
 *
 * TRANSACTIONS: ESPN-era transaction counts come directly from
 * espn-loader.js's per-team `totalMoves` field (sourced from the CSV
 * you provided) - if a given ESPN season's CSV doesn't include that
 * field for a team, it contributes 0 rather than breaking the total,
 * and hasIncompleteTransactionData is set so the UI can flag it.
 * Sleeper-era counts are pulled live via SleeperAPI.getTransactions
 * for every played week of every Sleeper season and tallied per roster,
 * then attributed to that roster's owner. This total is currently
 * surfaced in the All-Time -> Career Totals table's "Txns" column.
 *
 * This is intentionally a separate module from season.js/espn-loader.js
 * /sleeper-common.js - it READS data through those existing loaders
 * rather than duplicating any parsing logic.
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

  /** True only for a genuine placement/consolation game - p is set AND is not 1 (1 = championship). */
  function isNonChampionshipPlacementGame(m) {
    return !!(m.p && m.p !== 1);
  }

  /**
   * Resolves a bracket match's t1 or t2 participant. Tries the literal
   * field first; if that's missing, follows the corresponding
   * t1_from/t2_from reference to the match it points at (by matchId)
   * and returns that match's winner (`w`) or loser (`l`) roster id.
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
   * Walks a Sleeper-style winners bracket to find the set of roster-id
   * pairings that represent a real "still alive on the championship
   * path" playoff game - including the championship game itself (p:1) -
   * NOT tied to a specific calendar week. See the module header for the
   * full history of why this logic looks the way it does.
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
        if (isNonChampionshipPlacementGame(m)) return;

        var t1 = resolveBracketSlot(m, "t1", byMatchId);
        var t2 = resolveBracketSlot(m, "t2", byMatchId);
        if (!t1 || !t2) return;

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
   * aggregator, including per-team transaction counts sourced directly
   * from espn-loader.js's `totalMoves` field (populated from your CSV).
   */
  function loadEspnSeasonForAllTime(year) {
    return window.EspnLoader.loadSeason(year).then(function (data) {
      var teamSummaries = Object.keys(data.rosterMap).map(function (teamKey) {
        var t = data.rosterMap[teamKey];
        var hasMoveData = t.totalMoves !== undefined && t.totalMoves !== null;
        return {
          year: year,
          source: "espn",
          ownerKey: normalizeOwnerKey(t.displayName || t.ownerId),
          ownerName: t.displayName || t.ownerId,
          teamName: t.teamName,
          madePlayoffs: !!t.madePlayoffs,
          isChampion: !!t.isChampionFlag,
          isRunnerUp: !!t.isRunnerUpFlag,
          transactions: hasMoveData ? t.totalMoves : 0,
          hasIncompleteTransactionData: !hasMoveData,
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
                  "treating all playoff-week games as 'playoff'."
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

  function buildActivePlayoffPairsEspn(winnersBracket) {
    var activePairs = {};
    if (!winnersBracket) return activePairs;

    var eliminatedNames = {};

    winnersBracket.forEach(function (roundData) {
      (roundData.matches || []).forEach(function (m) {
        var placementValue = m.placement || m.p;
        var isNonChampionshipPlacement = !!(placementValue && placementValue !== 1);
        if (isNonChampionshipPlacement) return;

        var nameA = m.slot1 && (m.slot1.teamName || m.slot1.ownerName);
        var nameB = m.slot2 && (m.slot2.teamName || m.slot2.ownerName);
        if (!nameA || !nameB) return;

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
   * Loads and normalizes ONE Sleeper season, including per-roster
   * transaction counts pulled live from SleeperAPI.getTransactions for
   * every played week, tallied and attributed to each roster's owner.
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

      var maxWeek = SleeperAPI.MAX_SLEEPER_WEEK || 17;
      var txnWeeks = [];
      for (var w = 1; w <= maxWeek; w++) txnWeeks.push(w);

      var txnChain = Promise.resolve();
      var txnCountsByRoster = {};
      txnWeeks.forEach(function (week) {
        txnChain = txnChain
          .then(function () {
            return SleeperAPI.getTransactions(leagueId, week).catch(function () {
              return [];
            });
          })
          .then(function (txns) {
            var counts = SleeperAPI.countTransactionsByRoster(txns || []);
            Object.keys(counts).forEach(function (rid) {
              txnCountsByRoster[rid] = (txnCountsByRoster[rid] || 0) + counts[rid];
            });
          });
      });

      return txnChain.then(function () {
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
            transactions: txnCountsByRoster[rid] || 0,
            hasIncompleteTransactionData: false,
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
              if (!a || !b) return;

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
    });
  }

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

  function accumulateGameRecords(allSeasonsData) {
    var byOwner = {};

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
        if (g.gameType === "consolation") return;

        var splitKey = g.gameType === "playoff" ? "playoff" : "regular";
        var entryA = ensure(g.ownerAKey);
        var entryB = ensure(g.ownerBKey);
        applyResult(entryA[splitKey], g.ownerAScore, g.ownerBScore);
        applyResult(entryB[splitKey], g.ownerBScore, g.ownerAScore);
      });
    });

    return byOwner;
  }

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
            totalTransactions: 0,
            hasIncompleteTransactionData: false,
            yearsList: [],
          };
        }
        var entry = byOwner[t.ownerKey];
        entry.seasons += 1;
        if (t.isChampion) entry.championships += 1;
        if (t.isRunnerUp) entry.runnerUps += 1;
        if (t.madePlayoffs) entry.playoffAppearances += 1;
        entry.totalTransactions += t.transactions || 0;
        if (t.hasIncompleteTransactionData) entry.hasIncompleteTransactionData = true;
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

  function buildOwnerVsAll(allSeasonsData, ownerQuery) {
    var ownerKey = normalizeOwnerKey(ownerQuery);

    var byOpponent = {};
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

  /**
   * Builds a flat list of "game sides" - one entry per team per game -
   * from a given LIST OF GAMES (not the full allSeasonsData - callers
   * decide the scope: all seasons combined, for the All-Time records,
   * or just one season's games, for the per-season records tab) for a
   * given split ("regular" or "playoff"), optionally filtered to a
   * single owner. Consolation games are always excluded implicitly
   * since callers only ever pass games already filtered to a specific
   * gameType, or this function itself filters by matching g.gameType
   * against the requested split.
   */
  function buildGameSidesFromGames(games, split, ownerKeyFilter) {
    var sides = [];

    games.forEach(function (g) {
      if (g.gameType !== split) return;

      if (!ownerKeyFilter || g.ownerAKey === ownerKeyFilter) {
        sides.push({
          ownerKey: g.ownerAKey,
          ownerName: g.ownerAName,
          teamName: g.ownerATeamName,
          myScore: g.ownerAScore,
          opponentName: g.ownerBName,
          opponentTeamName: g.ownerBTeamName,
          oppScore: g.ownerBScore,
          year: g.year,
          week: g.week,
          source: g.source,
        });
      }
      if (!ownerKeyFilter || g.ownerBKey === ownerKeyFilter) {
        sides.push({
          ownerKey: g.ownerBKey,
          ownerName: g.ownerBName,
          teamName: g.ownerBTeamName,
          myScore: g.ownerBScore,
          opponentName: g.ownerAName,
          opponentTeamName: g.ownerATeamName,
          oppScore: g.ownerAScore,
          year: g.year,
          week: g.week,
          source: g.source,
        });
      }
    });

    return sides;
  }

  /** Convenience wrapper: same as buildGameSidesFromGames, but scoped to every season's games combined. */
  function buildGameSides(allSeasonsData, split, ownerKeyFilter) {
    var allGames = [];
    allSeasonsData.forEach(function (season) {
      allGames = allGames.concat(season.games);
    });
    return buildGameSidesFromGames(allGames, split, ownerKeyFilter);
  }

  function toRecordEntry(side) {
    if (!side) return null;
    return {
      ownerName: side.ownerName,
      teamName: side.teamName,
      opponentName: side.opponentName,
      opponentTeamName: side.opponentTeamName,
      myScore: Math.round(side.myScore * 100) / 100,
      oppScore: Math.round(side.oppScore * 100) / 100,
      margin: Math.round(Math.abs(side.myScore - side.oppScore) * 100) / 100,
      year: side.year,
      week: side.week,
      source: side.source,
    };
  }

  /**
   * Computes the six "fun stat" records from a flat list of game
   * sides: most/least points scored in a single game, and largest/
   * smallest margin of victory and defeat. Ties are broken by taking
   * the earliest occurrence (sorted by year, then week).
   */
  function computeRecordsFromSides(sides) {
    if (!sides || sides.length === 0) {
      return {
        mostPoints: null,
        leastPoints: null,
        largestMarginVictory: null,
        smallestMarginVictory: null,
        largestMarginDefeat: null,
        smallestMarginDefeat: null,
      };
    }

    var sorted = sides.slice().sort(function (a, b) {
      if (a.year !== b.year) return a.year - b.year;
      return (a.week || 0) - (b.week || 0);
    });

    var wins = sorted.filter(function (s) {
      return s.myScore > s.oppScore;
    });
    var losses = sorted.filter(function (s) {
      return s.myScore < s.oppScore;
    });

    function best(list, compareFn) {
      if (list.length === 0) return null;
      return list.reduce(function (a, b) {
        return compareFn(b, a) > 0 ? b : a;
      });
    }

    var mostPoints = best(sorted, function (a, b) {
      return a.myScore - b.myScore;
    });
    var leastPoints = best(sorted, function (a, b) {
      return b.myScore - a.myScore;
    });
    var largestMarginVictory = best(wins, function (a, b) {
      return a.myScore - a.oppScore - (b.myScore - b.oppScore);
    });
    var smallestMarginVictory = best(wins, function (a, b) {
      return b.myScore - b.oppScore - (a.myScore - a.oppScore);
    });
    var largestMarginDefeat = best(losses, function (a, b) {
      return a.oppScore - a.myScore - (b.oppScore - b.myScore);
    });
    var smallestMarginDefeat = best(losses, function (a, b) {
      return b.oppScore - b.myScore - (a.oppScore - a.myScore);
    });

    return {
      mostPoints: toRecordEntry(mostPoints),
      leastPoints: toRecordEntry(leastPoints),
      largestMarginVictory: toRecordEntry(largestMarginVictory),
      smallestMarginVictory: toRecordEntry(smallestMarginVictory),
      largestMarginDefeat: toRecordEntry(largestMarginDefeat),
      smallestMarginDefeat: toRecordEntry(smallestMarginDefeat),
    };
  }

  /** League-wide MASTER records leaderboard (all seasons combined) for the given split. */
  function buildMasterRecords(allSeasonsData, split) {
    var sides = buildGameSides(allSeasonsData, split, null);
    return computeRecordsFromSides(sides);
  }

  /** PER-MEMBER records (all seasons combined) for a single owner and the given split. */
  function buildMemberRecords(allSeasonsData, split, ownerQuery) {
    var ownerKey = normalizeOwnerKey(ownerQuery);
    var sides = buildGameSides(allSeasonsData, split, ownerKey);
    return computeRecordsFromSides(sides);
  }

  /**
   * Pulls just ONE season's games array out of the cached allSeasonsData
   * (which contains every ESPN + Sleeper season). Returns [] if that
   * year hasn't been loaded (shouldn't normally happen once
   * loadAllSeasons() has resolved, since it loads every configured
   * year up front). year is compared loosely (Number(year) === season.year)
   * so callers can pass either a number or a numeric string.
   */
  function getSeasonGames(allSeasonsData, year) {
    var yearNum = Number(year);
    var season = allSeasonsData.filter(function (s) {
      return s.year === yearNum;
    });
    if (season.length === 0) return [];
    // In the unlikely event both an ESPN and Sleeper entry exist for the
    // same year (shouldn't happen given how SLEEPER_SEASONS/ESPN_SEASONS
    // are configured), combine them rather than silently dropping one.
    var games = [];
    season.forEach(function (s) {
      games = games.concat(s.games);
    });
    return games;
  }

  /**
   * League MASTER records for a SINGLE season - the same six stats as
   * buildMasterRecords, but scoped to just that year's games, for
   * season.js's own "Records" tab. Uses the exact same
   * regular/playoff/consolation classification as the All-Time view
   * (both are derived from the same cached allSeasonsData), so a given
   * season's per-season records can never disagree with what that same
   * season's games contribute to the All-Time leaderboards.
   */
  function buildSeasonMasterRecords(allSeasonsData, year, split) {
    var games = getSeasonGames(allSeasonsData, year);
    var sides = buildGameSidesFromGames(games, split, null);
    return computeRecordsFromSides(sides);
  }

  /** PER-MEMBER records for a SINGLE season and a single owner - see buildSeasonMasterRecords. */
  function buildSeasonMemberRecords(allSeasonsData, year, split, ownerQuery) {
    var ownerKey = normalizeOwnerKey(ownerQuery);
    var games = getSeasonGames(allSeasonsData, year);
    var sides = buildGameSidesFromGames(games, split, ownerKey);
    return computeRecordsFromSides(sides);
  }

  window.AllTimeStats = {
    loadAllSeasons: loadAllSeasons,
    buildCareerTotals: buildCareerTotals,
    buildHeadToHead: buildHeadToHead,
    buildOwnerVsAll: buildOwnerVsAll,
    buildMasterRecords: buildMasterRecords,
    buildMemberRecords: buildMemberRecords,
    buildSeasonMasterRecords: buildSeasonMasterRecords,
    buildSeasonMemberRecords: buildSeasonMemberRecords,
    getAllOwnerNames: getAllOwnerNames,
  };
})();
