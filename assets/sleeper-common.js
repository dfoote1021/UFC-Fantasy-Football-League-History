/**
 * sleeper-common.js
 * Shared Sleeper API module for the league history website.
 * Works for every Sleeper season (2022-2026+) - pass the league ID
 * for the season you want and use the returned helper functions.
 *
 * Sleeper's API is public, read-only, and CORS-enabled for browser use.
 * Docs: https://docs.sleeper.com
 *
 * Owner display names can be overridden site-wide via owner-overrides.js
 * (optional - if that script isn't loaded, or a username has no override
 * configured, this falls back to whatever Sleeper reports as display_name).
 *
 * IMPORTANT: this league does not use week 18. Some older Sleeper seasons
 * (e.g. 2022) actually DO have real scored matchup data in week 18 from
 * when the NFL/Sleeper schedule extended that far, but this league treats
 * week 18 as out of scope for every season regardless of what Sleeper's
 * API returns. MAX_SLEEPER_WEEK below is a hard cutoff applied everywhere
 * weeks are fetched, listed, or used in calculations, so week 18 (and
 * beyond) is never fetched, displayed, or counted - for any season.
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

  /**
   * Hard cutoff: this league never uses week 18 or beyond, for any
   * season, even when Sleeper's API has real data there (as it does for
   * 2022). Every function that fetches, lists, or computes across weeks
   * respects this constant.
   */
  var MAX_SLEEPER_WEEK = 17;

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

  /**
   * Resolve a Sleeper user's display name through window.OwnerOverrides
   * if that script is loaded and has a mapping for this user (checked by
   * both display_name and username, since either might be what you set
   * up an override for). Falls back to the raw Sleeper display_name
   * unchanged if no override applies.
   */
  function resolveDisplayName(user) {
    var raw = user.display_name || "Unknown Owner";
    if (window.OwnerOverrides && typeof window.OwnerOverrides.resolveOwnerName === "function") {
      var byDisplayName = window.OwnerOverrides.resolveOwnerName(raw);
      if (byDisplayName !== raw) return byDisplayName;
      if (user.username) {
        var byUsername = window.OwnerOverrides.resolveOwnerName(user.username);
        if (byUsername !== user.username) return byUsername;
      }
    }
    return raw;
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
        displayName: resolveDisplayName(user),
        avatar: user.avatar
          ? "https://sleepercdn.com/avatars/thumbs/" + user.avatar
          : null,
        division: r.settings ? r.settings.division || null : null,
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
        totalMoves: r.settings ? r.settings.total_moves || 0 : 0,
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

  function buildSeedMap(rosterMap) {
    var standings = sortStandings(rosterMap);
    var seedMap = {};
    standings.forEach(function (team, idx) {
      seedMap[team.rosterId] = idx + 1;
    });
    return seedMap;
  }

  function getDivisionNames(league) {
    if (!league.settings || !league.settings.divisions) return null;
    var count = league.settings.divisions;
    if (!count || count < 1) return null;
    var names = {};
    for (var i = 1; i <= count; i++) {
      var key = "division_" + i;
      names[i] = (league.metadata && league.metadata[key]) || "Division " + i;
    }
    return names;
  }

  function buildDivisionStandings(rosterMap, league, finalStandingsInfo) {
    var divisionNames = getDivisionNames(league);
    if (!divisionNames) return null;

    var allTeams = Object.keys(rosterMap).map(function (k) {
      return rosterMap[k];
    });
    var hasDivisions = allTeams.some(function (t) {
      return t.division;
    });
    if (!hasDivisions) return null;

    var champion = finalStandingsInfo ? finalStandingsInfo.champion : null;
    var runnerUp = finalStandingsInfo ? finalStandingsInfo.runnerUp : null;

    var groups = {};
    allTeams.forEach(function (team) {
      var div = team.division || 0;
      if (!groups[div]) groups[div] = [];
      groups[div].push(team);
    });

    return Object.keys(groups)
      .sort(function (a, b) {
        return Number(a) - Number(b);
      })
      .map(function (divKey) {
        var teams = groups[divKey].sort(function (a, b) {
          if (b.wins !== a.wins) return b.wins - a.wins;
          return b.fpts - a.fpts;
        });
        return {
          divisionNum: Number(divKey),
          divisionName: divisionNames[divKey] || "Division " + divKey,
          standings: teams,
          champion: champion,
          runnerUp: runnerUp,
        };
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
        var week;
        if (league.season === state.season) {
          week = Math.max(1, state.display_week || state.week || 1);
        } else {
          week = (league.settings && league.settings.leg) || MAX_SLEEPER_WEEK;
        }
        return Math.min(week, MAX_SLEEPER_WEEK);
      })
      .catch(function () {
        return 1;
      });
  }

  /**
   * A week is considered "played" if Sleeper returned at least one
   * matchup row for it AND at least one roster in that week has a
   * non-zero score. Combined with the hard MAX_SLEEPER_WEEK cutoff
   * applied everywhere this is used, week 18+ is never fetched or
   * considered regardless of what Sleeper's API has stored for it.
   */
  function isWeekPlayed(weekMatchups) {
    if (!weekMatchups || weekMatchups.length === 0) return false;
    return weekMatchups.some(function (m) {
      return (m.points || 0) > 0;
    });
  }

  /**
   * Fetches matchups for weeks 1..maxWeek, hard-capped at
   * MAX_SLEEPER_WEEK regardless of what's passed in - this league never
   * uses week 18 or beyond, for any season, so it's never even
   * requested from Sleeper's API.
   */
  function getAllWeeksMatchups(leagueId, maxWeek) {
    var cappedMaxWeek = Math.min(maxWeek || MAX_SLEEPER_WEEK, MAX_SLEEPER_WEEK);
    var weeks = [];
    for (var i = 1; i <= cappedMaxWeek; i++) weeks.push(i);

    var results = {};
    var chain = Promise.resolve();
    weeks.forEach(function (week) {
      chain = chain
        .then(function () {
          return getMatchups(leagueId, week).catch(function () {
            return [];
          });
        })
        .then(function (m) {
          results[week] = m;
        });
    });
    return chain.then(function () {
      return results;
    });
  }

  /**
   * Filters allWeeksMatchups down to only the weeks that have actually
   * been played (see isWeekPlayed above) AND are at or below
   * MAX_SLEEPER_WEEK, sorted ascending.
   */
  function getPlayedWeeks(allWeeksMatchups) {
    return Object.keys(allWeeksMatchups)
      .map(Number)
      .filter(function (week) {
        return week <= MAX_SLEEPER_WEEK && isWeekPlayed(allWeeksMatchups[week]);
      })
      .sort(function (a, b) {
        return a - b;
      });
  }

  function buildTeamSchedule(allWeeksMatchups, rosterId, rosterMap, runningRecordsByWeek, playoffStartWeek) {
    var schedule = [];
    Object.keys(allWeeksMatchups)
      .map(Number)
      .filter(function (week) {
        return week <= MAX_SLEEPER_WEEK && isWeekPlayed(allWeeksMatchups[week]);
      })
      .sort(function (a, b) {
        return a - b;
      })
      .forEach(function (week) {
        var weekMatchups = allWeeksMatchups[week];

        var mine = weekMatchups.find(function (m) {
          return m.roster_id === rosterId;
        });
        if (!mine) return;

        var opponent = weekMatchups.find(function (m) {
          return m.matchup_id === mine.matchup_id && m.roster_id !== rosterId;
        });

        var myPoints = mine.points || 0;
        var oppPoints = opponent ? opponent.points || 0 : 0;
        var result = !opponent ? "BYE" : myPoints > oppPoints ? "W" : myPoints < oppPoints ? "L" : "T";

        var isPlayoffWeek = !!playoffStartWeek && week >= playoffStartWeek;
        var recordAfter = "-";
        if (!isPlayoffWeek && runningRecordsByWeek && runningRecordsByWeek[week]) {
          recordAfter = runningRecordsByWeek[week][rosterId] || "-";
        }

        schedule.push({
          week: week,
          opponentRosterId: opponent ? opponent.roster_id : null,
          opponentName: opponent
            ? (rosterMap[opponent.roster_id] ? rosterMap[opponent.roster_id].teamName : "Roster " + opponent.roster_id)
            : "BYE",
          myPoints: myPoints,
          opponentPoints: opponent ? oppPoints : null,
          result: result,
          isPlayoff: isPlayoffWeek,
          recordAfter: recordAfter,
        });
      });
    return schedule;
  }

  /**
   * Compute every roster's cumulative regular-season win-loss(-tie)
   * record through and including a given week. Only weeks that are
   * <= MAX_SLEEPER_WEEK and pass isWeekPlayed() are counted.
   *
   * Returns { rosterId: "W-L" } (or "W-L-T" if that roster has any ties).
   */
  function buildRunningRecordsThroughWeek(allWeeksMatchups, week, playoffStartWeek) {
    var tally = {};

    function ensure(rosterId) {
      if (!tally[rosterId]) tally[rosterId] = { wins: 0, losses: 0, ties: 0 };
    }

    Object.keys(allWeeksMatchups)
      .map(Number)
      .filter(function (w) {
        var withinRange = w <= week && w <= MAX_SLEEPER_WEEK;
        var isRegularSeason = !playoffStartWeek || w < playoffStartWeek;
        var played = isWeekPlayed(allWeeksMatchups[w]);
        return withinRange && isRegularSeason && played;
      })
      .sort(function (a, b) {
        return a - b;
      })
      .forEach(function (w) {
        var weekMatchups = allWeeksMatchups[w] || [];
        var grouped = {};
        weekMatchups.forEach(function (m) {
          if (!grouped[m.matchup_id]) grouped[m.matchup_id] = [];
          grouped[m.matchup_id].push(m);
        });

        Object.keys(grouped).forEach(function (matchupId) {
          var pair = grouped[matchupId];
          var a = pair[0];
          var b = pair[1];
          if (!a) return;

          ensure(a.roster_id);
          if (!b) return; // bye week - no result to credit

          ensure(b.roster_id);

          var aPoints = a.points || 0;
          var bPoints = b.points || 0;

          if (aPoints > bPoints) {
            tally[a.roster_id].wins += 1;
            tally[b.roster_id].losses += 1;
          } else if (aPoints < bPoints) {
            tally[a.roster_id].losses += 1;
            tally[b.roster_id].wins += 1;
          } else {
            tally[a.roster_id].ties += 1;
            tally[b.roster_id].ties += 1;
          }
        });
      });

    var recordStrings = {};
    Object.keys(tally).forEach(function (rosterId) {
      var t = tally[rosterId];
      recordStrings[rosterId] =
        t.ties > 0 ? t.wins + "-" + t.losses + "-" + t.ties : t.wins + "-" + t.losses;
    });
    return recordStrings;
  }

  /**
   * Precompute running records for every PLAYED week (up to
   * MAX_SLEEPER_WEEK) in one pass, returning { week: { rosterId: "W-L" } }.
   */
  function buildAllRunningRecords(allWeeksMatchups, playoffStartWeek) {
    var result = {};
    getPlayedWeeks(allWeeksMatchups).forEach(function (week) {
      result[week] = buildRunningRecordsThroughWeek(allWeeksMatchups, week, playoffStartWeek);
    });
    return result;
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

  function buildBracketView(bracket, rosterMap, seedMap, weeksMatchupsByWeek, playoffStartWeek) {
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

    function findScore(weekNum, rosterId) {
      if (!weeksMatchupsByWeek || !rosterId) return null;
      var weekData = weeksMatchupsByWeek[weekNum];
      if (!weekData) return null;
      var entry = weekData.find(function (m) {
        return m.roster_id === rosterId;
      });
      return entry ? entry.points || 0 : null;
    }

    var roundsMap = {};
    bracket.forEach(function (m) {
      if (!roundsMap[m.r]) roundsMap[m.r] = [];
      var slot1 = resolveSlot(m.t1, m.t1_from);
      var slot2 = resolveSlot(m.t2, m.t2_from);
      var weekNum = playoffStartWeek ? playoffStartWeek + (m.r - 1) : null;
      roundsMap[m.r].push({
        matchId: m.m,
        position: m.p || null,
        week: weekNum,
        slot1: slot1,
        slot1Score: weekNum ? findScore(weekNum, slot1.rosterId) : null,
        slot2: slot2,
        slot2Score: weekNum ? findScore(weekNum, slot2.rosterId) : null,
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
   * Resolves a Sleeper transaction into display-ready detail, including
   * BOTH team names (`teams`) and their owners (`owners`), kept as
   * parallel arrays indexed the same way, so callers can render
   * "Team Name (Owner)" pairs for each side of the transaction. Owner
   * names respect owner-overrides.js automatically, since they come
   * from each roster's already-resolved displayName.
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
    function ownerLabel(rosterId) {
      var team = rosterMap[rosterId];
      return team ? team.displayName : "Unknown";
    }
    function teamWithOwnerLabel(rosterId) {
      var team = teamLabel(rosterId);
      var owner = ownerLabel(rosterId);
      return owner && owner !== team ? team + " (" + owner + ")" : team;
    }

    var adds = [];
    if (txn.adds) {
      Object.keys(txn.adds).forEach(function (pid) {
        adds.push({
          player: playerLabel(pid),
          team: teamLabel(txn.adds[pid]),
          owner: ownerLabel(txn.adds[pid]),
          teamWithOwner: teamWithOwnerLabel(txn.adds[pid]),
          rosterId: txn.adds[pid],
        });
      });
    }

    var drops = [];
    if (txn.drops) {
      Object.keys(txn.drops).forEach(function (pid) {
        drops.push({
          player: playerLabel(pid),
          team: teamLabel(txn.drops[pid]),
          owner: ownerLabel(txn.drops[pid]),
          teamWithOwner: teamWithOwnerLabel(txn.drops[pid]),
          rosterId: txn.drops[pid],
        });
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
      rosterIds: txn.roster_ids || [],
      teams: (txn.roster_ids || []).map(teamLabel),
      owners: (txn.roster_ids || []).map(ownerLabel),
      teamsWithOwners: (txn.roster_ids || []).map(teamWithOwnerLabel),
      adds: adds,
      drops: drops,
      draftPicks: draftPicks,
      faab: faab,
    };
  }

  function countTransactionsByRoster(allTransactions) {
    var counts = {};
    allTransactions.forEach(function (txn) {
      (txn.roster_ids || []).forEach(function (rid) {
        counts[rid] = (counts[rid] || 0) + 1;
      });
    });
    return counts;
  }

  /**
   * Builds a full downloadable JSON snapshot of a season. Matchups and
   * transactions are only fetched through MAX_SLEEPER_WEEK, since this
   * league never uses week 18+ for any season.
   */
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
        for (var i = 1; i <= MAX_SLEEPER_WEEK; i++) weeks.push(i);

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
    MAX_SLEEPER_WEEK: MAX_SLEEPER_WEEK,
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
    getDivisionNames: getDivisionNames,
    buildDivisionStandings: buildDivisionStandings,
    pairMatchups: pairMatchups,
    resolveMatchupRoster: resolveMatchupRoster,
    getDefaultWeek: getDefaultWeek,
    isWeekPlayed: isWeekPlayed,
    getPlayedWeeks: getPlayedWeeks,
    getAllWeeksMatchups: getAllWeeksMatchups,
    buildTeamSchedule: buildTeamSchedule,
    buildRunningRecordsThroughWeek: buildRunningRecordsThroughWeek,
    buildAllRunningRecords: buildAllRunningRecords,
    resolvePlayoffResults: resolvePlayoffResults,
    buildBracketView: buildBracketView,
    buildFinalStandings: buildFinalStandings,
    buildWeeklyRoster: buildWeeklyRoster,
    buildDraftBoard: buildDraftBoard,
    resolveTransactionDetail: resolveTransactionDetail,
    countTransactionsByRoster: countTransactionsByRoster,
    buildSeasonSnapshot: buildSeasonSnapshot,
    downloadJSON: downloadJSON,
  };
})();
