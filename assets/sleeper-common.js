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
 * No top-level const/let/var/function declarations leak into global scope.
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

  var _playersMapPromise = null;

  function getPlayersMap() {
    if (_playersMapPromise) return _playersMapPromise;

    var cacheKey = "sleeper_players_cache_v1";
    var cacheTimeKey = "sleeper_players_cache_time_v1";
    var oneDayMs = 24 * 60 * 60 * 1000;

    var cachedTime = localStorage.getItem(cacheTimeKey);
    if (cachedTime && Date.now() - Number(cachedTime) < oneDayMs) {
      var cached = localStorage.getItem(cacheKey);
      if (cached) {
        _playersMapPromise = Promise.resolve(JSON.parse(cached));
        return _playersMapPromise;
      }
    }

    _playersMapPromise = sleeperGet("/players/nfl").then(function (players) {
      try {
        localStorage.setItem(cacheKey, JSON.stringify(players));
        localStorage.setItem(cacheTimeKey, String(Date.now()));
      } catch (e) {
        /* localStorage quota exceeded - safe to ignore */
      }
      return players;
    });
    return _playersMapPromise;
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

  /** roster_id -> regular season seed (1 = best record), based on standings order. */
  function buildSeedMap(rosterMap) {
    var standings = sortStandings(rosterMap);
    var seedMap = {};
    standings.forEach(function (team, idx) {
      seedMap[team.rosterId] = idx + 1;
    });
    return seedMap;
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
        teamA: Object.assign({}, teamA, {
          points: a.points || 0,
          starters: a.starters || [],
          players: a.players || [],
          players_points: a.players_points || {},
        }),
        teamB: null,
      };
      if (b) {
        var teamB = rosterMap[b.roster_id] || {};
        result.teamB = Object.assign({}, teamB, {
          points: b.points || 0,
          starters: b.starters || [],
          players: b.players || [],
          players_points: b.players_points || {},
        });
      }
      return result;
    });
  }

  /**
   * Resolve starters/bench for one side of a matchup into named players,
   * using the players map. Mirrors buildWeeklyRoster's shape.
   */
  function resolveMatchupRoster(teamSide, playersMap) {
    if (!teamSide) return [];
    var starterSet = {};
    (teamSide.starters || []).forEach(function (pid) {
      starterSet[pid] = true;
    });
    var playerPoints = teamSide.players_points || {};

    var roster = (teamSide.players || []).map(function (pid) {
      var meta = (playersMap && playersMap[pid]) || {};
      return {
        playerId: pid,
        name: meta.full_name || (meta.first_name ? meta.first_name + " " + meta.last_name : pid),
        position: meta.position || "",
        team: meta.team || "FA",
        isStarter: !!starterSet[pid],
        points: playerPoints[pid] !== undefined ? playerPoints[pid] : null,
      };
    });

    roster.sort(function (a, b) {
      if (a.isStarter !== b.isStarter) return a.isStarter ? -1 : 1;
      return (b.points || 0) - (a.points || 0);
    });

    return roster;
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

  function resolvePlayoffResults(bracket) {
    if (!bracket || bracket.length === 0) {
      return { rounds: [], championRosterId: null, runnerUpRosterId: null };
    }

    var maxRound = Math.max.apply(
      null,
      bracket.map(function (m) {
        return m.r;
      })
    );

    var finalMatch = bracket.find(function (m) {
      return m.r === maxRound && m.p === 1;
    });
    if (!finalMatch) {
      finalMatch = bracket.find(function (m) {
        return m.r === maxRound;
      });
    }

    var championRosterId =
      finalMatch && finalMatch.w !== undefined ? finalMatch.w : null;
    var runnerUpRosterId =
      finalMatch && finalMatch.l !== undefined ? finalMatch.l : null;

    var roundsMap = {};
    bracket.forEach(function (m) {
      if (!roundsMap[m.r]) roundsMap[m.r] = [];
      roundsMap[m.r].push(m);
    });

    var rounds = Object.keys(roundsMap)
      .sort(function (a, b) {
        return Number(a) - Number(b);
      })
      .map(function (r) {
        return { round: Number(r), matches: roundsMap[r] };
      });

    return {
      rounds: rounds,
      championRosterId: championRosterId,
      runnerUpRosterId: runnerUpRosterId,
    };
  }

  /**
   * Build a bracket view (winners or losers) with each slot annotated with
   * regular-season seed number, using the seed map. Bracket matches can
   * reference a team directly (t1/t2 = roster_id) or reference the
   * winner/loser of a prior match (t1_from = {w: matchId} or {l: matchId});
   * this resolves those references so every round shows real team names
   * once determined, or "Winner/Loser of Match X" placeholders before
   * that round is played.
   */
  function buildBracketView(bracket, rosterMap, seedMap) {
    if (!bracket || bracket.length === 0) return [];

    var byMatchId = {};
    bracket.forEach(function (m) {
      byMatchId[m.m] = m;
    });

    function resolveSlot(rosterId, fromRef) {
      if (typeof rosterId === "number") {
        var team = rosterMap[rosterId];
        return {
          rosterId: rosterId,
          teamName: team ? team.teamName : "Roster " + rosterId,
          seed: seedMap[rosterId] || null,
          resolved: true,
        };
      }
      if (fromRef) {
        var label = fromRef.w !== undefined ? "Winner" : "Loser";
        var refId = fromRef.w !== undefined ? fromRef.w : fromRef.l;
        return {
          rosterId: null,
          teamName: label + " of Match " + refId,
          seed: null,
          resolved: false,
        };
      }
      return { rosterId: null, teamName: "BYE", seed: null, resolved: false };
    }

    var roundsMap = {};
    bracket.forEach(function (m) {
      if (!roundsMap[m.r]) roundsMap[m.r] = [];
      var slot1 = resolveSlot(m.t1, m.t1_from);
      var slot2 = resolveSlot(m.t2, m.t2_from);
      roundsMap[m.r].push({
        matchId: m.m,
        position: m.p || null,
        slot1: slot1,
        slot2: slot2,
        winnerRosterId: m.w !== undefined ? m.w : null,
        loserRosterId: m.l !== undefined ? m.l : null,
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

  function buildFinalStandings(rosterMap, winnersBracket) {
    var standings = sortStandings(rosterMap);
    var playoff = resolvePlayoffResults(winnersBracket);

    var champion = playoff.championRosterId
      ? rosterMap[playoff.championRosterId]
      : null;
    var runnerUp = playoff.runnerUpRosterId
      ? rosterMap[playoff.runnerUpRosterId]
      : null;

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
      if (idx > 0) {
        standings.splice(idx, 1);
      }
      standings.splice(champion ? 1 : 0, 0, runnerUp);
    }

    return {
      standings: standings,
      champion: champion,
      runnerUp: runnerUp,
      playoffRounds: playoff.rounds,
    };
  }

  function buildWeeklyRoster(matchupsForWeek, rosterId, playersMap) {
    var entry = matchupsForWeek.find(function (m) {
      return m.roster_id === rosterId;
    });
    if (!entry) return null;

    return {
      rosterId: rosterId,
      totalPoints: entry.points || 0,
      players: resolveMatchupRoster(entry, playersMap),
    };
  }

  function buildDraftBoard(picks, rosterMap) {
    var byRosterId = {};
    Object.keys(rosterMap).forEach(function (rid) {
      byRosterId[rid] = rosterMap[rid];
    });

    return picks
      .slice()
      .sort(function (a, b) {
        return a.pick_no - b.pick_no;
      })
      .map(function (pick) {
        var team = byRosterId[pick.roster_id] || null;
        var meta = pick.metadata || {};
        return {
          pickNo: pick.pick_no,
          round: pick.round,
          rosterId: pick.roster_id,
          teamName: team ? team.teamName : "Roster " + pick.roster_id,
          ownerName: team ? team.displayName : "Unknown",
          playerName:
            (meta.first_name || "") +
            (meta.first_name && meta.last_name ? " " : "") +
            (meta.last_name || "") || "Unknown Player",
          position: meta.position || "",
          nflTeam: meta.team || "",
        };
      });
  }

  /**
   * Resolve a raw transaction (with adds/drops as player_id -> roster_id maps)
   * into a readable summary listing each player added/dropped, their
   * position/team, and which fantasy team made the move. Also resolves
   * traded draft picks and FAAB spent for trade-type transactions.
   */
  function resolveTransactionDetail(txn, rosterMap, playersMap) {
    function playerLabel(pid) {
      var meta = (playersMap && playersMap[pid]) || {};
      var name = meta.full_name || (meta.first_name ? meta.first_name + " " + meta.last_name : pid);
      var pos = meta.position ? " (" + meta.position + (meta.team ? " " + meta.team : "") + ")" : "";
      return name + pos;
    }
    function teamLabel(rosterId) {
      var team = rosterMap[rosterId];
      return team ? team.teamName : "Roster " + rosterId;
    }

    var adds = [];
    if (txn.adds) {
      Object.keys(txn.adds).forEach(function (pid) {
        adds.push({ player: playerLabel(pid), team: teamLabel(txn.adds[pid]) });
      });
    }

    var drops = [];
    if (txn.drops) {
      Object.keys(txn.drops).forEach(function (pid) {
        drops.push({ player: playerLabel(pid), team: teamLabel(txn.drops[pid]) });
      });
    }

    var draftPicks = (txn.draft_picks || []).map(function (dp) {
      return {
        season: dp.season,
        round: dp.round,
        from: teamLabel(dp.previous_owner_id),
        to: teamLabel(dp.owner_id),
      };
    });

    var faab = null;
    if (txn.waiver_budget && txn.waiver_budget.length) {
      faab = txn.waiver_budget.map(function (wb) {
        return {
          amount: wb.amount,
          from: teamLabel(wb.sender),
          to: teamLabel(wb.receiver),
        };
      });
    }

    return {
      type: txn.type,
      status: txn.status,
      statusUpdated: txn.status_updated,
      teams: (txn.roster_ids || []).map(teamLabel),
      adds: adds,
      drops: drops,
      draftPicks: draftPicks,
      faab: faab,
    };
  }

  function buildSeasonSnapshot(leagueId) {
    return Promise.all([
      getLeague(leagueId),
      getUsers(leagueId),
      getRosters(leagueId),
      getDraft(leagueId),
      getTradedPicks(leagueId),
      getWinnersBracket(leagueId).catch(function () {
        return [];
      }),
      getLosersBracket(leagueId).catch(function () {
        return [];
      }),
    ]).then(function (results) {
      var league = results[0];
      var users = results[1];
      var rosters = results[2];
      var draft = results[3];
      var tradedPicks = results[4];
      var winnersBracket = results[5];
      var losersBracket = results[6];

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
            winnersBracket: winnersBracket,
            losersBracket: losersBracket,
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
    buildSeedMap: buildSeedMap,
    pairMatchups: pairMatchups,
    resolveMatchupRoster: resolveMatchupRoster,
    getDefaultWeek: getDefaultWeek,
    resolvePlayoffResults: resolvePlayoffResults,
    buildBracketView: buildBracketView,
    buildFinalStandings: buildFinalStandings,
    buildWeeklyRoster: buildWeeklyRoster,
    buildDraftBoard: buildDraftBoard,
    resolveTransactionDetail: resolveTransactionDetail,
    buildSeasonSnapshot: buildSeasonSnapshot,
    downloadJSON: downloadJSON,
  };
})();
