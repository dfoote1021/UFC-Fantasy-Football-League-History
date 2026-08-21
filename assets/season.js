/**
 * season.js
 * Drives index.html. One page works for every Sleeper season -
 * pick a season from the dropdown, or load with ?season=2026 in the URL.
 * The season listed as SleeperAPI.CURRENT_LIVE_SEASON auto-refreshes.
 *
 * NOTE: Everything is wrapped in an IIFE and avoids top-level
 * const/let destructuring from window.SleeperAPI to prevent
 * "Can't create duplicate variable that shadows a global property"
 * errors on reload.
 */

(function () {
  "use strict";

  function byId(id) {
    return document.getElementById(id);
  }

  var state = {
    season: null,
    leagueId: null,
    league: null,
    users: [],
    rosters: [],
    rosterMap: {},
    currentWeek: 1,
    refreshTimer: null,
    playersMap: null,
    winnersBracket: [],
    finalStandingsInfo: null,
  };

  function getSeasonFromURL() {
    var params = new URLSearchParams(window.location.search);
    var s = params.get("season");
    return s ? Number(s) : null;
  }

  function populateSeasonSelect() {
    var select = byId("season-select");
    select.innerHTML = "";
    var years = Object.keys(SleeperAPI.SLEEPER_SEASONS).sort(function (a, b) {
      return Number(b) - Number(a);
    });
    years.forEach(function (year) {
      var opt = document.createElement("option");
      opt.value = year;
      opt.textContent = year;
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

  function clearFatalError() {
    var banner = byId("fatal-error-banner");
    if (banner) banner.remove();
  }

  async function loadSeason(season) {
    clearFatalError();
    if (state.refreshTimer) {
      clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }

    state.season = season;
    state.leagueId = SleeperAPI.SLEEPER_SEASONS[season];

    if (!state.leagueId) {
      showFatalError("No league ID configured for season " + season + ".");
      return;
    }

    byId("page-title").textContent = season + " Season";
    var isLive = season === SleeperAPI.CURRENT_LIVE_SEASON;
    byId("live-badge").hidden = !isLive;

    try {
      var league = await SleeperAPI.getLeague(state.leagueId);
      var users = await SleeperAPI.getUsers(state.leagueId);
      var rosters = await SleeperAPI.getRosters(state.leagueId);
      var winnersBracket = await SleeperAPI.getWinnersBracket(state.leagueId).catch(function () {
        return [];
      });

      state.league = league;
      state.users = users;
      state.rosters = rosters;
      state.rosterMap = SleeperAPI.buildRosterMap(users, rosters);
      state.currentWeek = await SleeperAPI.getDefaultWeek(league);
      state.winnersBracket = winnersBracket || [];

      var isComplete = league.status === "complete";
      byId("final-badge").hidden = !isComplete;

      state.finalStandingsInfo = SleeperAPI.buildFinalStandings(
        state.rosterMap,
        state.winnersBracket
      );

      renderChampionBanner();
      renderStandings();
      renderPlayoffBracket();
      await populateWeekSelects();
      await renderMatchups();
      renderTeams();
      await populateRosterTeamSelect();
      await renderWeeklyRoster();
      await renderDraft();
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
        " (" +
        info.champion.displayName +
        ")" +
        runnerUpText;
    } else {
      banner.hidden = true;
    }
  }

  function renderStandings() {
    var heading = byId("standings-heading");
    var info = state.finalStandingsInfo;
    var isComplete = state.league && state.league.status === "complete";
    heading.textContent = isComplete ? "Final Standings" : "Standings";

    var tbody = document.querySelector("#standings-table tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    var standings = info ? info.standings : SleeperAPI.sortStandings(state.rosterMap);

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

  function renderPlayoffBracket() {
    var container = byId("playoff-bracket");
    if (!container) return;
    var info = state.finalStandingsInfo;

    if (!info || !info.playoffRounds || info.playoffRounds.length === 0) {
      container.innerHTML = "<p>No playoff bracket available yet for this season.</p>";
      return;
    }

    container.innerHTML = "";
    info.playoffRounds.forEach(function (roundData) {
      var roundDiv = document.createElement("div");
      roundDiv.className = "bracket-round";
      var roundTitle = document.createElement("h4");
      roundTitle.textContent = "Round " + roundData.round;
      roundDiv.appendChild(roundTitle);

      roundData.matches.forEach(function (m) {
        var t1 = typeof m.t1 === "number" ? state.rosterMap[m.t1] : null;
        var t2 = typeof m.t2 === "number" ? state.rosterMap[m.t2] : null;
        var t1Name = t1 ? t1.teamName : (m.t1_from ? "TBD" : "BYE");
        var t2Name = t2 ? t2.teamName : (m.t2_from ? "TBD" : "BYE");
        var matchDiv = document.createElement("div");
        matchDiv.className = "bracket-match";
        var t1Class = m.w === m.t1 ? "win" : "";
        var t2Class = m.w === m.t2 ? "win" : "";
        matchDiv.innerHTML =
          '<div class="' + t1Class + '">' + escapeHtml(t1Name) + "</div>" +
          '<div class="' + t2Class + '">' + escapeHtml(t2Name) + "</div>";
        roundDiv.appendChild(matchDiv);
      });

      container.appendChild(roundDiv);
    });
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

    var matchups;
    try {
      matchups = await SleeperAPI.getMatchups(state.leagueId, week);
    } catch (e) {
      list.innerHTML = "<p>No matchup data for this week.</p>";
      return;
    }

    if (!matchups || matchups.length === 0) {
      list.innerHTML = "<p>No matchup data for this week yet.</p>";
      return;
    }

    var pairs = SleeperAPI.pairMatchups(matchups, state.rosterMap);
    list.innerHTML = "";
    pairs.forEach(function (pair) {
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
      card.innerHTML = rowA + rowB;
      list.appendChild(card);
    });
  }

  function renderTeams() {
    var grid = byId("teams-grid");
    if (!grid) return;
    grid.innerHTML = "";
    var standings = SleeperAPI.sortStandings(state.rosterMap);
    standings.forEach(function (team) {
      var card = document.createElement("div");
      card.className = "team-card";
      var avatarHtml = team.avatar
        ? '<img src="' + team.avatar + '" alt="' + escapeHtml(team.teamName) + '" />'
        : "";
      card.innerHTML =
        "<div>" + avatarHtml + "<strong>" + escapeHtml(team.teamName) + "</strong></div>" +
        "<p>" + escapeHtml(team.displayName) + "</p>" +
        "<p>" + team.wins + "-" + team.losses + "-" + team.ties + " · " + team.fpts.toFixed(2) + " PF</p>" +
        "<p>Roster size: " + team.players.length + "</p>";
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
    var teamSelect = byId("roster-team-select");
    var weekSelect = byId("roster-week-select");
    var totalEl = byId("roster-total");
    var tbody = document.querySelector("#roster-table tbody");
    if (!teamSelect || !weekSelect || !tbody) return;

    var rosterId = Number(teamSelect.value);
    var week = Number(weekSelect.value) || state.currentWeek;
    if (!rosterId) return;

    tbody.innerHTML = '<tr><td colspan="5">Loading…</td></tr>';
    totalEl.textContent = "";

    try {
      if (!state.playersMap) {
        state.playersMap = await SleeperAPI.getPlayersMap();
      }
      var matchupsForWeek = await SleeperAPI.getMatchups(state.leagueId, week);
      var rosterData = SleeperAPI.buildWeeklyRoster(
        matchupsForWeek,
        rosterId,
        state.playersMap
      );

      if (!rosterData) {
        tbody.innerHTML = '<tr><td colspan="5">No roster data for this week.</td></tr>';
        return;
      }

      var team = state.rosterMap[rosterId];
      totalEl.innerHTML =
        escapeHtml(team ? team.teamName : "Team") +
        " — Week " +
        week +
        " total: <strong>" +
        rosterData.totalPoints.toFixed(2) +
        " pts</strong>";

      tbody.innerHTML = "";
      rosterData.players.forEach(function (p) {
        var tr = document.createElement("tr");
        tr.className = p.isStarter ? "starter-row" : "bench-row";
        tr.innerHTML =
          "<td>" + (p.isStarter ? "Starter" : "Bench") + "</td>" +
          "<td>" + escapeHtml(p.name) + "</td>" +
          "<td>" + escapeHtml(p.position) + "</td>" +
          "<td>" + escapeHtml(p.team) + "</td>" +
          "<td>" + (p.points !== null ? p.points.toFixed(2) : "-") + "</td>";
        tbody.appendChild(tr);
      });
    } catch (e) {
      console.error(e);
      tbody.innerHTML = '<tr><td colspan="5">Roster data unavailable for this week.</td></tr>';
    }
  }

  async function renderDraft() {
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

  async function renderTransactions() {
    var txnWeekSelect = byId("txn-week-select");
    var week = Number(txnWeekSelect.value) || state.currentWeek;
    var list = byId("transactions-list");
    list.innerHTML = "<li>Loading…</li>";

    var txns;
    try {
      txns = await SleeperAPI.getTransactions(state.leagueId, week);
    } catch (e) {
      list.innerHTML = "<li>No transaction data for this week.</li>";
      return;
    }

    if (!txns || txns.length === 0) {
      list.innerHTML = "<li>No transactions this week.</li>";
      return;
    }

    list.innerHTML = "";
    txns.forEach(function (txn) {
      var li = document.createElement("li");
      var teamNames = (txn.roster_ids || [])
        .map(function (rid) {
          return state.rosterMap[rid] ? state.rosterMap[rid].teamName : "Roster " + rid;
        })
        .join(", ");
      li.textContent =
        txn.type.toUpperCase() + " — " + teamNames + " — " +
        new Date(txn.status_updated).toLocaleDateString();
      list.appendChild(li);
    });
  }

  function renderLeagueInfoRaw() {
    var el = byId("league-info-raw");
    if (!el) return;
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
      statusEl.textContent = "Building snapshot… this may take a moment.";
      try {
        var snapshot = await SleeperAPI.buildSeasonSnapshot(state.leagueId);
        SleeperAPI.downloadJSON(
          snapshot,
          "league_season_" + state.season + "_snapshot.json"
        );
        statusEl.textContent =
          "Snapshot downloaded at " + new Date().toLocaleTimeString() + ".";
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
    setupFreezeButton();

    var urlSeason = getSeasonFromURL();
    var defaultSeason =
      urlSeason && SleeperAPI.SLEEPER_SEASONS[urlSeason]
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
