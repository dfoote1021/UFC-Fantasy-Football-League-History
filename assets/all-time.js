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
 *   1. Career totals: one row per owner, combined W-L-T, points for/
 *      against, championships, playoff appearances, seasons played -
 *      across every year of the league's history.
 *   2. Head-to-head: for any two owners, every individual matchup
 *      they've ever played against each other, plus the aggregate
 *      record between them.
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

  /**
   * Loads and normalizes ONE ESPN season into the shape used by the
   * aggregator: a list of per-team season summaries, plus a flat list
   * of individual games (one entry per game, with both owners'
   * identities and scores, so head-to-head lookups can pull either
   * side).
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
          wins: t.wins || 0,
          losses: t.losses || 0,
          ties: t.ties || 0,
          pointsFor: t.fpts || 0,
          pointsAgainst: t.fptsAgainst || 0,
          madePlayoffs: !!t.madePlayoffs,
          isChampion: !!t.isChampionFlag,
          isRunnerUp: !!t.isRunnerUpFlag,
        };
      });

      var games = [];
      (data.rows || []).forEach(function (r) {
        if (r.opponent === "BYE" || !r.opponent) return;
        var teamOwner = normalizeOwnerKey(r.teamOwner);
        var oppOwner = normalizeOwnerKey(r.opponentOwner);
        if (!teamOwner || !oppOwner) return;

        games.push({
          year: year,
          source: "espn",
          week: r.week,
          isPlayoff: r.isPlayoff,
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
   * Loads and normalizes ONE Sleeper season into the same shape as
   * loadEspnSeasonForAllTime, resolving each roster's owner through
   * SleeperAPI.buildRosterMap (which already applies owner-overrides.js).
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
          wins: t.wins || 0,
          losses: t.losses || 0,
          ties: t.ties || 0,
          pointsFor: t.fpts || 0,
          pointsAgainst: t.fptsAgainst || 0,
          madePlayoffs: false, // Sleeper doesn't expose a reliable per-roster playoff flag pre-completion; left false rather than guessed
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

            games.push({
              year: year,
              source: "sleeper",
              week: week,
              isPlayoff: isPlayoffWeek,
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
   * Aggregates every season's teamSummaries into one row per owner,
   * covering their entire career across both ESPN and Sleeper eras.
   */
  function buildCareerTotals(allSeasonsData) {
    var byOwner = {};

    allSeasonsData.forEach(function (season) {
      season.teamSummaries.forEach(function (t) {
        if (!byOwner[t.ownerKey]) {
          byOwner[t.ownerKey] = {
            ownerKey: t.ownerKey,
            ownerName: t.ownerName,
            seasons: 0,
            wins: 0,
            losses: 0,
            ties: 0,
            pointsFor: 0,
            pointsAgainst: 0,
            championships: 0,
            runnerUps: 0,
            playoffAppearances: 0,
            yearsList: [],
          };
        }
        var entry = byOwner[t.ownerKey];
        entry.seasons += 1;
        entry.wins += t.wins;
        entry.losses += t.losses;
        entry.ties += t.ties;
        entry.pointsFor += t.pointsFor;
        entry.pointsAgainst += t.pointsAgainst;
        if (t.isChampion) entry.championships += 1;
        if (t.isRunnerUp) entry.runnerUps += 1;
        if (t.madePlayoffs) entry.playoffAppearances += 1;
        entry.yearsList.push(t.year);
      });
    });

    return Object.keys(byOwner)
      .map(function (k) {
        var e = byOwner[k];
        e.pointsFor = Math.round(e.pointsFor * 100) / 100;
        e.pointsAgainst = Math.round(e.pointsAgainst * 100) / 100;
        e.winPct = e.wins + e.losses + e.ties > 0 ? e.wins / (e.wins + e.losses + e.ties) : 0;
        e.yearsList.sort(function (a, b) {
          return a - b;
        });
        return e;
      })
      .sort(function (a, b) {
        if (b.championships !== a.championships) return b.championships - a.championships;
        if (b.winPct !== a.winPct) return b.winPct - a.winPct;
        return b.wins - a.wins;
      });
  }

  /**
   * Every individual game ever played between two specific owners,
   * across all seasons, plus the aggregate head-to-head record.
   * ownerAQuery/ownerBQuery are matched case-insensitively against
   * ownerKey.
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

    var summary = {
      totalGames: matchups.length,
      ownerAWins: 0,
      ownerBWins: 0,
      ties: 0,
      ownerATotalPoints: 0,
      ownerBTotalPoints: 0,
    };

    matchups.forEach(function (m) {
      summary.ownerATotalPoints += m.ownerAScore || 0;
      summary.ownerBTotalPoints += m.ownerBScore || 0;
      if (m.ownerAScore > m.ownerBScore) summary.ownerAWins += 1;
      else if (m.ownerBScore > m.ownerAScore) summary.ownerBWins += 1;
      else summary.ties += 1;
    });

    summary.ownerAvgA = summary.totalGames > 0 ? summary.ownerATotalPoints / summary.totalGames : 0;
    summary.ownerAvgB = summary.totalGames > 0 ? summary.ownerBTotalPoints / summary.totalGames : 0;

    return { matchups: matchups, summary: summary };
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
