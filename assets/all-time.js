(function () {
  "use strict";

  var allSeasonsCache = null;

  function normalizeOwnerKey(name) {
    return String(name || "").trim().toLowerCase();
  }

  function pairKey(a, b) {
    var x = String(a);
    var y = String(b);
    return x < y ? x + "|" + y : y + "|" + x;
  }

  function newSplitRecord() {
    return { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 };
  }

  function isNonChampionshipPlacementGame(match) {
    return !!(match.p && match.p !== 1);
  }

  function resolveBracketSlot(match, side, byMatchId) {
    var direct = match[side];
    if (direct) return direct;
    var fromRef = match[side + "_from"];
    if (!fromRef) return null;
    var refMatchId = fromRef.w !== undefined ? fromRef.w : fromRef.l;
    var refMatch = byMatchId[refMatchId];
    if (!refMatch) return null;
    return fromRef.w !== undefined ? refMatch.w || null : refMatch.l || null;
  }

  function buildActivePlayoffPairs(winnersBracket) {
    var activePairs = {};
    if (!winnersBracket || winnersBracket.length === 0) return activePairs;

    var byMatchId = {};
    var byRound = {};
    winnersBracket.forEach(function (match) {
      byMatchId[match.m] = match;
      var round = match.r || 1;
      if (!byRound[round]) byRound[round] = [];
      byRound[round].push(match);
    });

    var eliminatedRosterIds = {};
    Object.keys(byRound)
      .map(Number)
      .sort(function (a, b) { return a - b; })
      .forEach(function (round) {
        byRound[round].forEach(function (match) {
          if (isNonChampionshipPlacementGame(match)) return;
          var team1 = resolveBracketSlot(match, "t1", byMatchId);
          var team2 = resolveBracketSlot(match, "t2", byMatchId);
          if (!team1 || !team2) return;
          if (eliminatedRosterIds[team1] || eliminatedRosterIds[team2]) return;
          activePairs[pairKey(team1, team2)] = true;
          if (match.w) {
            eliminatedRosterIds[match.w === team1 ? team2 : team1] = true;
          }
        });
      });

    return activePairs;
  }

  function buildActivePlayoffPairsEspn(winnersBracket) {
    var activePairs = {};
    if (!winnersBracket) return activePairs;
    var eliminatedNames = {};

    winnersBracket.forEach(function (roundData) {
      (roundData.matches || []).forEach(function (match) {
        var placement = match.placement || match.p;
        if (placement && placement !== 1) return;
        var nameA = match.slot1 && (match.slot1.teamName || match.slot1.ownerName);
        var nameB = match.slot2 && (match.slot2.teamName || match.slot2.ownerName);
        if (!nameA || !nameB || eliminatedNames[nameA] || eliminatedNames[nameB]) return;

        activePairs[pairKey(nameA, nameB)] = true;
        var winnerName = match.winnerName;
        if (!winnerName && match.winnerRosterId && match.slot1 && match.slot2) {
          winnerName = match.slot1.rosterId === match.winnerRosterId ? nameA : nameB;
        }
        if (winnerName) eliminatedNames[winnerName === nameA ? nameB : nameA] = true;
      });
    });

    return activePairs;
  }

  function normalizeEspnPick(pick, year) {
    var ownerName = pick.owner || pick.ownerName || pick.team || "Unknown";
    return {
      year: year,
      source: "espn",
      ownerKey: normalizeOwnerKey(ownerName),
      ownerName: ownerName,
      teamName: pick.team || "",
      playerName: pick.playerName || "Unknown Player",
      position: pick.position || pick.pos || "",
      nflTeam: pick.nflTeam || pick.proTeam || "",
      round: pick.round || null,
      roundPick: pick.roundPick || null,
      pickNo: pick.overallPick || pick.pickNo || null,
      isKeeper: !!pick.isKeeper
    };
  }

  function normalizeSleeperPick(pick, year) {
    var ownerName = pick.ownerName || pick.teamName || "Unknown";
    return {
      year: year,
      source: "sleeper",
      ownerKey: normalizeOwnerKey(ownerName),
      ownerName: ownerName,
      teamName: pick.teamName || "",
      playerName: pick.playerName || "Unknown Player",
      position: pick.position || "",
      nflTeam: pick.nflTeam || "",
      round: pick.round || null,
      roundPick: null,
      pickNo: pick.pickNo || null,
      isKeeper: !!pick.isKeeper
    };
  }

  function loadEspnSeasonForAllTime(year) {
    return window.EspnLoader.loadSeason(year).then(function (data) {
      var teamSummaries = Object.keys(data.rosterMap).map(function (teamKey) {
        var team = data.rosterMap[teamKey];
        var hasMoveData = team.totalMoves !== undefined && team.totalMoves !== null;
        return {
          year: year,
          source: "espn",
          ownerKey: normalizeOwnerKey(team.displayName || team.ownerId),
          ownerName: team.displayName || team.ownerId,
          teamName: team.teamName,
          madePlayoffs: !!team.madePlayoffs,
          isChampion: !!team.isChampionFlag,
          isRunnerUp: !!team.isRunnerUpFlag,
          transactions: hasMoveData ? team.totalMoves : 0,
          hasIncompleteTransactionData: !hasMoveData
        };
      });

      var hasExplicitEliminationField = (data.rows || []).some(function (row) {
        return row.isEliminatedBeforeThisGame !== undefined || row.bracketRoundStatus !== undefined;
      });
      var activePairs = !hasExplicitEliminationField && data.winnersBracket
        ? buildActivePlayoffPairsEspn(data.winnersBracket)
        : null;
      var games = [];

      (data.rows || []).forEach(function (row) {
        if (row.opponent === "BYE" || !row.opponent) return;
        var ownerAKey = normalizeOwnerKey(row.teamOwner);
        var ownerBKey = normalizeOwnerKey(row.opponentOwner);
        if (!ownerAKey || !ownerBKey) return;

        var gameType = "regular";
        if (row.isPlayoff) {
          if (hasExplicitEliminationField) {
            gameType = row.isEliminatedBeforeThisGame ? "consolation" : "playoff";
          } else if (activePairs) {
            gameType = activePairs[pairKey(row.team, row.opponent)] ? "playoff" : "consolation";
          } else {
            gameType = "playoff";
          }
        }

        games.push({
          year: year,
          source: "espn",
          week: row.week,
          gameType: gameType,
          isPlayoff: gameType === "playoff",
          ownerAKey: ownerAKey,
          ownerAName: row.teamOwner,
          ownerATeamName: row.team,
          ownerAScore: Number(row.teamScore) || 0,
          ownerBKey: ownerBKey,
          ownerBName: row.opponentOwner,
          ownerBTeamName: row.opponent,
          ownerBScore: Number(row.opponentScore) || 0
        });
      });

      var draftPromise = window.EspnDraftLoader
        ? window.EspnDraftLoader.loadDraft(year).then(function (draftData) {
            return (draftData.picks || []).map(function (pick) {
              return normalizeEspnPick(pick, year);
            });
          }).catch(function () { return []; })
        : Promise.resolve([]);

      return draftPromise.then(function (draftPicks) {
        return {
          year: year,
          source: "espn",
          teamSummaries: teamSummaries,
          games: games,
          draftPicks: draftPicks
        };
      });
    });
  }

  function loadSleeperSeasonForAllTime(year) {
    var leagueId = SleeperAPI.SLEEPERSEASONS[year];
    if (!leagueId) return Promise.resolve(null);

    return Promise.all([
      SleeperAPI.getLeague(leagueId),
      SleeperAPI.getUsers(leagueId),
      SleeperAPI.getRosters(leagueId),
      SleeperAPI.getWinnersBracket(leagueId).catch(function () { return []; })
    ]).then(function (results) {
      var league = results[0];
      var users = results[1];
      var rosters = results[2];
      var winnersBracket = results[3];
      var rosterMap = SleeperAPI.buildRosterMap(users, rosters);
      var finalStandings = SleeperAPI.buildFinalStandings(rosterMap, winnersBracket);
      var playoffStartWeek = league.settings && league.settings.playoffweekstart;
      var playoffRosterIds = {};
      (winnersBracket || []).forEach(function (match) {
        if (match.t1) playoffRosterIds[match.t1] = true;
        if (match.t2) playoffRosterIds[match.t2] = true;
      });

      var txnCountsByRoster = {};
      var txnChain = Promise.resolve();
      for (var week = 1; week <= SleeperAPI.MAXSLEEPERWEEK; week++) {
        (function (weekNumber) {
          txnChain = txnChain.then(function () {
            return SleeperAPI.getTransactions(leagueId, weekNumber).catch(function () { return []; });
          }).then(function (transactions) {
            var counts = SleeperAPI.countTransactionsByRoster(transactions || []);
            Object.keys(counts).forEach(function (rosterId) {
              txnCountsByRoster[rosterId] = (txnCountsByRoster[rosterId] || 0) + counts[rosterId];
            });
          });
        })(week);
      }

      var draftPromise = SleeperAPI.getDraft(leagueId).then(function (draft) {
        if (!draft) return [];
        return SleeperAPI.getDraftPicks(draft.draftid).then(function (picks) {
          return SleeperAPI.buildDraftBoard(picks, rosterMap).map(function (pick) {
            return normalizeSleeperPick(pick, year);
          });
        });
      }).catch(function () { return []; });

      return Promise.all([txnChain, draftPromise]).then(function (loaded) {
        var teamSummaries = Object.keys(rosterMap).map(function (rosterId) {
          var team = rosterMap[rosterId];
          return {
            year: year,
            source: "sleeper",
            ownerKey: normalizeOwnerKey(team.displayName),
            ownerName: team.displayName,
            teamName: team.teamName,
            madePlayoffs: !!playoffRosterIds[team.rosterId],
            isChampion: !!(finalStandings.champion && finalStandings.champion.rosterId === team.rosterId),
            isRunnerUp: !!(finalStandings.runnerUp && finalStandings.runnerUp.rosterId === team.rosterId),
            transactions: txnCountsByRoster[rosterId] || 0,
            hasIncompleteTransactionData: false
          };
        });

        return SleeperAPI.getAllWeeksMatchups(leagueId, SleeperAPI.MAXSLEEPERWEEK).then(function (allWeeksMatchups) {
          var activePairs = buildActivePlayoffPairs(winnersBracket);
          var games = [];
          SleeperAPI.getPlayedWeeks(allWeeksMatchups).forEach(function (weekNumber) {
            var grouped = {};
            (allWeeksMatchups[weekNumber] || []).forEach(function (matchup) {
              if (matchup.matchupid === null || matchup.matchupid === undefined) return;
              if (!grouped[matchup.matchupid]) grouped[matchup.matchupid] = [];
              grouped[matchup.matchupid].push(matchup);
            });

            Object.keys(grouped).forEach(function (matchupId) {
              var pair = grouped[matchupId];
              if (pair.length !== 2) return;
              var sideA = pair[0];
              var sideB = pair[1];
              var teamA = rosterMap[sideA.rosterid];
              var teamB = rosterMap[sideB.rosterid];
              if (!teamA || !teamB) return;

              var gameType = "regular";
              if (playoffStartWeek && weekNumber >= playoffStartWeek) {
                gameType = activePairs[pairKey(sideA.rosterid, sideB.rosterid)] ? "playoff" : "consolation";
              }

              games.push({
                year: year,
                source: "sleeper",
                week: weekNumber,
                gameType: gameType,
                isPlayoff: gameType === "playoff",
                ownerAKey: normalizeOwnerKey(teamA.displayName),
                ownerAName: teamA.displayName,
                ownerATeamName: teamA.teamName,
                ownerAScore: Number(sideA.points) || 0,
                ownerBKey: normalizeOwnerKey(teamB.displayName),
                ownerBName: teamB.displayName,
                ownerBTeamName: teamB.teamName,
                ownerBScore: Number(sideB.points) || 0
              });
            });
          });

          return {
            year: year,
            source: "sleeper",
            teamSummaries: teamSummaries,
            games: games,
            draftPicks: loaded[1]
          };
        });
      });
    });
  }

  function loadAllSeasons() {
    if (allSeasonsCache) return allSeasonsCache;

    var espnYears = window.EspnLoader ? window.EspnLoader.ESPNSEASONS : [];
    var sleeperYears = Object.keys(SleeperAPI.SLEEPERSEASONS).map(Number);
    var jobs = espnYears.map(function (year) {
      return loadEspnSeasonForAllTime(year).catch(function (error) {
        console.error("All-time ESPN load failed for " + year, error);
        return null;
      });
    }).concat(sleeperYears.map(function (year) {
      return loadSleeperSeasonForAllTime(year).catch(function (error) {
        console.error("All-time Sleeper load failed for " + year, error);
        return null;
      });
    }));

    allSeasonsCache = Promise.all(jobs).then(function (results) {
      return results.filter(function (item) { return item !== null; });
    });
    return allSeasonsCache;
  }

  function winPct(record) {
    var games = record.wins + record.losses + record.ties;
    return games ? record.wins / games : 0;
  }

  function roundSplit(record) {
    return {
      wins: record.wins,
      losses: record.losses,
      ties: record.ties,
      pointsFor: Math.round(record.pointsFor * 100) / 100,
      pointsAgainst: Math.round(record.pointsAgainst * 100) / 100
    };
  }

  function accumulateGameRecords(allSeasonsData) {
    var byOwner = {};
    function ensure(ownerKey) {
      if (!byOwner[ownerKey]) byOwner[ownerKey] = { regular: newSplitRecord(), playoff: newSplitRecord() };
      return byOwner[ownerKey];
    }
    function apply(record, scoreFor, scoreAgainst) {
      record.pointsFor += scoreFor;
      record.pointsAgainst += scoreAgainst;
      if (scoreFor > scoreAgainst) record.wins += 1;
      else if (scoreFor < scoreAgainst) record.losses += 1;
      else record.ties += 1;
    }

    allSeasonsData.forEach(function (season) {
      season.games.forEach(function (game) {
        if (game.gameType === "consolation") return;
        var split = game.gameType === "playoff" ? "playoff" : "regular";
        apply(ensure(game.ownerAKey)[split], game.ownerAScore, game.ownerBScore);
        apply(ensure(game.ownerBKey)[split], game.ownerBScore, game.ownerAScore);
      });
    });
    return byOwner;
  }

  function buildCareerTotals(allSeasonsData) {
    var byOwner = {};
    var gameRecords = accumulateGameRecords(allSeasonsData);

    allSeasonsData.forEach(function (season) {
      season.teamSummaries.forEach(function (team) {
        if (!byOwner[team.ownerKey]) {
          byOwner[team.ownerKey] = {
            ownerKey: team.ownerKey,
            ownerName: team.ownerName,
            seasons: 0,
            championships: 0,
            runnerUps: 0,
            playoffAppearances: 0,
            totalTransactions: 0,
            hasIncompleteTransactionData: false,
            yearsList: []
          };
        }
        var entry = byOwner[team.ownerKey];
        entry.seasons += 1;
        if (team.isChampion) entry.championships += 1;
        if (team.isRunnerUp) entry.runnerUps += 1;
        if (team.madePlayoffs) entry.playoffAppearances += 1;
        entry.totalTransactions += team.transactions || 0;
        if (team.hasIncompleteTransactionData) entry.hasIncompleteTransactionData = true;
        entry.yearsList.push(team.year);
      });
    });

    return Object.keys(byOwner).map(function (ownerKey) {
      var entry = byOwner[ownerKey];
      var records = gameRecords[ownerKey] || { regular: newSplitRecord(), playoff: newSplitRecord() };
      entry.regular = roundSplit(records.regular);
      entry.playoff = roundSplit(records.playoff);
      entry.combined = {
        wins: entry.regular.wins + entry.playoff.wins,
        losses: entry.regular.losses + entry.playoff.losses,
        ties: entry.regular.ties + entry.playoff.ties,
        pointsFor: Math.round((entry.regular.pointsFor + entry.playoff.pointsFor) * 100) / 100,
        pointsAgainst: Math.round((entry.regular.pointsAgainst + entry.playoff.pointsAgainst) * 100) / 100
      };
      entry.regular.winPct = winPct(entry.regular);
      entry.playoff.winPct = winPct(entry.playoff);
      entry.combined.winPct = winPct(entry.combined);
      entry.yearsList.sort(function (a, b) { return a - b; });
      return entry;
    }).sort(function (a, b) {
      if (b.championships !== a.championships) return b.championships - a.championships;
      if (b.combined.winPct !== a.combined.winPct) return b.combined.winPct - a.combined.winPct;
      return b.combined.wins - a.combined.wins;
    });
  }

  function summarizeGames(list) {
    var summary = { totalGames: list.length, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 };
    list.forEach(function (game) {
      summary.pointsFor += game.myScore;
      summary.pointsAgainst += game.oppScore;
      if (game.myScore > game.oppScore) summary.wins += 1;
      else if (game.myScore < game.oppScore) summary.losses += 1;
      else summary.ties += 1;
    });
    summary.pointsFor = Math.round(summary.pointsFor * 100) / 100;
    summary.pointsAgainst = Math.round(summary.pointsAgainst * 100) / 100;
    summary.avgFor = summary.totalGames ? summary.pointsFor / summary.totalGames : 0;
    summary.avgAgainst = summary.totalGames ? summary.pointsAgainst / summary.totalGames : 0;
    summary.winPct = winPct(summary);
    return summary;
  }

  function buildHeadToHead(allSeasonsData, ownerAQuery, ownerBQuery) {
    var keyA = normalizeOwnerKey(ownerAQuery);
    var keyB = normalizeOwnerKey(ownerBQuery);
    var matchups = [];

    allSeasonsData.forEach(function (season) {
      season.games.forEach(function (game) {
        var matches = (game.ownerAKey === keyA && game.ownerBKey === keyB) ||
          (game.ownerAKey === keyB && game.ownerBKey === keyA);
        if (!matches) return;
        var aIsLeft = game.ownerAKey === keyA;
        matchups.push({
          year: game.year,
          week: game.week,
          gameType: game.gameType,
          isPlayoff: game.isPlayoff,
          source: game.source,
          ownerAName: aIsLeft ? game.ownerAName : game.ownerBName,
          ownerATeamName: aIsLeft ? game.ownerATeamName : game.ownerBTeamName,
          ownerAScore: aIsLeft ? game.ownerAScore : game.ownerBScore,
          ownerBName: aIsLeft ? game.ownerBName : game.ownerAName,
          ownerBTeamName: aIsLeft ? game.ownerBTeamName : game.ownerATeamName,
          ownerBScore: aIsLeft ? game.ownerBScore : game.ownerAScore
        });
      });
    });

    matchups.sort(function (a, b) {
      return a.year !== b.year ? a.year - b.year : (a.week || 0) - (b.week || 0);
    });

    function summarize(list) {
      var result = { totalGames: list.length, ownerAWins: 0, ownerBWins: 0, ties: 0, ownerATotalPoints: 0, ownerBTotalPoints: 0 };
      list.forEach(function (game) {
        result.ownerATotalPoints += game.ownerAScore;
        result.ownerBTotalPoints += game.ownerBScore;
        if (game.ownerAScore > game.ownerBScore) result.ownerAWins += 1;
        else if (game.ownerBScore > game.ownerAScore) result.ownerBWins += 1;
        else result.ties += 1;
      });
      result.ownerAvgA = result.totalGames ? result.ownerATotalPoints / result.totalGames : 0;
      result.ownerAvgB = result.totalGames ? result.ownerBTotalPoints / result.totalGames : 0;
      return result;
    }

    var regular = matchups.filter(function (game) { return game.gameType === "regular"; });
    var playoff = matchups.filter(function (game) { return game.gameType === "playoff"; });
    return {
      matchups: matchups,
      regularMatchups: regular,
      playoffMatchups: playoff,
      consolationMatchups: matchups.filter(function (game) { return game.gameType === "consolation"; }),
      summary: summarize(regular.concat(playoff)),
      regularSummary: summarize(regular),
      playoffSummary: summarize(playoff)
    };
  }

  function buildOwnerVsAll(allSeasonsData, ownerQuery) {
    var ownerKey = normalizeOwnerKey(ownerQuery);
    var byOpponent = {};
    var regularGames = [];
    var playoffGames = [];

    allSeasonsData.forEach(function (season) {
      season.games.forEach(function (game) {
        if (game.gameType === "consolation") return;
        if (game.ownerAKey !== ownerKey && game.ownerBKey !== ownerKey) return;
        var iAmA = game.ownerAKey === ownerKey;
        var opponentKey = iAmA ? game.ownerBKey : game.ownerAKey;
        var opponentName = iAmA ? game.ownerBName : game.ownerAName;
        var record = {
          year: game.year,
          week: game.week,
          myScore: iAmA ? game.ownerAScore : game.ownerBScore,
          oppScore: iAmA ? game.ownerBScore : game.ownerAScore
        };
        if (!byOpponent[opponentKey]) {
          byOpponent[opponentKey] = { opponentKey: opponentKey, opponentName: opponentName, regularGames: [], playoffGames: [] };
        }
        if (game.gameType === "playoff") {
          byOpponent[opponentKey].playoffGames.push(record);
          playoffGames.push(record);
        } else {
          byOpponent[opponentKey].regularGames.push(record);
          regularGames.push(record);
        }
      });
    });

    return {
      overallRegular: summarizeGames(regularGames),
      overallPlayoff: summarizeGames(playoffGames),
      byOpponent: Object.keys(byOpponent).map(function (key) {
        var entry = byOpponent[key];
        return {
          opponentKey: entry.opponentKey,
          opponentName: entry.opponentName,
          regularSummary: summarizeGames(entry.regularGames),
          playoffSummary: summarizeGames(entry.playoffGames)
        };
      }).sort(function (a, b) {
        return a.opponentName.localeCompare(b.opponentName);
      })
    };
  }

  function getAllOwnerNames(allSeasonsData) {
    var seen = {};
    allSeasonsData.forEach(function (season) {
      season.teamSummaries.forEach(function (team) {
        if (team.ownerKey && !seen[team.ownerKey]) seen[team.ownerKey] = team.ownerName;
      });
    });
    return Object.keys(seen).map(function (key) {
      return { key: key, name: seen[key] };
    }).sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
  }

  function buildGameSidesFromGames(games, split, ownerKeyFilter) {
    var sides = [];
    games.forEach(function (game) {
      if (game.gameType !== split) return;
      if (!ownerKeyFilter || game.ownerAKey === ownerKeyFilter) {
        sides.push({ ownerKey: game.ownerAKey, ownerName: game.ownerAName, teamName: game.ownerATeamName, myScore: game.ownerAScore, opponentName: game.ownerBName, opponentTeamName: game.ownerBTeamName, oppScore: game.ownerBScore, year: game.year, week: game.week, source: game.source });
      }
      if (!ownerKeyFilter || game.ownerBKey === ownerKeyFilter) {
        sides.push({ ownerKey: game.ownerBKey, ownerName: game.ownerBName, teamName: game.ownerBTeamName, myScore: game.ownerBScore, opponentName: game.ownerAName, opponentTeamName: game.ownerATeamName, oppScore: game.ownerAScore, year: game.year, week: game.week, source: game.source });
      }
    });
    return sides;
  }

  function buildGameSides(allSeasonsData, split, ownerKeyFilter) {
    var games = [];
    allSeasonsData.forEach(function (season) { games = games.concat(season.games); });
    return buildGameSidesFromGames(games, split, ownerKeyFilter);
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
      source: side.source
    };
  }

  function computeRecordsFromSides(sides) {
    var empty = { mostPoints: null, leastPoints: null, largestMarginVictory: null, smallestMarginVictory: null, largestMarginDefeat: null, smallestMarginDefeat: null };
    if (!sides || !sides.length) return empty;

    var sorted = sides.slice().sort(function (a, b) {
      return a.year !== b.year ? a.year - b.year : (a.week || 0) - (b.week || 0);
    });
    var wins = sorted.filter(function (side) { return side.myScore > side.oppScore; });
    var losses = sorted.filter(function (side) { return side.myScore < side.oppScore; });

    function best(list, compare) {
      if (!list.length) return null;
      return list.reduce(function (current, candidate) {
        return compare(candidate, current) > 0 ? candidate : current;
      });
    }

    return {
      mostPoints: toRecordEntry(best(sorted, function (a, b) { return a.myScore - b.myScore; })),
      leastPoints: toRecordEntry(best(sorted, function (a, b) { return b.myScore - a.myScore; })),
      largestMarginVictory: toRecordEntry(best(wins, function (a, b) { return (a.myScore - a.oppScore) - (b.myScore - b.oppScore); })),
      smallestMarginVictory: toRecordEntry(best(wins, function (a, b) { return (b.myScore - b.oppScore) - (a.myScore - a.oppScore); })),
      largestMarginDefeat: toRecordEntry(best(losses, function (a, b) { return (a.oppScore - a.myScore) - (b.oppScore - b.myScore); })),
      smallestMarginDefeat: toRecordEntry(best(losses, function (a, b) { return (b.oppScore - b.myScore) - (a.oppScore - a.myScore); }))
    };
  }

  function getSeasonGames(allSeasonsData, year) {
    var result = [];
    allSeasonsData.forEach(function (season) {
      if (season.year === Number(year)) result = result.concat(season.games);
    });
    return result;
  }

  function buildMasterRecords(allSeasonsData, split) {
    return computeRecordsFromSides(buildGameSides(allSeasonsData, split, null));
  }

  function buildMemberRecords(allSeasonsData, split, ownerQuery) {
    return computeRecordsFromSides(buildGameSides(allSeasonsData, split, normalizeOwnerKey(ownerQuery)));
  }

  function buildSeasonMasterRecords(allSeasonsData, year, split) {
    return computeRecordsFromSides(buildGameSidesFromGames(getSeasonGames(allSeasonsData, year), split, null));
  }

  function buildSeasonMemberRecords(allSeasonsData, year, split, ownerQuery) {
    return computeRecordsFromSides(buildGameSidesFromGames(getSeasonGames(allSeasonsData, year), split, normalizeOwnerKey(ownerQuery)));
  }

  function buildAllTimeDraftPicks(allSeasonsData, ownerQuery) {
    var ownerKey = ownerQuery ? normalizeOwnerKey(ownerQuery) : null;
    var picks = [];
    allSeasonsData.forEach(function (season) {
      (season.draftPicks || []).forEach(function (pick) {
        if (!ownerKey || pick.ownerKey === ownerKey) picks.push(pick);
      });
    });
    return picks.sort(function (a, b) {
      return a.year !== b.year ? b.year - a.year : (a.pickNo || 0) - (b.pickNo || 0);
    });
  }

  function getSeasonDraftPicks(allSeasonsData, year, ownerQuery) {
    return buildAllTimeDraftPicks(allSeasonsData, ownerQuery).filter(function (pick) {
      return pick.year === Number(year);
    });
  }

  function buildDraftBreakdown(picks) {
    var byPosition = {};
    var byNflTeam = {};
    (picks || []).forEach(function (pick) {
      if (pick.position) byPosition[pick.position] = (byPosition[pick.position] || 0) + 1;
      if (pick.nflTeam) byNflTeam[pick.nflTeam] = (byNflTeam[pick.nflTeam] || 0) + 1;
    });

    function sortedItems(counts) {
      return Object.keys(counts).map(function (key) {
        return { key: key, count: counts[key] };
      }).sort(function (a, b) {
        return b.count !== a.count ? b.count - a.count : a.key.localeCompare(b.key);
      });
    }

    return {
      totalPicks: (picks || []).length,
      byPosition: sortedItems(byPosition),
      byNflTeam: sortedItems(byNflTeam)
    };
  }

  function buildKeeperDraftBreakdown(picks) {
    var keeperPicks = (picks || []).filter(function (pick) { return !!pick.isKeeper; });
    var breakdown = buildDraftBreakdown(keeperPicks);
    breakdown.keeperPicks = keeperPicks;
    return breakdown;
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
    buildAllTimeDraftPicks: buildAllTimeDraftPicks,
    getSeasonDraftPicks: getSeasonDraftPicks,
    buildDraftBreakdown: buildDraftBreakdown,
    buildKeeperDraftBreakdown: buildKeeperDraftBreakdown,
    getAllOwnerNames: getAllOwnerNames
  };
})();
