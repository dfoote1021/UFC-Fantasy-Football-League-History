/**
 * sleeper-common.js
 * Shared Sleeper API module for the league history website.
 * Works for every Sleeper season (2022-2026+) - pass the league ID
 * for the season you want and use the returned helper functions.
 *
 * Sleeper's API is public, read-only, and CORS-enabled for browser use.
 * Docs: https://docs.sleeper.com
 *
 * Everything is wrapped in an IIFE and attached only to window.SleeperAPI.
 * No top-level const/let/var/function declarations leak into global scope,
 * which avoids "Can't create duplicate variable that shadows a global
 * property" errors if this script is ever loaded more than once or a name
 * collides with a browser global.
 */

(function () {
  "use strict";

  var SLEEPER_API = "https://api.sleeper.app/v1";

  var SLEEPER_SEASONS = {
    2022: "865720986757148672",
    2023: "916383087834144768",
    2024: "1050922562051502080",
    2025: "1223385474970685440",
    2026: "1336814612464549888",
  };

  var CURRENT_LIVE_SEASON = 2026;

  function sleeperGet(path) {
    return fetch(SLEEPER_API + path).then(function (res) {
      if (!res.ok) {
        throw new Error("Sleeper API error " + res.status + " for " + path);
      }
      return res.json();
    });
  }

  function getLeague(leagueId) {
    return sleeperGet("/league/" + leagueId);
  }

  function getUsers(leagueId) {
    return sleeperGet("/league/" + leagueId + "/users");
  }

  function getRosters(leagueId) {
    return sleeperGet("/league/" + leagueId + "/rosters");
  }

  function getMatchups(leagueId, week) {
    return sleeperGet("/league/" + leagueId + "/matchups/" + week);
  }

  function getDraft(leagueId) {
    return sleeperGet("/league/" + leagueId + "/drafts").then(function (drafts) {
      return drafts && drafts.length ? drafts[0] : null;
    });
  }

  function getDraftPicks(draftId) {
    return sleeperGet("/draft/" + draftId + "/picks");
  }

  function getTradedPicks(leagueId) {
    return sleeperGet("/league/" + leagueId + "/traded_picks");
  }

  function getTransactions(leagueId, week) {
    return sleeperGet("/league/" + leagueId + "/transactions/" + week);
  }

  function getWinnersBracket(leagueId) {
    return sleeperGet("/league/" + leagueId + "/winners_bracket");
  }

  function getLosersBracket(leagueId) {
    return sleeperGet("/league/" + leagueId + "/losers_bracket");
  }

  function getNFLState() {
    return sleeperGet("/state/nfl");
  }

  function getPlayersMap() {
    var cacheKey = "sleeper_players_cache_v1";
    var cacheTimeKey = "sleeper_players_cache_time_v1";
    var oneDayMs = 24 * 60 * 60 * 1000;

    var cachedTime = localStorage.getItem(cacheTimeKey);
    if (cachedTime && Date.now() - Number(cachedTime) < oneDayMs) {
      var cached = localStorage.getItem(cacheKey);
      if (cached) return Promise.resolve(JSON.parse(cached));
    }

    return sleeperGet("/players/nfl").then(function (players) {
      try {
        localStorage.setItem(cacheKey, JSON.stringify(players));
        localStorage.setItem(cacheTimeKey, String(Date.now()));
      } catch (e) {
        /* localStorage quota exceeded - safe to ignore */
      }
      return players;
    });
  }

  function buildRosterMap(users, rosters) {
    var userById = {};
    users.forEach(function (u) {
      userById[u.user_id] = u;
    });

    var rosterMap = {};
    rosters.forEach(function (r) {
      var user = userById[r.owner_id] || {};
      var teamName =
        (user.metadata && user.metadata.team_name) ||
        user.display_name ||
        "Unknown Team";
      rosterMap[r.roster_id] = {
        rosterId: r.roster_id,
        ownerId: r.owner_id,
        teamName: teamName,
        displayName: user.display_name || "Unknown Owner",
        avatar: user.avatar
          ? "https://sleepercdn.com/avatars/thumbs/" + user.avatar
          : null,
        wins: r.settings ? r.settings.wins : 0,
        losses: r.settings ? r.settings.losses : 0,
        ties: r.settings ? r.settings.ties : 0,
        fpts:
          r.settings && r.settings.fpts !== undefined
            ? r.settings.fpts + (r.settings.fpts_decimal || 0) / 100
            : 0,
        fptsAgainst:
          r.settings && r.settings.fpts_against !== undefined
            ? r.settings.fpts_against + (r.settings.fpts_against_decimal || 0) / 100
            : 0,
        waiverBudgetUsed: r.settings ? r.settings.waiver_budget_used : 0,
        starters: r.starters || [],
        players: r.players || [],
      };
    });
    return rosterMap;
  }

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

  function pairMatchups(matchups, rosterMap) {
    var grouped = {};
    matchups.forEach(function (m) {
      if (!grouped[m.matchup_id]) grouped[m.matchup_id] = [];
      grouped[m.matchup_id].push(m);
    });

    return Object.keys(grouped).map(function (key) {
      var pair = grouped[key];
      var a = pair[0];
      var b = pair[1];
      var teamA = rosterMap[a.roster_id] || {};
      var result = {
        matchupId: a.matchup_id,
        teamA: Object.assign({}, teamA, { points: a.points || 0 }),
        teamB: null,
      };
      if (b) {
        var teamB = rosterMap[b.roster_id] || {};
        result.teamB = Object.assign({}, teamB, { points: b.points || 0 });
      }
      return result;
    });
  }

  function getDefaultWeek(league) {
    return getNFLState()
      .then(function (state) {
        if (league.season === state.season) {
          return Math.max(1, state.display_week || state.week || 1);
        }
        return (league.settings && league.settings.leg) || 17;
      })
      .catch(function () {
        return 1;
      });
  }

  function buildSeasonSnapshot(leagueId) {
    return Promise.all([
      getLeague(leagueId),
      getUsers(leagueId),
      getRosters(leagueId),
      getDraft(leagueId),
      getTradedPicks(leagueId),
    ]).then(function (results) {
      var league = results[0];
      var users = results[1];
      var rosters = results[2];
      var draft = results[3];
      var tradedPicks = results[4];

      var draftPicksPromise = draft
        ? getDraftPicks(draft.draft_id)
        : Promise.resolve([]);

      return draftPicksPromise.then(function (draftPicks) {
        var weeks = [];
        for (var i = 1; i <= 18; i++) weeks.push(i);

        var allMatchups = {};
        var allTransactions = {};

        var chain = Promise.resolve();
        weeks.forEach(function (week) {
          chain = chain
            .then(function () {
              return getMatchups(leagueId, week).catch(function () {
                return [];
              });
            })
            .then(function (m) {
              allMatchups[week] = m;
              return getTransactions(leagueId, week).catch(function () {
                return [];
              });
            })
            .then(function (t) {
              allTransactions[week] = t;
            });
        });

        return chain.then(function () {
          return {
            exportedAt: new Date().toISOString(),
            league: league,
            users: users,
            rosters: rosters,
            draft: draft,
            draftPicks: draftPicks,
            tradedPicks: tradedPicks,
            matchupsByWeek: allMatchups,
            transactionsByWeek: allTransactions,
          };
        });
      });
    });
  }

  function downloadJSON(data, filename) {
    var blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  window.SleeperAPI = {
    SLEEPER_SEASONS: SLEEPER_SEASONS,
    CURRENT_LIVE_SEASON: CURRENT_LIVE_SEASON,
    getLeague: getLeague,
    getUsers: getUsers,
    getRosters: getRosters,
    getMatchups: getMatchups,
    getDraft: getDraft,
    getDraftPicks: getDraftPicks,
    getTradedPicks: getTradedPicks,
    getTransactions: getTransactions,
    getWinnersBracket: getWinnersBracket,
    getLosersBracket: getLosersBracket,
    getNFLState: getNFLState,
    getPlayersMap: getPlayersMap,
    buildRosterMap: buildRosterMap,
    sortStandings: sortStandings,
    pairMatchups: pairMatchups,
    getDefaultWeek: getDefaultWeek,
    buildSeasonSnapshot: buildSeasonSnapshot,
    downloadJSON: downloadJSON,
  };
})();
