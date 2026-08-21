/**
 * season.js
 * Drives index.html. One page works for every Sleeper season —
 * pick a season from the dropdown, or load with ?season=2026 in the URL.
 * The season listed as SleeperAPI.CURRENT_LIVE_SEASON auto-refreshes.
 *
 * NOTE: This version intentionally avoids destructuring names out of
 * window.SleeperAPI into top-level const/let variables. Some browsers
 * throw "Can't create duplicate variable that shadows a global property"
 * if a top-level const/let collides with an existing global. Calling
 * everything through the SleeperAPI namespace directly avoids that
 * failure mode entirely.
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

      state.league = league;
      state.users = users;
      state.rosters = rosters;
      state.rosterMap = SleeperAPI.buildRosterMap(users, rosters);
      state.currentWeek = await SleeperAPI.getDefaultWeek(league);

      renderStandings();
      await populateWeekSelects();
      await renderMatchups();
      renderTeams();
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

  function renderStandings() {
    var tbody = document.querySelector("#standings-table tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    var standings = SleeperAPI.sortStandings(state.rosterMap);
    standings.forEach(function (team, idx) {
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + (idx + 1) + "</td>" +
        "<td>" + escapeHtml(team.teamName) + "</td>" +
        "<td>" + escapeHtml(team.displayName) + "</td>" +
        "<td>" + team.wins + "</td>" +
        "<td>" + team.losses + "</td>" +
        "<td>" + team.ties + "</td>" +
        "<td>" + team.fpts.toFixed(2) + "</td>" +
        "<td>" + team.fptsAgainst.toFixed(2) + "</td>";
      tbody.appendChild(tr);
    });
  }

  async function populateWeekSelects() {
    var weekSelect = byId("week-select");
    var txnWeekSelect = byId("txn-week-select");
    if (!weekSelect || !txnWeekSelect) return;

    weekSelect.innerHTML = "";
    txnWeekSelect.innerHTML = "";

    for (var w = 1; w <= 18; w++) {
      var opt1 = document.createElement("option");
      opt1.value = String(w);
      opt1.textContent = "Week " + w;
      weekSelect.appendChild(opt1);

      var opt2 = document.createElement("option");
      opt2.value = String(w);
      opt2.textContent = "Week " + w;
      txnWeekSelect.appendChild(opt2);
    }
    weekSelect.value = String(state.currentWeek);
    txnWeekSelect.value = String(state.currentWeek);

    weekSelect.onchange = renderMatchups;
    txnWeekSelect.onchange = renderTransactions;
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
      board.innerHTML = "";
      picks
        .sort(function (a, b) {
          return a.pick_no - b.pick_no;
        })
        .forEach(function (pick) {
          var div = document.createElement("div");
          div.className = "draft-pick";
          var meta = pick.metadata || {};
          div.innerHTML =
            '<div class="pick-num">Pick ' + pick.pick_no + " (R" + pick.round + ')</div>' +
            "<div>" + escapeHtml((meta.first_name || "") + " " + (meta.last_name || "")) + "</div>" +
            "<div>" + escapeHtml((meta.position || "") + " " + (meta.team || "")) + "</div>";
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
