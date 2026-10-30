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
return { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 };
}
function isNonChampionshipPlacementGame(m) {
return !!(m.p && m.p !== 1);
}
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
function normalizeSleeperPick(pick, year, ownerKeyFn) {
return {
year: year,
source: "sleeper",
ownerKey: ownerKeyFn(pick.ownerName || pick.teamName),
ownerName: pick.ownerName || pick.teamName,
teamName: pick.teamName,
playerName: pick.playerName,
position: pick.position || pick.pos || pick.playerPosition || null,
nflTeam: pick.nflTeam || pick.playerTeam || pick.proTeam || pick.team || null,
round: pick.round,
pickNo: pick.pickNo,
isKeeper: !!pick.isKeeper
};
}
function normalizeEspnPick(pick, year, ownerKeyFn) {
return {
year: year,
source: "espn",
ownerKey: ownerKeyFn(pick.owner || pick.team),
ownerName: pick.owner || pick.team,
teamName: pick.team,
playerName: pick.playerName,
position: pick.position || pick.pos || pick.playerPosition || null,
nflTeam: pick.nflTeam || pick.playerTeam || pick.proTeam || null,
round: pick.round,
pickNo: pick.overallPick,
isKeeper: !!pick.isKeeper
};
}
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
hasIncompleteTransactionData: !hasMoveData
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
console.warn("All-time: ESPN season " + year + " has no bracket data to classify playoffs.");
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
ownerBScore: r.opponentScore
});
});
var draftPromise = window.EspnDraftLoader
? window.EspnDraftLoader.loadDraft(year)
.then(function (draftData) {
return (draftData.picks || []).map(function (p) {
return normalizeEspnPick(p, year, normalizeOwnerKey);
});
})
.catch(function () {
return [];
})
: Promise.resolve([]);
return draftPromise.then(function (draftPicks) {
return { year: year, source: "espn", teamSummaries: teamSummaries, games: games, draftPicks: draftPicks };
});
});
}
function loadSleeperSeasonForAllTime(year) {
var leagueId = SleeperAPI.SLEEPER_SEASONS[year];
if (!leagueId) return Promise.resolve(null);
return Promise.all([
SleeperAPI.getLeague(leagueId),
SleeperAPI.getUsers(leagueId),
SleeperAPI.getRosters(leagueId),
SleeperAPI.getWinnersBracket(leagueId).catch(function () {
return [];
})
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
var draftPromise = SleeperAPI.getDraft(leagueId)
.then(function (draft) {
if (!draft) return [];
return SleeperAPI.getDraftPicks(draft.draft_id).then(function (picks) {
var boardData = SleeperAPI.buildDraftBoard(picks, rosterMap);
return boardData.map(function (p) {
return normalizeSleeperPick(p, year, normalizeOwnerKey);
});
});
})
.catch(function () {
return [];
});
return Promise.all([txnChain, draftPromise]).then(function (results2) {
var draftPicks = results2[1];
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
hasIncompleteTransactionData: false
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
ownerBScore: b.points || 0
});
});
});
return { year: year, source: "sleeper", teamSummaries: teamSummaries, games: games, draftPicks: draftPicks };
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
function roundSplit(rec) {
return {
wins: rec.wins,
losses: rec.losses,
ties: rec.ties,
pointsFor: Math.round(rec.pointsFor * 100) / 100,
pointsAgainst: Math.round(rec.pointsAgainst * 100) / 100
};
}
function winPct(rec) {
var total = rec.wins + rec.losses + rec.ties;
return total > 0 ? rec.wins / total : 0;
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
yearsList: []
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
pointsAgainst: Math.round((e.regular.pointsAgainst + e.playoff.pointsAgainst) * 100) / 100
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
function summarizeGames(list) {
var summary = { totalGames: list.length, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 };
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
var isMatch = (g.ownerAKey === keyA && g.ownerBKey === keyB) || (g.ownerAKey === keyB && g.ownerBKey === keyA);
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
ownerBScore: aIsOwnerA ? g.ownerBScore : g.ownerAScore
});
});
});
matchups.sort(function (a, b) {
if (a.year !== b.year) return a.year - b.year;
return (a.week || 0) - (b.week || 0);
});
function summarize(list) {
var summary = { totalGames: list.length, ownerAWins: 0, ownerBWins: 0, ties: 0, ownerATotalPoints: 0, ownerBTotalPoints: 0 };
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
playoffSummary: summarize(playoffMatchups)
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
byOpponent[opponentKey] = { opponentKey: opponentKey, opponentName: opponentName, regularGames: [], playoffGames: [] };
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
playoffSummary: summarizeGames(entry.playoffGames)
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
byOpponent: rows
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
var weeklyRecordNames=["gotham city rogues","eat the sandwich","salsa dancing","team mcfarland","the thirteenth district","former shepaugteacher","best served hot","wearing sperrys popping cherrys","the elite eli's","team charles","team no college yet","rapid city monuments","caucasion sasquatch","chevy cruz's","two first names","brookfield brawlers","paper thin walls","johnny clipboards","team foote longs"];
var weeklyRecordScores={"2012|14|5|4":[[14,107,110],[15,142,101]],"2012|14|0|1":[[14,100,161],[15,134,114]],"2012|14|7|2":[[14,111,137],[15,105,147]],"2012|14|8|6":[[14,135,170],[15,110,140]],"2012|14|9|10":[[14,84,71],[15,115,65]],"2012|14|11|3":[[14,121,48],[15,127,49]],"2012|15|5|1":[[16,136,150],[17,132,147]],"2012|15|0|4":[[16,149,131],[17,138,109]],"2012|15|2|6":[[16,149,184],[17,136,92]],"2012|15|7|9":[[16,75,117],[17,133,80]],"2012|15|8|11":[[16,126,134],[17,110,75]],"2012|15|10|3":[[16,61,33],[17,72,60]],"2013|14|11|0":[[14,143.4,113.4],[15,140.7,225.9]],"2013|14|7|1":[[14,96,135.3],[15,119.7,123.4]],"2013|14|6|5":[[14,138.4,129.8],[15,115.7,110.1]],"2013|14|4|2":[[14,158.8,146.7],[15,139.2,127.5]],"2013|14|10|12":[[14,144.7,127.2],[15,95,130]],"2013|14|13|8":[[14,125.4,132.6],[15,100.6,145.4]],"2013|15|1|0":[[16,71.4,111.2],[17,148.2,106]],"2013|15|11|7":[[16,146.6,113.6],[17,141.7,167.9]],"2013|15|6|4":[[16,89,140.5],[17,86,131.7]],"2013|15|5|12":[[16,112.4,88.8],[17,82.9,93.6]],"2013|15|2|8":[[16,112.2,95.4],[17,134.2,40.7]],"2013|15|10|13":[[16,76.9,117.1],[17,96.1,144.3]],"2014|14|16|2":[[14,164.9,173.8],[15,121.3,101.7]],"2014|14|1|17":[[14,181.3,152.7],[15,129.8,156.1]],"2014|14|0|18":[[14,111.1,124.2],[15,106.2,97.8]],"2014|14|15|14":[[14,101.4,175.2],[15,122.5,120.1]],"2014|14|12|11":[[14,112.9,112.6],[15,98.5,58.2]],"2014|14|4|13":[[14,149.4,125.1],[15,91.1,117.8]],"2014|15|16|1":[[16,106.5,107.3],[17,110.6,117.5]],"2014|15|17|2":[[16,132,123],[17,188.6,121.3]],"2014|15|18|14":[[16,99.5,93],[17,77.6,101.8]],"2014|15|0|12":[[16,117.3,121.9],[17,96.2,126.9]],"2014|15|15|13":[[16,141.5,157.8],[17,111.7,181.1]],"2014|15|11|4":[[16,112.2,126],[17,96.4,108.9]]};
function expandWeeklyRecordGames(games) {
function norm(v) { return String(v || "").replace(/\s+/g, " ").trim().toLowerCase(); }
var expanded=[];
games.forEach(function(g) {
if (g.source !== "espn" || Number(g.year)<2012 || Number(g.year)>2014 || g.gameType === "regular") { expanded.push(g); return; }
var a=weeklyRecordNames.indexOf(norm(g.ownerATeamName));
var b=weeklyRecordNames.indexOf(norm(g.ownerBTeamName));
var weeks=weeklyRecordScores[[g.year,g.week,a,b].join("|")];
var reverse=false;
if (!weeks) { weeks=weeklyRecordScores[[g.year,g.week,b,a].join("|")]; reverse=true; }
if (!weeks) throw new Error("Missing verified weekly playoff scores: "+g.year+"/"+g.week+"/"+g.ownerATeamName);
var ai=reverse?2:1,bi=reverse?1:2;
if (Math.abs(weeks[0][ai]+weeks[1][ai]-g.ownerAScore)>0.011 || Math.abs(weeks[0][bi]+weeks[1][bi]-g.ownerBScore)>0.011) throw new Error("Weekly playoff scores do not match round totals");
weeks.forEach(function(w) { expanded.push(Object.assign({},g,{week:w[0],ownerAScore:w[ai],ownerBScore:w[bi],matchupPeriod:g.week})); });
});
return expanded;
}
function buildGameSidesFromGames(games, split, ownerKeyFilter) {
games = expandWeeklyRecordGames(games);
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
source: g.source
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
source: g.source
});
}
});
return sides;
}
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
source: side.source
};
}
function computeRecordsFromSides(sides) {
if (!sides || sides.length === 0) {
return {
mostPoints: null,
leastPoints: null,
largestMarginVictory: null,
smallestMarginVictory: null,
largestMarginDefeat: null,
smallestMarginDefeat: null
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
smallestMarginDefeat: toRecordEntry(smallestMarginDefeat)
};
}
function buildMasterRecords(allSeasonsData, split) {
var sides = buildGameSides(allSeasonsData, split, null);
return computeRecordsFromSides(sides);
}
function buildMemberRecords(allSeasonsData, split, ownerQuery) {
var ownerKey = normalizeOwnerKey(ownerQuery);
var sides = buildGameSides(allSeasonsData, split, ownerKey);
return computeRecordsFromSides(sides);
}
function getSeasonGames(allSeasonsData, year) {
var yearNum = Number(year);
var season = allSeasonsData.filter(function (s) {
return s.year === yearNum;
});
if (season.length === 0) return [];
var games = [];
season.forEach(function (s) {
games = games.concat(s.games);
});
return games;
}
function buildSeasonMasterRecords(allSeasonsData, year, split) {
var games = getSeasonGames(allSeasonsData, year);
var sides = buildGameSidesFromGames(games, split, null);
return computeRecordsFromSides(sides);
}
function buildSeasonMemberRecords(allSeasonsData, year, split, ownerQuery) {
var ownerKey = normalizeOwnerKey(ownerQuery);
var games = getSeasonGames(allSeasonsData, year);
var sides = buildGameSidesFromGames(games, split, ownerKey);
return computeRecordsFromSides(sides);
}
function buildAllTimeDraftPicks(allSeasonsData, ownerQuery) {
var ownerKey = ownerQuery ? normalizeOwnerKey(ownerQuery) : null;
var picks = [];
allSeasonsData.forEach(function (season) {
(season.draftPicks || []).forEach(function (p) {
if (ownerKey && p.ownerKey !== ownerKey) return;
picks.push(p);
});
});
picks.sort(function (a, b) {
if (a.year !== b.year) return a.year - b.year;
return (a.pickNo || 0) - (b.pickNo || 0);
});
return picks;
}
function getSeasonDraftPicks(allSeasonsData, year, ownerQuery) {
var yearNum = Number(year);
var ownerKey = ownerQuery ? normalizeOwnerKey(ownerQuery) : null;
var picks = [];
allSeasonsData.forEach(function (season) {
if (season.year !== yearNum) return;
(season.draftPicks || []).forEach(function (p) {
if (ownerKey && p.ownerKey !== ownerKey) return;
picks.push(p);
});
});
picks.sort(function (a, b) {
return (a.pickNo || 0) - (b.pickNo || 0);
});
return picks;
}
function buildDraftBreakdown(picks) {
var byPosition = {};
var byNflTeam = {};
picks.forEach(function (p) {
if (p.position) {
byPosition[p.position] = (byPosition[p.position] || 0) + 1;
}
if (p.nflTeam) {
byNflTeam[p.nflTeam] = (byNflTeam[p.nflTeam] || 0) + 1;
}
});
function toSortedList(map) {
return Object.keys(map)
.map(function (k) {
return { key: k, count: map[k] };
})
.sort(function (a, b) {
return b.count - a.count;
});
}
return {
byPosition: toSortedList(byPosition),
byNflTeam: toSortedList(byNflTeam),
totalPicks: picks.length,
picksWithPosition: picks.filter(function (p) {
return !!p.position;
}).length,
picksWithNflTeam: picks.filter(function (p) {
return !!p.nflTeam;
}).length
};
}
function buildKeeperDraftBreakdown(picks) {
var keeperPicks = (picks || []).filter(function (p) {
return !!p.isKeeper;
});
var breakdown = buildDraftBreakdown(keeperPicks);
breakdown.keeperPicks = keeperPicks;
return breakdown;
}
function buildMostDraftedByPosition(allPicks, topN) {
var cap = topN || 10;
var byPosition = {};
var positionOrder = [];
var positionActivity = {};
allPicks.forEach(function (pick) {
var pos = pick.position || "Unknown";
var name = pick.playerName || "Unknown Player";
if (!byPosition[pos]) {
byPosition[pos] = {};
positionOrder.push(pos);
positionActivity[pos] = 0;
}
positionActivity[pos] += 1;
if (!byPosition[pos][name]) {
byPosition[pos][name] = {
playerName: name,
position: pos,
timesDrafted: 0,
years: []
};
}
var entry = byPosition[pos][name];
entry.timesDrafted += 1;
if (pick.year) entry.years.push(pick.year);
});
positionOrder.sort(function (a, b) {
return positionActivity[b] - positionActivity[a];
});
var result = {};
positionOrder.forEach(function (pos) {
var players = Object.keys(byPosition[pos]).map(function (name) {
var entry = byPosition[pos][name];
entry.years.sort(function (a, b) {
return a - b;
});
return entry;
});
players.sort(function (a, b) {
return b.timesDrafted - a.timesDrafted;
});
result[pos] = players.slice(0, cap);
});
return {
positionOrder: positionOrder,
byPosition: result
};
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
buildMostDraftedByPosition: buildMostDraftedByPosition,
getAllOwnerNames: getAllOwnerNames
};
})();
