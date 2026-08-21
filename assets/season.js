/**
 * season.js
 * Drives index.html. One page works for every season, Sleeper (2022+) or
 * ESPN (2012-2021). Pick a season from the dropdown, or load with
 * ?season=YYYY in the URL. The season listed as SleeperAPI.CURRENT_LIVE_SEASON
 * auto-refreshes; ESPN years are static historical data loaded from CSV.
 */

(function () {
  "use strict";

  function byId(id) {
    return document.getElementById(id);
  }

  var state = {
    season: null,
    dataSource: null,
    leagueId: null,
    league: null,
    users: [],
    rosters: [],
    rosterMap: {},
    seedMap: {},
    currentWeek: 1,
    refreshTimer: null,
    playersMap: null,
    winnersBracket: [],
    losersBracket: [],
    finalStandingsInfo: null,
    allWeeksMatchups: null,
    allTransactionsFlat: null,
    txnCountsByRoster: {},
    playoffStartWeek: null,
    espnSeasonData: null,
  };

  function isEspnYear(season) {
    return (
      window.EspnLoader &&
      window.EspnLoader.ESPN_SEASONS.indexOf(Number(season)) !== -1
    );
  }

  function getSeasonFromURL() {
    var params = new URLSearchParams(window.location.search);
    var s = params.get("season");
    return s ? Number(s) : null;
  }

  function populateSeasonSelect() {
    var select = byId("season-select");
    select.innerHTML = "";

    var sleeperYears = Object.keys(SleeperAPI.SLEEPER_SEASONS).map(Number);
    var espnYears = window.EspnLoader ? window.EspnLoader.ESPN_SEASONS.slice() : [];
    var allYears = sleeperYears.concat(espnYears).sort(function (a, b) {
      return b - a;
    });

    allYears.forEach(function (year) {
      var opt = document.createElement("option");
      opt.value = year;
      opt.textContent = year + (isEspnYear(year) ? " (ESPN)" : "");
      select.appendChild(opt);
    });
  }

  function setupTabs() {
    var tabBtns = document.querySelectorAll(".tab-btn");
    tabBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll(".tab-btn").forEach(function (b) {
          b.classList.remove("active");
        });
        document.querySelectorAll(".tab-panel").forEach(function (p) {
          p.classList.remove("active");
        });
        btn.classList.add("active");
        var panel = byId("tab-" + btn.dataset.tab);
        if (panel) panel.classList.add("active");
      });
    });
  }

  function setupMatchupViewToggle() {
    var buttons = document.querySelectorAll(".view-toggle-btn");
    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        buttons.forEach(function (b) {
          b.classList.remove("active");
        });
        btn.classList.add("active");
        var view = btn.dataset.view;
        byId("matchups-week-view").hidden = view !== "week";
        byId("matchups-schedule-view").hidden = view !== "schedule";
        if (view === "schedule") {
          renderTeamSchedule();
        }
      });
    });
  }

  function setupTxnFilterToggle() {
    var select = byId("txn-filter-mode");
    if (!select) return;
    select.addEventListener("change", function () {
      var mode = select.value;
      byId("txn-week-wrap").hidden = mode !== "week";
      byId("txn-member-wrap").hidden = mode !== "member";
      renderTransactions();
    });
  }

  function showFatalError(message) {
    var main = document.querySelector("main");
    if (!main) return;
    var banner = byId("fatal-error-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "fatal-error-banner";
      banner.style.background = "#3a1a1a";
      banner.style.color = "#ffb4b4";
      banner.style.border = "1px solid #ff4f4f";
      banner.style.borderRadius = "8px";
      banner.style.padding = "12px 16px";
      banner.style.marginBottom = "16px";
      banner.style.fontSize = "0.9rem";
      main.prepend(banner);
    }
    banner.textContent = message;
  }

  function showInfoBanner(message) {
    var main = document.querySelector("main");
    if (!main) return;
    var banner = byId("info-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "info-banner";
      banner.style.background = "#1a2a3a";
      banner.style.color = "#a8d4ff";
      banner.style.border = "1px solid #4f8cff";
      banner.style.borderRadius = "8px";
      banner.style.padding = "12px 16px";
      banner.style.marginBottom = "16px";
      banner.style.fontSize = "0.9rem";
      main.prepend(banner);
    }
    banner.textContent = message;
  }

  function clearFatalError() {
    var banner = byId("fatal-error-banner");
    if (banner) banner.remove();
  }

  function clearInfoBanner() {
    var banner = byId("info-banner");
    if (banner) banner.remove();
  }

  async function loadSeason(season) {
    clearFatalError();
    clearInfoBanner();
    if (state.refreshTimer) {
      clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }

    state.season = season;
    state.allWeeksMatchups = null;
    state.allTransactionsFlat = null;
    state.espnSeasonData = null;

    byId("page-title").textContent = season + " Season";

    if (isEspnYear(season)) {
      return loadEspnSeason(season);
    }
    return loadSleeperSeason(season);
  }

  async function loadSleeperSeason(season) {
    state.dataSource = "sleeper";
    state.leagueId = SleeperAPI.SLEEPER_SEASONS[season];

    if (!state.leagueId) {
      showFatalError("No league ID configured for season " + season + ".");
      return;
    }

    var isLive = season === SleeperAPI.CURRENT_LIVE_SEASON;
    byId("live-badge").hidden = !isLive;

    try {
      var league = await SleeperAPI.getLeague(state.leagueId);
      var users = await SleeperAPI.getUsers(state.leagueId);
      var rosters = await SleeperAPI.getRosters(state.leagueId);
      var winnersBracket = await SleeperAPI.getWinnersBracket(state.leagueId).catch(function () {
        return [];
      });
      var losersBracket = await SleeperAPI.getLosersBracket(state.leagueId).catch(function () {
        return [];
      });

      state.league = league;
      state.users = users;
      state.rosters = rosters;
      state.rosterMap = SleeperAPI.buildRosterMap(users, rosters);
      state.seedMap = SleeperAPI.buildSeedMap(state.rosterMap);
      state.currentWeek = await SleeperAPI.getDefaultWeek(league);
      state.winnersBracket = winnersBracket || [];
      state.losersBracket = losersBracket || [];
      state.playoffStartWeek =
        (league.settings && league.settings.playoff_week_start) || null;

      var isComplete = league.status === "complete";
      byId("final-badge").hidden = !isComplete;

      state.finalStandingsInfo = SleeperAPI.buildFinalStandings(
        state.rosterMap,
        state.winnersBracket
      );

      renderChampionBanner();
      renderStandings();
      renderDivisionStandings();
      await ensureAllWeeksMatchups();
      renderBracket("playoff-bracket", state.winnersBracket);
      renderBracket("consolation-bracket", state.losersBracket);
      await populateWeekSelects();
      await renderMatchups();
      await renderTeams();
      await populateRosterTeamSelect();
      await renderWeeklyRoster();
      await populateScheduleTeamSelect();
      await renderDraft();
      await populateTxnMemberSelect();
      await renderTransactions();
      renderLeagueInfoRaw();

      byId("last-refreshed").textContent =
        "Updated " + new Date().toLocaleTimeString();

      if (isLive) {
        state.refreshTimer = setInterval(function () {
          loadSeason(season);
        }, 60000);
      }
    } catch (err) {
      console.error("Failed to load season " + season, err);
      showFatalError(
        "Could not load data for " +
          season +
          " from Sleeper. This usually means the league ID is wrong, " +
          "the league is private, or Sleeper's API is temporarily unreachable. " +
          "Details: " +
          (err && err.message ? err.message : err)
      );
    }
  }

  async function loadEspnSeason(season) {
    state.dataSource = "espn";
    byId("live-badge").hidden = true;
    byId("final-badge").hidden = false;

    if (!window.EspnLoader) {
      showFatalError(
        "espn-loader.js did not load. Check that assets/espn-loader.js " +
          "exists in the repo and that index.html references it."
      );
      return;
    }

    try {
      var data = await window.EspnLoader.loadSeason(season);
      state.espnSeasonData = data;
      state.rosterMap = data.rosterMap;
      state.seedMap = data.seedMap;
      state.winnersBracket = data.winnersBracket;
      state.losersBracket = data.consolationBracket;
      state.finalStandingsInfo = data.finalStandingsInfo;
      state.currentWeek = data.weeks.length ? data.weeks[0] : 1;

      showInfoBanner(
        "This is a historical ESPN season loaded from local data. " +
          "Weekly rosters, draft board, and transaction detail are not " +
          "available for ESPN-era seasons; team-level transaction totals " +
          "will show if that data has been added."
      );

      renderChampionBanner();
      renderStandings();
      renderDivisionStandingsEspn(data.divisionStandings);
      renderBracket("playoff-bracket", state.winnersBracket);
      renderBracket("consolation-bracket", state.losersBracket);
      await populateWeekSelectsEspn(data.weeks);
      renderMatchupsEspn();
      renderTeamsEspn();
      await populateScheduleTeamSelectEspn();
      renderTeamScheduleEspn();
      renderDraftUnavailable();
      renderTransactionsUnavailable();
      renderLeagueInfoRawEspn(season);

      byId("last-refreshed").textContent =
        "Loaded from local ESPN data (" + season + ")";
    } catch (err) {
      console.error("Failed to load ESPN season " + season, err);
      showFatalError(
        "Could not load ESPN data for " +
          season +
          ". Check that assets/data/espn-matchups.csv exists and contains " +
          "rows for this year. Details: " +
          (err && err.message ? err.message : err)
      );
    }
  }

  async function populateWeekSelectsEspn(weeks) {
    var weekSelect = byId("week-select");
    if (!weekSelect) return;
    weekSelect.innerHTML = "";
    weeks.forEach(function (w) {
      var opt = document.createElement("option");
      opt.value = String(w);
      opt.textContent = "Week " + w;
      weekSelect.appendChild(opt);
    });
    weekSelect.value = String(weeks[0] || 1);
    weekSelect.onchange = renderMatchupsEspn;

    var txnWeekSelect = byId("txn-week-select");
    if (txnWeekSelect) txnWeekSelect.innerHTML = "";
    var rosterWeekSelect = byId("roster-week-select");
    if (rosterWeekSelect) rosterWeekSelect.innerHTML = "";
  }

  function renderMatchupsEspn() {
    var weekSelect = byId("week-select");
    var week = Number(weekSelect.value) || state.currentWeek;
    var list = byId("matchups-list");

    var pairs = state.espnSeasonData.getMatchupsForWeek(week);
    if (!pairs || pairs.length === 0) {
      list.innerHTML = "<p>No matchup data for this week.</p>";
      return;
    }

    list.innerHTML = "";
    pairs.forEach(function (pair) {
      var card = document.createElement("div");
      card.className = "matchup-card";
      var aWins = pair.teamB && pair.teamA.points > pair.teamB.points;
      var bWins = pair.teamB && pair.teamB.points > pair.teamA.points;
      var aRecord = pair.teamA.recordAfter ? " (" + pair.teamA.recordAfter + ")" : "";
      var bRecord = pair.teamB && pair.teamB.recordAfter ? " (" + pair.teamB.recordAfter + ")" : "";
      var rowA =
        '<div class="matchup-row ' + (aWins ? "winner" : "") + '">' +
        "<span>" + escapeHtml(pair.teamA.teamName) + escapeHtml(aRecord) + "</span>" +
        "<span>" + pair.teamA.points.toFixed(2) + "</span></div>";
      var rowB = pair.teamB
        ? '<div class="matchup-row ' + (bWins ? "winner" : "") + '">' +
          "<span>" + escapeHtml(pair.teamB.teamName) + escapeHtml(bRecord) + "</span>" +
          "<span>" + pair.teamB.points.toFixed(2) + "</span></div>"
        : '<div class="matchup-row">BYE</div>';
      card.innerHTML =
        rowA +
        rowB +
        '<p class="status-text">Record shown is cumulative through this week. Player-level rosters not available for ESPN seasons.</p>';
      list.appendChild(card);
    });
  }

  function renderTeamsEspn() {
    var grid = byId("teams-grid");
    if (!grid) return;
    grid.innerHTML = "";
    var standings = window.EspnLoader.sortStandings(state.rosterMap);
    standings.forEach(function (team) {
      var card = document.createElement("div");
      card.className = "team-card";
      card.innerHTML =
        "<div><strong>" + escapeHtml(team.teamName) + "</strong></div>" +
        "<p>" + escapeHtml(team.displayName) + "</p>" +
        '<div class="team-stats-row"><span>Record</span><span>' + team.wins + "-" + team.losses + "-" + team.ties + "</span></div>" +
        '<div class="team-stats-row"><span>Points For</span><span>' + team.fpts.toFixed(2) + "</span></div>" +
        '<div class="team-stats-row"><span>Points Against</span><span>' + team.fptsAgainst.toFixed(2) + "</span></div>" +
        '<div class="team-stats-row"><span>Transactions</span><span>Not loaded</span></div>';
      grid.appendChild(card);
    });
  }

  async function populateScheduleTeamSelectEspn() {
    var select = byId("schedule-team-select");
    if (!select) return;
    select.innerHTML = "";
    var standings = window.EspnLoader.sortStandings(state.rosterMap);
    standings.forEach(function (team) {
      var opt = document.createElement("option");
      opt.value = team.rosterId;
      opt.textContent = team.teamName;
      select.appendChild(opt);
    });
    select.onchange = renderTeamScheduleEspn;
  }

  function renderTeamScheduleEspn() {
    var select = byId("schedule-team-select");
    var tbody = document.querySelector("#schedule-table tbody");
    if (!select || !tbody || !state.espnSeasonData) return;

    var teamName = select.value;
    if (!teamName) return;

    var schedule = state.espnSeasonData.getTeamSchedule(teamName);
    if (!schedule || schedule.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6">No schedule data available.</td></tr>';
      return;
    }

    tbody.innerHTML = "";
    schedule.forEach(function (game) {
      var tr = document.createElement("tr");
      if (game.result === "W") tr.classList.add("result-w");
      if (game.result === "L") tr.classList.add("result-l");
      var weekLabel = game.week + (game.isPlayoff ? " (Playoff)" : "");
      tr.innerHTML =
        "<td>" + weekLabel + "</td>" +
        "<td>" + escapeHtml(game.opponentName) + "</td>" +
        "<td>" + game.result + "</td>" +
        "<td>" + game.myPoints.toFixed(2) + "</td>" +
        "<td>" + (game.opponentPoints !== null ? game.opponentPoints.toFixed(2) : "-") + "</td>" +
        "<td>" + escapeHtml(game.recordAfter) + "</td>";
      tbody.appendChild(tr);
    });
  }

  function renderDraftUnavailable() {
    var board = byId("draft-board");
    if (board) board.innerHTML = "<p>Draft board data not available for ESPN seasons yet.</p>";
  }

  function renderTransactionsUnavailable() {
    var list = byId("transactions-list");
    if (list) {
      list.innerHTML =
        "<li>Detailed transaction history is not available for ESPN seasons. " +
        "Team-level transaction totals will appear on the Teams tab once added.</li>";
    }
  }

  function renderLeagueInfoRawEspn(season) {
    var el = byId("league-info-raw");
    if (!el) return;
    el.textContent = JSON.stringify(
      {
        season: season,
        source: "ESPN (local CSV)",
        teams: Object.keys(state.rosterMap).length,
        weeks: state.espnSeasonData ? state.espnSeasonData.weeks.length : 0,
      },
      null,
      2
    );
  }

  async function ensureAllWeeksMatchups() {
    if (state.dataSource !== "sleeper") return null;
    if (state.allWeeksMatchups) return state.allWeeksMatchups;
    state.allWeeksMatchups = await SleeperAPI.getAllWeeksMatchups(state.leagueId, 18);
    return state.allWeeksMatchups;
  }

  async function ensureAllTransactions() {
    if (state.dataSource !== "sleeper") return [];
    if (state.allTransactionsFlat) return state.allTransactionsFlat;
    var weeks = [];
    for (var w = 1; w <= 18; w++) weeks.push(w);
    var chain = Promise.resolve();
    var all = [];
    weeks.forEach(function (week) {
      chain = chain
        .then(function () {
          return SleeperAPI.getTransactions(state.leagueId, week).catch(function () {
            return [];
          });
        })
        .then(function (txns) {
          (txns || []).forEach(function (t) {
            t._week = week;
            all.push(t);
          });
        });
    });
    await chain;
    state.allTransactionsFlat = all;
    state.txnCountsByRoster = SleeperAPI.countTransactionsByRoster(all);
    return all;
  }

  function renderChampionBanner() {
    var banner = byId("champion-banner");
    var textEl = byId("champion-text");
    var info = state.finalStandingsInfo;

    if (info && info.champion) {
      banner.hidden = false;
      var runnerUpText = info.runnerUp
        ? " — defeated " + escapeHtml(info.runnerUp.teamName) + " in the championship"
        : "";
      textEl.textContent =
        state.season +
        " Champion: " +
        info.champion.teamName +
        (info.champion.displayName && info.champion.displayName !== info.champion.teamName
          ? " (" + info.champion.displayName + ")"
          : "") +
        runnerUpText;
    } else {
      banner.hidden = true;
    }
  }

  function renderStandings() {
    var heading = byId("standings-heading");
    var info = state.finalStandingsInfo;
    var isComplete =
      state.dataSource === "espn" || (state.league && state.league.status === "complete");
    heading.textContent = isComplete ? "Final Standings" : "Standings";

    var tbody = document.querySelector("#standings-table tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    var sortFn =
      state.dataSource === "espn" ? window.EspnLoader.sortStandings : SleeperAPI.sortStandings;
    var standings = info ? info.standings : sortFn(state.rosterMap);

    standings.forEach(function (team, idx) {
      var tr = document.createElement("tr");
      var isChamp = info && info.champion && info.champion.rosterId === team.rosterId;
      var isRunnerUp = info && info.runnerUp && info.runnerUp.rosterId === team.rosterId;
      if (isChamp) tr.classList.add("champion-row");
      if (isRunnerUp) tr.classList.add("runner-up-row");

      var resultTag = "";
      if (isChamp) resultTag = '<span class="result-tag champ">CHAMPION</span>';
      else if (isRunnerUp) resultTag = '<span class="result-tag runner-up">RUNNER-UP</span>';

      tr.innerHTML =
        "<td>" + (idx + 1) + "</td>" +
        "<td>" + escapeHtml(team.teamName) + "</td>" +
        "<td>" + escapeHtml(team.displayName) + "</td>" +
        "<td>" + team.wins + "</td>" +
        "<td>" + team.losses + "</td>" +
        "<td>" + team.ties + "</td>" +
        "<td>" + team.fpts.toFixed(2) + "</td>" +
        "<td>" + team.fptsAgainst.toFixed(2) + "</td>" +
        "<td>" + resultTag + "</td>";
      tbody.appendChild(tr);
    });
  }

  function renderDivisionStandings() {
    var wrap = byId("division-standings-wrap");
    if (!wrap) return;
    if (state.dataSource === "espn") return; // handled separately by renderDivisionStandingsEspn

    var divisions = SleeperAPI.buildDivisionStandings(
      state.rosterMap,
      state.league,
      state.finalStandingsInfo
    );

    if (!divisions || divisions.length === 0) {
      wrap.hidden = true;
      return;
    }

    wrap.hidden = false;
    renderDivisionCards(divisions);
  }

  function renderDivisionStandingsEspn(divisions) {
    var wrap = byId("division-standings-wrap");
    if (!wrap) return;

    if (!divisions || divisions.length === 0) {
      wrap.hidden = true;
      return;
    }

    wrap.hidden = false;
    renderDivisionCards(divisions);
  }

  function renderDivisionCards(divisions) {
    var container = byId("division-standings");
    if (!container) return;
    container.innerHTML = "";
    divisions.forEach(function (div) {
      var card = document.createElement("div");
      card.className = "division-card";
      var rows = div.standings
        .map(function (team, idx) {
          var isChamp = div.champion && div.champion.rosterId === team.rosterId;
          var isRunnerUp = div.runnerUp && div.runnerUp.rosterId === team.rosterId;
          var tag = isChamp ? " 🏆" : isRunnerUp ? " 🥈" : "";
          return (
            "<tr><td>" + (idx + 1) + "</td><td>" + escapeHtml(team.teamName) + tag +
            "</td><td>" + team.wins + "-" + team.losses + "-" + team.ties +
            "</td><td>" + team.fpts.toFixed(1) + "</td></tr>"
          );
        })
        .join("");
      card.innerHTML =
        "<h4>" + escapeHtml(div.divisionName) +
        "</h4><table><thead><tr><th>#</th><th>Team</th><th>Record</th><th>PF</th></tr></thead><tbody>" +
        rows + "</tbody></table>";
      container.appendChild(card);
    });
  }

  function renderBracket(containerId, bracketData) {
    var container = byId(containerId);
    if (!container) return;

    var rounds;
    if (state.dataSource === "espn") {
      rounds = bracketData;
    } else {
      rounds = SleeperAPI.buildBracketView(
        bracketData,
        state.rosterMap,
        state.seedMap,
        state.allWeeksMatchups,
        state.playoffStartWeek
      );
    }

    if (!rounds || rounds.length === 0) {
      container.innerHTML = "<p>No bracket data available yet for this season.</p>";
      return;
    }

    container.innerHTML = "";
    var matchCounter = 0;
    rounds.forEach(function (roundData) {
      var roundDiv = document.createElement("div");
      roundDiv.className = "bracket-round";
      var roundTitle = document.createElement("h4");
      roundTitle.textContent = "Round " + roundData.round;
      roundDiv.appendChild(roundTitle);

      roundData.matches.forEach(function (m) {
        matchCounter++;
        var matchDiv = document.createElement("div");
        matchDiv.className = "bracket-match";

        [
          { slot: m.slot1, score: m.slot1Score },
          { slot: m.slot2, score: m.slot2Score },
        ].forEach(function (entry) {
          var slot = entry.slot;
          var slotDiv = document.createElement("div");
          var isWinner = slot.resolved && m.winnerRosterId === slot.rosterId;
          slotDiv.className =
            "bracket-slot" + (isWinner ? " win" : "") + (!slot.resolved ? " unresolved" : "");
          var seedHtml = slot.seed ? '<span class="seed">#' + slot.seed + "</span>" : "";
          var scoreHtml =
            entry.score !== null && entry.score !== undefined
              ? '<span class="score">' + entry.score.toFixed(1) + "</span>"
              : "";
          slotDiv.innerHTML = "<span>" + seedHtml + escapeHtml(slot.teamName) + "</span>" + scoreHtml;
          matchDiv.appendChild(slotDiv);
        });

        if (state.dataSource === "sleeper" && m.week && (m.slot1.rosterId || m.slot2.rosterId)) {
          var toggleId = containerId + "-rosters-" + matchCounter;
          var toggleDiv = document.createElement("div");
          toggleDiv.className = "bracket-match-toggle";
          var toggleBtn = document.createElement("button");
          toggleBtn.className = "btn btn-small";
          toggleBtn.textContent = "Show rosters";
          toggleBtn.dataset.target = toggleId;
          toggleBtn.dataset.week = m.week;
          toggleBtn.dataset.roster1 = m.slot1.rosterId || "";
          toggleBtn.dataset.roster2 = m.slot2.rosterId || "";
          toggleDiv.appendChild(toggleBtn);
          matchDiv.appendChild(toggleDiv);

          var rostersDiv = document.createElement("div");
          rostersDiv.className = "bracket-rosters";
          rostersDiv.id = toggleId;
          matchDiv.appendChild(rostersDiv);
        }

        roundDiv.appendChild(matchDiv);
      });

      container.appendChild(roundDiv);
    });

    if (state.dataSource === "sleeper") {
      container.querySelectorAll(".bracket-match-toggle button").forEach(function (btn) {
        btn.addEventListener("click", async function () {
          var target = byId(btn.dataset.target);
          if (!target) return;
          var expanded = target.classList.contains("expanded");
          if (expanded) {
            target.classList.remove("expanded");
            btn.textContent = "Show rosters";
            return;
          }

          btn.textContent = "Loading…";
          try {
            if (!state.playersMap) {
              state.playersMap = await SleeperAPI.getPlayersMap();
            }
            var week = Number(btn.dataset.week);
            var weekMatchups = state.allWeeksMatchups[week] || [];
            var r1 = Number(btn.dataset.roster1) || null;
            var r2 = Number(btn.dataset.roster2) || null;

            var side1 = weekMatchups.find(function (mu) {
              return mu.roster_id === r1;
            });
            var side2 = weekMatchups.find(function (mu) {
              return mu.roster_id === r2;
            });

            var html =
              '<div class="matchup-roster-col"><h5>' +
              escapeHtml(r1 && state.rosterMap[r1] ? state.rosterMap[r1].teamName : "Team 1") +
              "</h5>" + rosterListHtml(side1) + "</div>" +
              '<div class="matchup-roster-col"><h5>' +
              escapeHtml(r2 && state.rosterMap[r2] ? state.rosterMap[r2].teamName : "Team 2") +
              "</h5>" + rosterListHtml(side2) + "</div>";

            target.innerHTML = html;
            target.classList.add("expanded");
            btn.textContent = "Hide rosters";
          } catch (e) {
            target.innerHTML = "<p>Roster data unavailable.</p>";
            target.classList.add("expanded");
            btn.textContent = "Hide rosters";
          }
        });
      });
    }
  }

  function rosterListHtml(teamSide) {
    if (!teamSide) return "<p>No data.</p>";
    var roster = SleeperAPI.resolveMatchupRoster(teamSide, state.playersMap || {});
    if (!roster || roster.length === 0) return "<p>No roster data.</p>";
    var items = roster
      .map(function (p) {
        var cls = p.isStarter ? "" : "bench-player";
        var pts = p.points !== null ? p.points.toFixed(1) : "-";
        return (
          '<li class="' + cls + '"><span>' + escapeHtml(p.name) + " (" + escapeHtml(p.position) + ")</span><span>" + pts + "</span></li>"
        );
      })
      .join("");
    return "<ul>" + items + "</ul>";
  }

  async function populateWeekSelects() {
    var weekSelect = byId("week-select");
    var txnWeekSelect = byId("txn-week-select");
    var rosterWeekSelect = byId("roster-week-select");
    if (!weekSelect || !txnWeekSelect || !rosterWeekSelect) return;

    [weekSelect, txnWeekSelect, rosterWeekSelect].forEach(function (sel) {
      sel.innerHTML = "";
    });

    for (var w = 1; w <= 18; w++) {
      [weekSelect, txnWeekSelect, rosterWeekSelect].forEach(function (sel) {
        var opt = document.createElement("option");
        opt.value = String(w);
        opt.textContent = "Week " + w;
        sel.appendChild(opt);
      });
    }
    weekSelect.value = String(state.currentWeek);
    txnWeekSelect.value = String(state.currentWeek);
    rosterWeekSelect.value = String(state.currentWeek);

    weekSelect.onchange = renderMatchups;
    txnWeekSelect.onchange = renderTransactions;
    rosterWeekSelect.onchange = renderWeeklyRoster;
  }

  async function renderMatchups() {
    var weekSelect = byId("week-select");
    var week = Number(weekSelect.value) || state.currentWeek;
    var list = byId("matchups-list");
    list.innerHTML = "<p>Loading…</p>";

    var matchups = state.allWeeksMatchups ? state.allWeeksMatchups[week] : null;
    if (!matchups) {
      try {
        matchups = await SleeperAPI.getMatchups(state.leagueId, week);
      } catch (e) {
        list.innerHTML = "<p>No matchup data for this week.</p>";
        return;
      }
    }

    if (!matchups || matchups.length === 0) {
      list.innerHTML = "<p>No matchup data for this week yet.</p>";
      return;
    }

    if (!state.playersMap) {
      try {
        state.playersMap = await SleeperAPI.getPlayersMap();
      } catch (e) {
        state.playersMap = {};
      }
    }

    var pairs = SleeperAPI.pairMatchups(matchups, state.rosterMap);
    list.innerHTML = "";
    pairs.forEach(function (pair, idx) {
      var card = document.createElement("div");
      card.className = "matchup-card";
      var aWins = pair.teamB && pair.teamA.points > pair.teamB.points;
      var bWins = pair.teamB && pair.teamB.points > pair.teamA.points;
      var rowA =
        '<div class="matchup-row ' + (aWins ? "winner" : "") + '">' +
        "<span>" + escapeHtml(pair.teamA.teamName) + "</span>" +
        "<span>" + pair.teamA.points.toFixed(2) + "</span></div>";
      var rowB = pair.teamB
        ? '<div class="matchup-row ' + (bWins ? "winner" : "") + '">' +
          "<span>" + escapeHtml(pair.teamB.teamName) + "</span>" +
          "<span>" + pair.teamB.points.toFixed(2) + "</span></div>"
        : '<div class="matchup-row">BYE</div>';

      var toggleId = "matchup-rosters-" + idx;
      var toggleHtml =
        '<div class="matchup-toggle"><button class="btn btn-small" data-target="' +
        toggleId + '">Show rosters</button></div>';

      var rosterAHtml = rosterListHtml(pair.teamA);
      var rosterBHtml = pair.teamB ? rosterListHtml(pair.teamB) : "<p>BYE week</p>";

      var rostersHtml =
        '<div class="matchup-rosters" id="' + toggleId + '">' +
        '<div class="matchup-roster-col"><h5>' + escapeHtml(pair.teamA.teamName) + "</h5>" + rosterAHtml + "</div>" +
        '<div class="matchup-roster-col"><h5>' + escapeHtml(pair.teamB ? pair.teamB.teamName : "") + "</h5>" + rosterBHtml + "</div>" +
        "</div>";

      card.innerHTML = rowA + rowB + toggleHtml + rostersHtml;
      list.appendChild(card);
    });

    list.querySelectorAll(".matchup-toggle button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var target = byId(btn.dataset.target);
        if (!target) return;
        var expanded = target.classList.toggle("expanded");
        btn.textContent = expanded ? "Hide rosters" : "Show rosters";
      });
    });
  }

  async function populateScheduleTeamSelect() {
    var select = byId("schedule-team-select");
    if (!select) return;
    select.innerHTML = "";
    var standings = SleeperAPI.sortStandings(state.rosterMap);
    standings.forEach(function (team) {
      var opt = document.createElement("option");
      opt.value = String(team.rosterId);
      opt.textContent = team.teamName + " (" + team.displayName + ")";
      select.appendChild(opt);
    });
    select.onchange = renderTeamSchedule;
  }

  async function renderTeamSchedule() {
    if (state.dataSource === "espn") {
      renderTeamScheduleEspn();
      return;
    }

    var select = byId("schedule-team-select");
    var tbody = document.querySelector("#schedule-table tbody");
    if (!select || !tbody) return;

    var rosterId = Number(select.value);
    if (!rosterId) return;

    tbody.innerHTML = '<tr><td colspan="5">Loading…</td></tr>';
    await ensureAllWeeksMatchups();

    var schedule = SleeperAPI.buildTeamSchedule(state.allWeeksMatchups, rosterId, state.rosterMap);
    if (!schedule || schedule.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5">No schedule data available.</td></tr>';
      return;
    }

    tbody.innerHTML = "";
    schedule.forEach(function (game) {
      var tr = document.createElement("tr");
      if (game.result === "W") tr.classList.add("result-w");
      if (game.result === "L") tr.classList.add("result-l");
      tr.innerHTML =
        "<td>" + game.week + "</td>" +
        "<td>" + escapeHtml(game.opponentName) + "</td>" +
        "<td>" + game.result + "</td>" +
        "<td>" + game.myPoints.toFixed(2) + "</td>" +
        "<td>" + (game.opponentPoints !== null ? game.opponentPoints.toFixed(2) : "-") + "</td>";
      tbody.appendChild(tr);
    });
  }

  async function renderTeams() {
    var grid = byId("teams-grid");
    if (!grid) return;
    grid.innerHTML = "<p>Loading…</p>";

    await ensureAllTransactions();

    grid.innerHTML = "";
    var standings = SleeperAPI.sortStandings(state.rosterMap);
    standings.forEach(function (team) {
      var card = document.createElement("div");
      card.className = "team-card";
      var avatarHtml = team.avatar
        ? '<img src="' + team.avatar + '" alt="' + escapeHtml(team.teamName) + '" />'
        : "";
      var txnCount = state.txnCountsByRoster[team.rosterId] || 0;
      card.innerHTML =
        "<div>" + avatarHtml + "<strong>" + escapeHtml(team.teamName) + "</strong></div>" +
        "<p>" + escapeHtml(team.displayName) + "</p>" +
        '<div class="team-stats-row"><span>Record</span><span>' + team.wins + "-" + team.losses + "-" + team.ties + "</span></div>" +
        '<div class="team-stats-row"><span>Points For</span><span>' + team.fpts.toFixed(2) + "</span></div>" +
        '<div class="team-stats-row"><span>Points Against</span><span>' + team.fptsAgainst.toFixed(2) + "</span></div>" +
        '<div class="team-stats-row"><span>Transactions</span><span>' + txnCount + "</span></div>" +
        '<div class="team-stats-row"><span>Roster Size</span><span>' + team.players.length + "</span></div>";
      grid.appendChild(card);
    });
  }

  async function populateRosterTeamSelect() {
    var select = byId("roster-team-select");
    if (!select) return;
    select.innerHTML = "";
    var standings = SleeperAPI.sortStandings(state.rosterMap);
    standings.forEach(function (team) {
      var opt = document.createElement("option");
      opt.value = String(team.rosterId);
      opt.textContent = team.teamName + " (" + team.displayName + ")";
      select.appendChild(opt);
    });
    select.onchange = renderWeeklyRoster;
  }

  async function renderWeeklyRoster() {
    if (state.dataSource === "espn") {
      var tbody = document.querySelector("#roster-table tbody");
      if (tbody) tbody.innerHTML = '<tr><td colspan="5">Weekly rosters not available for ESPN seasons.</td></tr>';
      return;
    }

    var teamSelect = byId("roster-team-select");
    var weekSelect = byId("roster-week-select");
    var totalEl = byId("roster-total");
    var tbody2 = document.querySelector("#roster-table tbody");
    if (!teamSelect || !weekSelect || !tbody2) return;

    var rosterId = Number(teamSelect.value);
    var week = Number(weekSelect.value) || state.currentWeek;
    if (!rosterId) return;

    tbody2.innerHTML = '<tr><td colspan="5">Loading…</td></tr>';
    totalEl.textContent = "";

    try {
      if (!state.playersMap) {
        state.playersMap = await SleeperAPI.getPlayersMap();
      }
      var matchupsForWeek = state.allWeeksMatchups
        ? state.allWeeksMatchups[week]
        : await SleeperAPI.getMatchups(state.leagueId, week);

      var rosterData = SleeperAPI.buildWeeklyRoster(matchupsForWeek || [], rosterId, state.playersMap);

      if (!rosterData) {
        tbody2.innerHTML = '<tr><td colspan="5">No roster data for this week.</td></tr>';
        return;
      }

      var team = state.rosterMap[rosterId];
      totalEl.innerHTML =
        escapeHtml(team ? team.teamName : "Team") + " — Week " + week +
        " total: <strong>" + rosterData.totalPoints.toFixed(2) + " pts</strong>";

      tbody2.innerHTML = "";
      rosterData.players.forEach(function (p) {
        var tr = document.createElement("tr");
        tr.className = p.isStarter ? "starter-row" : "bench-row";
        tr.innerHTML =
          "<td>" + (p.isStarter ? "Starter" : "Bench") + "</td>" +
          "<td>" + escapeHtml(p.name) + "</td>" +
          "<td>" + escapeHtml(p.position) + "</td>" +
          "<td>" + escapeHtml(p.team) + "</td>" +
          "<td>" + (p.points !== null ? p.points.toFixed(2) : "-") + "</td>";
        tbody2.appendChild(tr);
      });
    } catch (e) {
      console.error(e);
      tbody2.innerHTML = '<tr><td colspan="5">Roster data unavailable for this week.</td></tr>';
    }
  }

  async function renderDraft() {
    if (state.dataSource === "espn") {
      renderDraftUnavailable();
      return;
    }

    var board = byId("draft-board");
    if (!board) return;
    board.innerHTML = "<p>Loading…</p>";
    try {
      var draft = await SleeperAPI.getDraft(state.leagueId);
      if (!draft) {
        board.innerHTML = "<p>No draft found for this season.</p>";
        return;
      }
      var picks = await SleeperAPI.getDraftPicks(draft.draft_id);
      var boardData = SleeperAPI.buildDraftBoard(picks, state.rosterMap);
      board.innerHTML = "";
      boardData.forEach(function (pick) {
        var div = document.createElement("div");
        div.className = "draft-pick";
        div.innerHTML =
          '<div class="pick-num">Pick ' + pick.pickNo + " (R" + pick.round + ')</div>' +
          "<div>" + escapeHtml(pick.playerName) + "</div>" +
          "<div>" + escapeHtml(pick.position) + " " + escapeHtml(pick.nflTeam) + "</div>" +
          '<div class="draft-owner">' + escapeHtml(pick.teamName) + "</div>";
        board.appendChild(div);
      });
    } catch (e) {
      board.innerHTML = "<p>Draft data unavailable.</p>";
    }
  }

  async function populateTxnMemberSelect() {
    var select = byId("txn-member-select");
    if (!select) return;
    select.innerHTML = "";
    var standings = SleeperAPI.sortStandings(state.rosterMap);
    standings.forEach(function (team) {
      var opt = document.createElement("option");
      opt.value = String(team.rosterId);
      opt.textContent = team.teamName + " (" + team.displayName + ")";
      select.appendChild(opt);
    });
    select.onchange = renderTransactions;
  }

  async function renderTransactions() {
    if (state.dataSource === "espn") {
      renderTransactionsUnavailable();
      return;
    }

    var mode = byId("txn-filter-mode").value;
    var list = byId("transactions-list");
    list.innerHTML = "<li>Loading…</li>";

    if (!state.playersMap) {
      try {
        state.playersMap = await SleeperAPI.getPlayersMap();
      } catch (e) {
        state.playersMap = {};
      }
    }

    var txns = [];
    if (mode === "week") {
      var week = Number(byId("txn-week-select").value) || state.currentWeek;
      try {
        txns = await SleeperAPI.getTransactions(state.leagueId, week);
      } catch (e) {
        txns = [];
      }
    } else {
      var rosterId = Number(byId("txn-member-select").value);
      await ensureAllTransactions();
      txns = (state.allTransactionsFlat || []).filter(function (t) {
        return (t.roster_ids || []).indexOf(rosterId) !== -1;
      });
    }

    if (!txns || txns.length === 0) {
      list.innerHTML = "<li>No transactions found.</li>";
      return;
    }

    list.innerHTML = "";
    txns.forEach(function (txn) {
      var detail = SleeperAPI.resolveTransactionDetail(txn, state.rosterMap, state.playersMap);
      var li = document.createElement("li");

      var headerHtml =
        '<div class="txn-header"><span>' + escapeHtml(detail.teams.join(" ↔ ")) +
        '</span><span class="txn-type-tag">' + escapeHtml(detail.type) + "</span></div>";

      var dateHtml =
        '<div class="txn-detail-row">' + new Date(detail.statusUpdated).toLocaleString() +
        (txn._week ? " — Week " + txn._week : "") + "</div>";

      var addsHtml = detail.adds.length
        ? detail.adds.map(function (a) {
            return '<div class="txn-detail-row"><span class="add-tag">+ ADD</span> ' +
              escapeHtml(a.player) + " → " + escapeHtml(a.team) + "</div>";
          }).join("")
        : "";

      var dropsHtml = detail.drops.length
        ? detail.drops.map(function (d) {
            return '<div class="txn-detail-row"><span class="drop-tag">- DROP</span> ' +
              escapeHtml(d.player) + " from " + escapeHtml(d.team) + "</div>";
          }).join("")
        : "";

      var picksHtml = detail.draftPicks.length
        ? detail.draftPicks.map(function (dp) {
            return '<div class="txn-detail-row">Draft pick: ' + dp.season + " Round " + dp.round +
              " (" + escapeHtml(dp.from) + " → " + escapeHtml(dp.to) + ")</div>";
          }).join("")
        : "";

      var faabHtml =
        detail.faab && detail.faab.length
          ? detail.faab.map(function (f) {
              return '<div class="txn-detail-row">FAAB: $' + f.amount +
                " (" + escapeHtml(f.from) + " → " + escapeHtml(f.to) + ")</div>";
            }).join("")
          : "";

      li.innerHTML = headerHtml + dateHtml + addsHtml + dropsHtml + picksHtml + faabHtml;
      list.appendChild(li);
    });
  }

  function renderLeagueInfoRaw() {
    var el = byId("league-info-raw");
    if (!el || !state.league) return;
    el.textContent = JSON.stringify(
      {
        name: state.league.name,
        season: state.league.season,
        status: state.league.status,
        total_rosters: state.league.total_rosters,
        scoring_settings_sample: state.league.scoring_settings
          ? Object.keys(state.league.scoring_settings).slice(0, 5)
          : [],
      },
      null,
      2
    );
  }

  function setupFreezeButton() {
    var btn = byId("freeze-btn");
    if (!btn) return;
    btn.addEventListener("click", async function () {
      var statusEl = byId("freeze-status");
      if (state.dataSource === "espn") {
        statusEl.textContent = "Freeze/export is only available for Sleeper seasons.";
        return;
      }
      statusEl.textContent = "Building snapshot… this may take a moment.";
      try {
        var snapshot = await SleeperAPI.buildSeasonSnapshot(state.leagueId);
        SleeperAPI.downloadJSON(snapshot, "league_season_" + state.season + "_snapshot.json");
        statusEl.textContent = "Snapshot downloaded at " + new Date().toLocaleTimeString() + ".";
      } catch (e) {
        statusEl.textContent = "Snapshot failed. Please try again.";
      }
    });
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  async function init() {
    if (!window.SleeperAPI) {
      showFatalError(
        "sleeper-common.js did not load. Check that assets/sleeper-common.js " +
          "exists in the repo and that index.html references it correctly."
      );
      return;
    }

    populateSeasonSelect();
    setupTabs();
    setupMatchupViewToggle();
    setupTxnFilterToggle();
    setupFreezeButton();

    var urlSeason = getSeasonFromURL();
    var defaultSeason =
      urlSeason && (SleeperAPI.SLEEPER_SEASONS[urlSeason] || isEspnYear(urlSeason))
        ? urlSeason
        : SleeperAPI.CURRENT_LIVE_SEASON;

    byId("season-select").value = String(defaultSeason);
    byId("season-select").addEventListener("change", function (e) {
      var season = Number(e.target.value);
      var url = new URL(window.location);
      url.searchParams.set("season", season);
      window.history.pushState({}, "", url);
      loadSeason(season);
    });

    byId("refresh-btn").addEventListener("click", function () {
      loadSeason(state.season);
    });

    await loadSeason(defaultSeason);
  }

  window.addEventListener("DOMContentLoaded", function () {
    init();
  });

  if (document.readyState === "complete" || document.readyState === "interactive") {
    init();
  }
})();
