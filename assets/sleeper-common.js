/*
 * sleeper-common.js
 * Full replacement file for the UFC Fantasy Football League History site.
 *
 * Includes a safe first-round bye compatibility fix. The existing season.js
 * renderer expects both bracket slots to be objects, so synthetic bye entries
 * include a normal slot2 object instead of null.
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
        /* Safe to ignore: player data remains available in memory. */
      }
      return players;
    });

    return _playersMapPromise;
  }

  function resolveDisplayName(user) {
    var raw = user.display_name || "Unknown Owner";

    if (
      window.OwnerOverrides &&
      typeof window.OwnerOverrides.resolveOwnerName === "function"
    ) {
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
    users.forEach(function (user) {
      userById[user.user_id] = user;
    });

    var rosterMap = {};
    rosters.forEach(function (roster) {
      var user = userById[roster.owner_id] || {};
      var teamName =
        (user.metadata && user.metadata.team_name) ||
        user.display_name ||
        "Unknown Team";

      rosterMap[roster.roster_id] = {
        rosterId: roster.roster_id,
        ownerId: roster.owner_id,
        teamName: teamName,
        displayName: resolveDisplayName(user),
        avatar: user.avatar
          ? "https://sleepercdn.com/avatars/thumbs/" + user.avatar
          : null,
        division: roster.settings ? roster.settings.division || null : null,
        wins: roster.settings ? roster.settings.wins : 0,
        losses: roster.settings ? roster.settings.losses : 0,
        ties: roster.settings ? roster.settings.ties : 0,
        fpts:
          roster.settings && roster.settings.fpts !== undefined
            ? roster.settings.fpts + (roster.settings.fpts_decimal || 0) / 100
            : 0,
        fptsAgainst:
          roster.settings && roster.settings.fpts_against !== undefined
            ? roster.settings.fpts_against +
              (roster.settings.fpts_against_decimal || 0) / 100
            : 0,
        waiverBudgetUsed: roster.settings ? roster.settings.waiver_budget_used : 0,
        totalMoves: roster.settings ? roster.settings.total_moves || 0 : 0,
        starters: roster.starters || [],
        players: roster.players || [],
      };
    });

    return rosterMap;
  }

  function sortStandings(rosterMap) {
    return Object.keys(rosterMap)
      .map(function (key) {
        return rosterMap[key];
      })
      .sort(function (a, b) {
        if (b.wins !== a.wins) return b.wins - a.wins;
        return b.fpts - a.fpts;
      });
  }

  function buildSeedMap(rosterMap) {
    var standings = sortStandings(rosterMap);
    var seedMap = {};

    standings.forEach(function (team, index) {
      seedMap[team.rosterId] = index + 1;
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

    var allTeams = Object.keys(rosterMap).map(function (key) {
      return rosterMap[key];
    });

    var hasDivisions = allTeams.some(function (team) {
      return team.division;
    });
    if (!hasDivisions) return null;

    var champion = finalStandingsInfo ? finalStandingsInfo.champion : null;
    var runnerUp = finalStandingsInfo ? finalStandingsInfo.runnerUp : null;
    var groups = {};

    allTeams.forEach(function (team) {
      var division = team.division || 0;
      if (!groups[division]) groups[division] = [];
      groups[division].push(team);
    });

    return Object.keys(groups)
      .sort(function (a, b) {
        return Number(a) - Number(b);
      })
      .map(function (divisionKey) {
        var teams = groups[divisionKey].sort(function (a, b) {
          if (b.wins !== a.wins) return b.wins - a.wins;
          return b.fpts - a.fpts;
        });

        return {
          divisionNum: Number(divisionKey),
          divisionName:
            divisionNames[divisionKey] || "Division " + divisionKey,
          standings: teams,
          champion: champion,
          runnerUp: runnerUp,
        };
      });
  }

  function pairMatchups(matchups, rosterMap) {
    var grouped = {};

    matchups.forEach(function (matchup) {
      if (!grouped[matchup.matchup_id]) grouped[matchup.matchup_id] = [];
      grouped[matchup.matchup_id].push(matchup);
    });

    return Object.keys(grouped).map(function (key) {
      var pair = grouped[key];
      var first = pair[0];
      var second = pair[1];
      var teamA = rosterMap[first.roster_id] || {};
      var result = {
        matchupId: first.matchup_id,
        teamA: Object.assign({}, teamA, {
          points: first.points || 0,
          starters: first.starters || [],
          players: first.players || [],
          players_points: first.players_points || {},
        }),
        teamB: null,
      };

      if (second) {
        var teamB = rosterMap[second.roster_id] || {};
        result.teamB = Object.assign({}, teamB, {
          points: second.points || 0,
          starters: second.starters || [],
          players: second.players || [],
          players_points: second.players_points || {},
        });
      }

      return result;
    });
  }

  function resolveMatchupRoster(teamSide, playersMap) {
    if (!teamSide) return [];

    var starterSet = {};
    (teamSide.starters || []).forEach(function (playerId) {
      starterSet[playerId] = true;
    });

    var playerPoints = teamSide.players_points || {};
    var roster = (teamSide.players || []).map(function (playerId) {
      var meta = (playersMap && playersMap[playerId]) || {};

      return {
        playerId: playerId,
        name:
          meta.full_name ||
          (meta.first_name ? meta.first_name + " " + meta.last_name : playerId),
        position: meta.position || "",
        team: meta.team || "FA",
        isStarter: !!starterSet[playerId],
        points:
          playerPoints[playerId] !== undefined
            ? playerPoints[playerId]
            : null,
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

  function isWeekPlayed(weekMatchups) {
    if (!weekMatchups || weekMatchups.length === 0) return false;

    return weekMatchups.some(function (matchup) {
      return (matchup.points || 0) > 0;
    });
  }

  function getAllWeeksMatchups(leagueId, maxWeek) {
    var cappedMaxWeek = Math.min(
      maxWeek || MAX_SLEEPER_WEEK,
      MAX_SLEEPER_WEEK
    );
    var weeks = [];

    for (var i = 1; i <= cappedMaxWeek; i++) {
      weeks.push(i);
    }

    var results = {};
    var chain = Promise.resolve();

    weeks.forEach(function (week) {
      chain = chain
        .then(function () {
          return getMatchups(leagueId, week).catch(function () {
            return [];
          });
        })
        .then(function (matchups) {
          results[week] = matchups;
        });
    });

    return chain.then(function () {
      return results;
    });
  }

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

  function buildTeamSchedule(
    allWeeksMatchups,
    rosterId,
    rosterMap,
    runningRecordsByWeek,
    playoffStartWeek
  ) {
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
        var mine = weekMatchups.find(function (matchup) {
          return matchup.roster_id === rosterId;
        });

        if (!mine) return;

        var opponent = weekMatchups.find(function (matchup) {
          return (
            matchup.matchup_id === mine.matchup_id &&
            matchup.roster_id !== rosterId
          );
        });

        var myPoints = mine.points || 0;
        var opponentPoints = opponent ? opponent.points || 0 : 0;
        var result = !opponent
          ? "BYE"
          : myPoints > opponentPoints
          ? "W"
          : myPoints < opponentPoints
          ? "L"
          : "T";

        var isPlayoffWeek = !!playoffStartWeek && week >= playoffStartWeek;
        var recordAfter = "-";

        if (
          !isPlayoffWeek &&
          runningRecordsByWeek &&
          runningRecordsByWeek[week]
        ) {
          recordAfter = runningRecordsByWeek[week][rosterId] || "-";
        }

        schedule.push({
          week: week,
          opponentRosterId: opponent ? opponent.roster_id : null,
          opponentName: opponent
            ? rosterMap[opponent.roster_id]
              ? rosterMap[opponent.roster_id].teamName
              : "Roster " + opponent.roster_id
            : "BYE",
          myPoints: myPoints,
          opponentPoints: opponent ? opponentPoints : null,
          result: result,
          isPlayoff: isPlayoffWeek,
          recordAfter: recordAfter,
        });
      });

    return schedule;
  }

  function buildRunningRecordsThroughWeek(
    allWeeksMatchups,
    week,
    playoffStartWeek
  ) {
    var tally = {};

    function ensure(rosterId) {
      if (!tally[rosterId]) {
        tally[rosterId] = { wins: 0, losses: 0, ties: 0 };
      }
    }

    Object.keys(allWeeksMatchups)
      .map(Number)
      .filter(function (weekNumber) {
        var withinRange = weekNumber <= week && weekNumber <= MAX_SLEEPER_WEEK;
        var isRegularSeason = !playoffStartWeek || weekNumber < playoffStartWeek;
        var played = isWeekPlayed(allWeeksMatchups[weekNumber]);
        return withinRange && isRegularSeason && played;
      })
      .sort(function (a, b) {
        return a - b;
      })
      .forEach(function (weekNumber) {
        var grouped = {};

        (allWeeksMatchups[weekNumber] || []).forEach(function (matchup) {
          if (!grouped[matchup.matchup_id]) {
            grouped[matchup.matchup_id] = [];
          }
          grouped[matchup.matchup_id].push(matchup);
        });

        Object.keys(grouped).forEach(function (matchupId) {
          var pair = grouped[matchupId];
          var first = pair[0];
          var second = pair[1];

          if (!first) return;

          ensure(first.roster_id);
          if (!second) return;

          ensure(second.roster_id);

          var firstPoints = first.points || 0;
          var secondPoints = second.points || 0;

          if (firstPoints > secondPoints) {
            tally[first.roster_id].wins += 1;
            tally[second.roster_id].losses += 1;
          } else if (firstPoints < secondPoints) {
            tally[first.roster_id].losses += 1;
            tally[second.roster_id].wins += 1;
          } else {
            tally[first.roster_id].ties += 1;
            tally[second.roster_id].ties += 1;
          }
        });
      });

    var recordStrings = {};
    Object.keys(tally).forEach(function (rosterId) {
      var record = tally[rosterId];
      recordStrings[rosterId] =
        record.ties > 0
          ? record.wins + "-" + record.losses + "-" + record.ties
          : record.wins + "-" + record.losses;
    });

    return recordStrings;
  }

  function buildAllRunningRecords(allWeeksMatchups, playoffStartWeek) {
    var result = {};

    getPlayedWeeks(allWeeksMatchups).forEach(function (week) {
      result[week] = buildRunningRecordsThroughWeek(
        allWeeksMatchups,
        week,
        playoffStartWeek
      );
    });

    return result;
  }

  function resolvePlayoffResults(bracket) {
    if (!bracket || bracket.length === 0) {
      return { rounds: [], championRosterId: null, runnerUpRosterId: null };
    }

    var maxRound = Math.max.apply(
      null,
      bracket.map(function (match) {
        return match.r;
      })
    );

    var finalMatch = bracket.find(function (match) {
      return match.r === maxRound && match.p === 1;
    });

    if (!finalMatch) {
      finalMatch = bracket.find(function (match) {
        return match.r === maxRound;
      });
    }

    var championRosterId =
      finalMatch && finalMatch.w !== undefined ? finalMatch.w : null;
    var runnerUpRosterId =
      finalMatch && finalMatch.l !== undefined ? finalMatch.l : null;
    var roundsMap = {};

    bracket.forEach(function (match) {
      if (!roundsMap[match.r]) roundsMap[match.r] = [];
      roundsMap[match.r].push(match);
    });

    var rounds = Object.keys(roundsMap)
      .sort(function (a, b) {
        return Number(a) - Number(b);
      })
      .map(function (round) {
        return { round: Number(round), matches: roundsMap[round] };
      });

    return {
      rounds: rounds,
      championRosterId: championRosterId,
      runnerUpRosterId: runnerUpRosterId,
    };
  }

  function buildBracketView(
    bracket,
    rosterMap,
    seedMap,
    weeksMatchupsByWeek,
    playoffStartWeek
  ) {
    if (!bracket || bracket.length === 0) return [];

    function resolveSlot(rosterId, fromReference) {
      if (typeof rosterId === "number") {
        var team = rosterMap[rosterId];
        return {
          rosterId: rosterId,
          teamName: team ? team.teamName : "Roster " + rosterId,
          seed: seedMap[rosterId] || null,
          resolved: true,
        };
      }

      if (fromReference) {
        var label = fromReference.w !== undefined ? "Winner" : "Loser";
        var referenceId =
          fromReference.w !== undefined ? fromReference.w : fromReference.l;

        return {
          rosterId: null,
          teamName: label + " of Match " + referenceId,
          seed: null,
          resolved: false,
        };
      }

      return {
        rosterId: null,
        teamName: "BYE",
        seed: null,
        resolved: false,
      };
    }

    function findScore(weekNumber, rosterId) {
      if (!weeksMatchupsByWeek || !rosterId) return null;

      var weekData = weeksMatchupsByWeek[weekNumber];
      if (!weekData) return null;

      var entry = weekData.find(function (matchup) {
        return matchup.roster_id === rosterId;
      });

      return entry ? entry.points || 0 : null;
    }

    var minRound = Math.min.apply(
      null,
      bracket.map(function (match) {
        return match.r;
      })
    );

    var roundsMap = {};

    bracket.forEach(function (match) {
      if (!roundsMap[match.r]) roundsMap[match.r] = [];

      var slot1 = resolveSlot(match.t1, match.t1_from);
      var slot2 = resolveSlot(match.t2, match.t2_from);
      var weekNumber = playoffStartWeek
        ? playoffStartWeek + (match.r - 1)
        : null;

      roundsMap[match.r].push({
        matchId: match.m,
        position: match.p || null,
        week: weekNumber,
        slot1: slot1,
        slot1Score: weekNumber ? findScore(weekNumber, slot1.rosterId) : null,
        slot2: slot2,
        slot2Score: weekNumber ? findScore(weekNumber, slot2.rosterId) : null,
        winnerRosterId: match.w !== undefined ? match.w : null,
        loserRosterId: match.l !== undefined ? match.l : null,
        isBye: false,
      });
    });

    var allRosterIdsInBracket = {};
    bracket.forEach(function (match) {
      if (typeof match.t1 === "number") {
        allRosterIdsInBracket[match.t1] = true;
      }
      if (typeof match.t2 === "number") {
        allRosterIdsInBracket[match.t2] = true;
      }
    });

    var rosterIdsInFirstRound = {};
    (roundsMap[minRound] || []).forEach(function (match) {
      if (match.slot1.rosterId) {
        rosterIdsInFirstRound[match.slot1.rosterId] = true;
      }
      if (match.slot2.rosterId) {
        rosterIdsInFirstRound[match.slot2.rosterId] = true;
      }
    });

    var byeRosterIds = Object.keys(allRosterIdsInBracket)
      .map(Number)
      .filter(function (rosterId) {
        return !rosterIdsInFirstRound[rosterId];
      });

    if (byeRosterIds.length > 0) {
      if (!roundsMap[minRound]) roundsMap[minRound] = [];

      var byeWeekNumber = playoffStartWeek
        ? playoffStartWeek + (minRound - 1)
        : null;

      byeRosterIds
        .sort(function (a, b) {
          return (seedMap[a] || 999) - (seedMap[b] || 999);
        })
        .forEach(function (rosterId) {
          var byeSlot = resolveSlot(rosterId, null);

          roundsMap[minRound].push({
            matchId: "bye-" + rosterId,
            position: null,
            week: byeWeekNumber,
            slot1: byeSlot,
            slot1Score: byeWeekNumber
              ? findScore(byeWeekNumber, rosterId)
              : null,
            slot2: {
              rosterId: null,
              teamName: "BYE",
              seed: null,
              resolved: false,
            },
            slot2Score: null,
            winnerRosterId: rosterId,
            loserRosterId: null,
            isBye: true,
          });
        });
    }

    return Object.keys(roundsMap)
      .sort(function (a, b) {
        return Number(a) - Number(b);
      })
      .map(function (round) {
        return {
          round: Number(round),
          matches: roundsMap[round],
        };
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
      standings = standings.filter(function (team) {
        return team.rosterId !== champion.rosterId;
      });
      standings.unshift(champion);
    }

    if (runnerUp) {
      standings = standings.filter(function (team) {
        return team.rosterId !== runnerUp.rosterId;
      });
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
    var entry = matchupsForWeek.find(function (matchup) {
      return matchup.roster_id === rosterId;
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

    Object.keys(rosterMap).forEach(function (rosterId) {
      byRosterId[rosterId] = rosterMap[rosterId];
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
              (meta.last_name || "") ||
            "Unknown Player",
          position: meta.position || "",
          nflTeam: meta.team || "",
          isKeeper: !!pick.is_keeper,
        };
      });
  }

  function resolveTransactionDetail(txn, rosterMap, playersMap) {
    function playerLabel(playerId) {
      var meta = (playersMap && playersMap[playerId]) || {};
      var name =
        meta.full_name ||
        (meta.first_name ? meta.first_name + " " + meta.last_name : playerId);
      var position = meta.position
        ? " (" + meta.position + (meta.team ? " " + meta.team : "") + ")"
        : "";

      return name + position;
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
      Object.keys(txn.adds).forEach(function (playerId) {
        adds.push({
          player: playerLabel(playerId),
          team: teamLabel(txn.adds[playerId]),
          owner: ownerLabel(txn.adds[playerId]),
          teamWithOwner: teamWithOwnerLabel(txn.adds[playerId]),
          rosterId: txn.adds[playerId],
        });
      });
    }

    var drops = [];
    if (txn.drops) {
      Object.keys(txn.drops).forEach(function (playerId) {
        drops.push({
          player: playerLabel(playerId),
          team: teamLabel(txn.drops[playerId]),
          owner: ownerLabel(txn.drops[playerId]),
          teamWithOwner: teamWithOwnerLabel(txn.drops[playerId]),
          rosterId: txn.drops[playerId],
        });
      });
    }

    var draftPicks = (txn.draft_picks || []).map(function (draftPick) {
      return {
        season: draftPick.season,
        round: draftPick.round,
        from: teamLabel(draftPick.previous_owner_id),
        to: teamLabel(draftPick.owner_id),
      };
    });

    var faab = null;
    if (txn.waiver_budget && txn.waiver_budget.length) {
      faab = txn.waiver_budget.map(function (waiver) {
        return {
          amount: waiver.amount,
          from: teamLabel(waiver.sender),
          to: teamLabel(waiver.receiver),
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
    var isCompleted = txn.status === "complete";

    var isPlayerMove =
      txn.type === "waiver" ||
      txn.type === "free_agent" ||
      txn.type === "trade";

    var isCommissionerMove =
      txn.type === "commissioner" ||
      txn.type === "commissioner_update" ||
      txn.creator === null;

    if (!isCompleted || !isPlayerMove || isCommissionerMove || !txn.roster_ids) {
      return;
    }

    txn.roster_ids.forEach(function (rid) {
      counts[rid] = (counts[rid] || 0) + 1;
    });
  });

  return counts;
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
        for (var i = 1; i <= MAX_SLEEPER_WEEK; i++) {
          weeks.push(i);
        }

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
            .then(function (matchups) {
              allMatchups[week] = matchups;
              return getTransactions(leagueId, week).catch(function () {
                return [];
              });
            })
            .then(function (transactions) {
              allTransactions[week] = transactions;
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
    var anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
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
