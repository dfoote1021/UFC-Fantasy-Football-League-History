/**
 * season.js
 * Drives index.html. One page works for every season, Sleeper (2022+) or
 * ESPN (2012-2021). Pick a season from the dropdown, or load with
 * ?season=YYYY in the URL. The season listed as SleeperAPI.CURRENT_LIVE_SEASON
 * auto-refreshes; ESPN years are static historical data loaded from CSV.
 *
 * Also drives the "All-Time" view (career totals + head-to-head +
 * owner-vs-the-field + league records across every season), toggled via
 * the dedicated All-Time button - see showAllTimeView()/hideAllTimeView()
 * near the bottom of this file. Career totals, head-to-head, and vs-field
 * all split regular-season from playoff (active-championship-path-only)
 * results, and exclude consolation/toilet-bowl/placement/post-elimination
 * games from every total - see all-time.js for how that three-way
 * classification is computed per-game. The All-Time Records tab and the
 * per-season Records tab both show a league-wide master leaderboard and
 * per-member personal bests/worsts for six "fun stats", each computed
 * separately for regular season vs playoffs (never blended); the
 * per-season version scopes those same six stats to just the currently
 * selected season via SleeperAPI/AllTimeStats' buildSeasonMasterRecords()/
 * buildSeasonMemberRecords().
 *
 * All point totals/scores throughout this file (standings, matchups,
 * rosters, brackets, and every All-Time view) are displayed with
 * .toFixed(2) to match the league's actual scoring system.
 *
 * NOTE: this league never uses week 18 for any Sleeper season - see
 * SleeperAPI.MAX_SLEEPER_WEEK in sleeper-common.js for the hard cutoff
 * applied at the data-fetching layer.
 *
 * STALE-DATA GUARD: state.loadToken is bumped every time loadSeason() is
 * called. loadSleeperSeason()/loadEspnSeason() receive that token and
 * check it still matches state.loadToken before writing to `state` or
 * rendering anything, at every await boundary. This prevents a slow/late
 * response from a previously-selected season from landing after a newer
 * one and silently overwriting state.rosterMap / state.espnDraftData with
 * the wrong year's teams (e.g. rapid season switching or hitting Refresh
 * while a fetch is still in flight).
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

    // ESPN-specific cached data.
    espnSeasonData: null,
    espnDraftData: null,
    espnRosterData: null,

    // Sleeper-specific cached data.
    sleeperRunningRecordsByWeek: null,
    sleeperPlayedWeeks: null,
    sleeperDraftBoardData: null,

    // All-Time view state.
    allTimeData: null,
    careerSplit: "combined",
    careerSort: "championships",
    recordsView: "master",
    recordsSplit: "regular",

    // Incremented for every season load so slow prior requests cannot
    // overwrite data after the user has selected another season.
    loadToken: 0,
  };

  // Season Records tab state (separate from the All-Time Records tab's
  // state.recordsView/state.recordsSplit above) - scoped to whichever
  // season is currently loaded.
  var seasonRecordsView = "master";
  var seasonRecordsSplit = "regular";
  var seasonAllTimeDataForRecords = null;

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
    var allYears = sleeperYears.concat(espnYears).sort(function (a, b) { return b - a; });
    allYears.forEach(function (year) {
      var opt = document.createElement("option");
      opt.value = year;
      opt.textContent = year + (isEspnYear(year) ? " (ESPN)" : "");
      select.appendChild(opt);
    });
  }

  function setupTabs() {
    var tabBtns = document.querySelectorAll("#season-tabs .tab-btn");
    tabBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll("#season-tabs .tab-btn").forEach(function (b) {
          b.classList.remove("active");
        });
        document.querySelectorAll("#season-main .tab-panel").forEach(function (p) {
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
    var main = document.querySelector("#season-main");
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
    var main = document.querySelector("#season-main");
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
    state.espnDraftData = null;
    state.espnRosterData = null;
    state.sleeperRunningRecordsByWeek = null;
    state.sleeperPlayedWeeks = null;

    state.loadToken += 1;
    var myToken = state.loadToken;

    var badge = byId("season-badge");
    if (badge) badge.textContent = season;

    if (isEspnYear(season)) {
      return loadEspnSeason(season, myToken);
    }
    return loadSleeperSeason(season, myToken);
  }

  async function loadSleeperSeason(season, myToken) {
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

      if (myToken !== state.loadToken) return;

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
      state.sleeperPlayedWeeks = SleeperAPI.getPlayedWeeks(state.allWeeksMatchups);
      state.sleeperRunningRecordsByWeek = SleeperAPI.buildAllRunningRecords(
        state.allWeeksMatchups,
        state.playoffStartWeek
      );
      if (state.sleeperPlayedWeeks.length > 0) {
        var latestPlayedWeek = state.sleeperPlayedWeeks[state.sleeperPlayedWeeks.length - 1];
        if (state.currentWeek > latestPlayedWeek) {
          state.currentWeek = latestPlayedWeek;
        }
      }

      if (myToken !== state.loadToken) return;

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
      await populateSeasonRecordsMemberSelector();
      renderSeasonRecords();

      if (myToken !== state.loadToken) return;

      byId("last-refreshed").textContent =
        "Updated " + new Date().toLocaleTimeString();

      if (isLive) {
        state.refreshTimer = setInterval(function () {
          loadSeason(season);
        }, 60000);
      }
    } catch (err) {
      if (myToken !== state.loadToken) return;
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

  async function loadEspnSeason(season, myToken) {
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

      // Stale-response guard: if the user has since switched seasons while
      // this fetch/parse was in flight, drop this result entirely instead
      // of overwriting the season currently on screen.
      if (myToken !== state.loadToken) return;

      state.espnSeasonData = data;
      state.rosterMap = data.rosterMap;
      state.seedMap = data.seedMap;
      state.winnersBracket = data.winnersBracket;
      state.losersBracket = data.consolationBracket;
      state.finalStandingsInfo = data.finalStandingsInfo;
      state.currentWeek = data.weeks.length ? data.weeks[0] : 1;

      showInfoBanner(
        "This is a historical ESPN season loaded from local data. " +
          "Weekly rosters and detailed per-move transaction history are " +
          "not available for ESPN-era seasons; the Teams tab shows total " +
          "move counts when that data has been added."
      );

      renderChampionBanner();
      renderStandings();
      renderDivisionStandingsEspn(data.divisionStandings);
      renderBracket("playoff-bracket", state.winnersBracket);
      renderBracket("consolation-bracket", state.losersBracket);

      await populateWeekSelectsEspn(data.weeks);
      renderMatchupsEspn();
      renderTeamsEspn();

      // ESPN has end-of-season roster snapshots rather than weekly data.
      // This fills the Team dropdown, hides Week, and renders the roster.
      await renderWeeklyRoster();

      await populateScheduleTeamSelectEspn();
      renderTeamScheduleEspn();
      await renderDraftEspn(season, myToken);
      renderTransactionsUnavailable();
      renderLeagueInfoRawEspn(season);
      await populateSeasonRecordsMemberSelector();
      renderSeasonRecords();

      if (myToken !== state.loadToken) return;

      byId("last-refreshed").textContent =
        "Loaded from local ESPN data (" + season + ")";
    } catch (err) {
      if (myToken !== state.loadToken) return;
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
      var totalMovesHtml =
        team.totalMoves !== undefined && team.totalMoves !== null
          ? '<div class="team-stats-row"><span>Total Transactions</span><span>' + team.totalMoves + "</span></div>"
          : '<div class="team-stats-row"><span>Total Transactions</span><span>Not available</span></div>';
      card.innerHTML =
        "<div><strong>" + escapeHtml(team.teamName) + "</strong></div>" +
        "<p>" + escapeHtml(team.displayName) + "</p>" +
        '<div class="team-stats-row"><span>Record</span><span>' + team.wins + "-" + team.losses + "-" + team.ties + "</span></div>" +
        '<div class="team-stats-row"><span>Points For</span><span>' + team.fpts.toFixed(2) + "</span></div>" +
        '<div class="team-stats-row"><span>Points Against</span><span>' + team.fptsAgainst.toFixed(2) + "</span></div>" +
        totalMovesHtml;
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

  /* ============================================================
   * INSERT THE FOLLOWING TWO FUNCTIONS HERE
   * ============================================================ */

  function setRosterWeekSelectorVisible(isVisible) {
    var weekSelect = byId("roster-week-select");
    if (!weekSelect) return;

    var wrapper =
      weekSelect.closest(".week-picker") ||
      weekSelect.closest(".select-wrap") ||
      weekSelect.parentElement;

    if (wrapper) {
      wrapper.hidden = !isVisible;
    } else {
      weekSelect.hidden = !isVisible;
    }
  }

  async function renderFinalRosterEspn() {
    var teamSelect = byId("roster-team-select");
    var totalEl = byId("roster-total");
    var tbody = document.querySelector("#roster-table tbody");

    if (!tbody) return;

    // ESPN has one end-of-season roster snapshot, not weekly roster data.
    setRosterWeekSelectorVisible(false);

    if (!window.EspnRosterLoader) {
      tbody.innerHTML =
        '<tr><td colspan="5">Roster data not available (espn-roster-loader.js not loaded).</td></tr>';

      if (totalEl) totalEl.textContent = "";
      return;
    }

    tbody.innerHTML = '<tr><td colspan="5">Loading…</td></tr>';

    if (totalEl) {
      totalEl.textContent = "";
    }

    try {
      var data = await window.EspnRosterLoader.loadSeasonRoster(state.season);

      // Optional cache. This requires the earlier state-object addition:
      // espnRosterData: null,
      state.espnRosterData = data;

      if (teamSelect) {
        var previousValue = teamSelect.value;
        teamSelect.innerHTML = "";

        (data.teams || []).forEach(function (team) {
          var opt = document.createElement("option");

          // Owner is used as the selection key because it should be
          // stable across this single season's end-of-season roster CSV.
          opt.value = team.owner;

          opt.textContent =
            team.teamName !== team.owner
              ? team.teamName + " (" + team.owner + ")"
              : team.owner;

          teamSelect.appendChild(opt);
        });

        var priorTeamExists = (data.teams || []).some(function (team) {
          return team.owner === previousValue;
        });

        teamSelect.value = priorTeamExists
          ? previousValue
          : (data.teams && data.teams[0] ? data.teams[0].owner : "");

        teamSelect.onchange = renderFinalRosterEspn;
      }

      var selectedOwner = teamSelect
        ? teamSelect.value
        : (data.teams && data.teams[0] ? data.teams[0].owner : "");

      var selectedTeam = (data.teams || []).find(function (team) {
        return team.owner === selectedOwner;
      });

      if (
        !selectedTeam ||
        !selectedTeam.players ||
        selectedTeam.players.length === 0
      ) {
        tbody.innerHTML =
          '<tr><td colspan="5">No final roster data for this team.</td></tr>';
        return;
      }

      if (totalEl) {
        totalEl.innerHTML =
          escapeHtml(selectedTeam.teamName) +
          " — Final Roster (" +
          state.season +
          ")";
      }

      tbody.innerHTML = "";

      selectedTeam.players.forEach(function (player) {
        var tr = document.createElement("tr");

        tr.className = player.isStarter
          ? "starter-row"
          : "bench-row";

         var slotLabel = player.slot || "Final Roster";

        var keeperSuffix = player.isKeeper
          ? " (Keeper)"
          : "";

        tr.innerHTML =
          "<td>" + escapeHtml(slotLabel) + "</td>" +
          "<td>" + escapeHtml(player.playerName) + keeperSuffix + "</td>" +
          "<td>" + escapeHtml(player.position || "-") + "</td>" +
          "<td>" + escapeHtml(player.nflTeam || "-") + "</td>" +
          "<td>-</td>";

        tbody.appendChild(tr);
      });
    } catch (error) {
      console.error("Could not load ESPN final roster data:", error);

      tbody.innerHTML =
        '<tr><td colspan="5">Final roster data unavailable for this season.</td></tr>';
    }
  }

  /* ============================================================
   * YOUR EXISTING ESPN DRAFT FUNCTION CONTINUES HERE
   * ============================================================ */

  /**
   * ESPN draft tab entry point. Fetches this season's draft picks...
   */
  async function renderDraftEspn(season, myToken) {
    // your existing code remains unchanged
  }
  /**
   * ESPN draft tab entry point. Fetches this season's draft picks, then
   * populates the #draft-team-filter dropdown and renders the board
   * filtered to whatever is currently selected (defaults to "All Teams").
   * myToken is optional (renderDraft() calls this without one when
   * invoked outside the main load flow); when provided, a stale response
   * from a since-abandoned season load is dropped instead of corrupting
   * state.espnDraftData.
   */
  async function renderDraftEspn(season, myToken) {
    var board = byId("draft-board");
    if (!board) return;

    if (!window.EspnDraftLoader) {
      board.innerHTML = "<p>Draft board data not available (espn-draft-loader.js not loaded).</p>";
      return;
    }

    board.innerHTML = "<p>Loading draft board&hellip;</p>";

    try {
      var draftData = await window.EspnDraftLoader.loadDraft(season);

      if (myToken !== undefined && myToken !== state.loadToken) return;

      state.espnDraftData = draftData;

      if (!draftData.picks || draftData.picks.length === 0) {
        board.innerHTML = "<p>No draft data found for " + season + ".</p>";
        var breakdownEmpty = byId("draft-breakdown");
        if (breakdownEmpty) breakdownEmpty.innerHTML = "";
        var filterEmpty = byId("draft-team-filter");
        if (filterEmpty) filterEmpty.innerHTML = '<option value="">All Teams</option>';
        return;
      }

      populateDraftTeamFilterEspn(draftData.picks);
      renderDraftBoardFilteredEspn();
    } catch (e) {
      console.error(e);
      board.innerHTML = "<p>Draft board data unavailable for this season.</p>";
    }
  }

  /**
   * Populates the #draft-team-filter dropdown for ESPN seasons using the
   * team/owner names carried directly on each draft-pick row (no
   * rosterMap join needed - see espn-draft-loader.js). Resets to
   * "All Teams" whenever the previously-selected team doesn't exist in
   * the newly-loaded season (e.g. switching years).
   */
  function populateDraftTeamFilterEspn(picks) {
    var select = byId("draft-team-filter");
    if (!select) return;

    var previousValue = select.value;

    var seen = {};
    var teams = [];
    picks.forEach(function (pick) {
      if (!pick.team || seen[pick.team]) return;
      seen[pick.team] = true;
      teams.push({ team: pick.team, owner: pick.owner });
    });
    teams.sort(function (a, b) {
      return a.team.localeCompare(b.team);
    });

    select.innerHTML = '<option value="">All Teams</option>';
    teams.forEach(function (t) {
      var opt = document.createElement("option");
      opt.value = t.team;
      opt.textContent = t.owner ? t.team + " (" + t.owner + ")" : t.team;
      select.appendChild(opt);
    });

    select.value = seen[previousValue] ? previousValue : "";
    select.onchange = renderDraftBoardFilteredEspn;
  }
  /**
   * Returns picks grouped by round in snake-display order.
   *
   * Odd-numbered rounds render left-to-right in ascending pick order.
   * Even-numbered rounds render left-to-right in descending pick order,
   * so the board visually reads as a conventional snake draft.
   *
   * The original pick objects are not changed. Only their display order
   * changes, so Pick # and round labels stay historically accurate.
   */
  function getSnakeDisplayPicks(picks, getRound, getPickNumber) {
    var byRound = {};

    (picks || []).forEach(function (pick) {
      var round = Number(getRound(pick)) || 0;
      if (!byRound[round]) {
        byRound[round] = [];
      }
      byRound[round].push(pick);
    });

    return Object.keys(byRound)
      .map(Number)
      .sort(function (a, b) {
        return a - b;
      })
      .reduce(function (result, round) {
        var roundPicks = byRound[round].slice().sort(function (a, b) {
          return Number(getPickNumber(a)) - Number(getPickNumber(b));
        });

        // Reverse even-numbered rounds for visual snake-board order.
        if (round % 2 === 0) {
          roundPicks.reverse();
        }

        return result.concat(roundPicks);
      }, []);
  }
    function getSnakeArrow(round, pickWithinRound, teamCount, isFinalPick) {
    var roundNumber = Number(round) || 0;
    var roundPickNumber = Number(pickWithinRound) || 0;
    var totalTeams = Number(teamCount) || 12;

    if (isFinalPick) {
      return "";
    }

    // Your requested exception: R16.12 has no arrow.
    if (roundNumber === 16 && roundPickNumber === totalTeams) {
      return "";
    }

    // Every .12 pick gets a down arrow.
    if (roundPickNumber === totalTeams) {
      return "↓";
    }

    // All other picks point horizontally by round direction.
    return roundNumber % 2 === 0 ? "←" : "→";
  }

  function getSnakeArrowText(arrow) {
    if (arrow === "→") return "Next pick to the right";
    if (arrow === "←") return "Next pick to the left";
    if (arrow === "↓") return "Next round";
    return "";
  }
    /**
   * Gets a visual arrow for a pick card in a snake draft.
   *
   * For 12-team draft boards:
   * - Pick .12 in each non-final round gets ↓.
   * - Odd rounds otherwise use →.
   * - Even rounds otherwise use ←.
   * - The final overall pick gets no arrow.
   */
    /**
   * Gets the arrow for a visual snake-draft card.
   *
   * `isVisualLastPickInRound` is based on the already snake-ordered
   * displayed row. Therefore:
   *
   * - Odd rounds: R#.12 is visually last and gets ↓.
   * - Even rounds: R#.1 is visually last and gets ↓.
   * - The true final card in the complete draft gets no arrow.
   */
  
   /**
   * Renders the ESPN draft board filtered to the currently selected team
   * (or all teams), plus the By Position / By NFL Team breakdown for
   * whichever picks are currently visible.
   *
   * The board is displayed in snake order:
   * - Odd rounds: left to right, ascending pick number.
   * - Even rounds: right to left, descending pick number.
   *
   * Actual historical pick labels are unchanged.
   */
  
    function renderDraftBoardFilteredEspn() {
    var board = byId("draft-board");
    if (!board || !state.espnDraftData) return;

    var filterSelect = byId("draft-team-filter");
    var selectedTeam = filterSelect ? filterSelect.value : "";

    var picks = state.espnDraftData.picks.filter(function (pick) {
      return !selectedTeam || pick.team === selectedTeam;
    });

    renderDraftBreakdownHtml(picks, "draft-breakdown");

    if (picks.length === 0) {
      board.innerHTML = "<p>No picks found for this team.</p>";
      return;
    }

    var picksByRound = {};

    picks.forEach(function (pick) {
      var round = Number(pick.round) || 0;

      if (!picksByRound[round]) {
        picksByRound[round] = [];
      }

      picksByRound[round].push(pick);
    });

    var snakePicks = [];

    Object.keys(picksByRound)
      .map(Number)
      .sort(function (a, b) {
        return a - b;
      })
      .forEach(function (round) {
        var roundPicks = picksByRound[round].slice();

        roundPicks.sort(function (a, b) {
          return Number(a.overallPick) - Number(b.overallPick);
        });

        if (round % 2 === 0) {
          roundPicks.reverse();
        }

        snakePicks = snakePicks.concat(roundPicks);
      });

    board.innerHTML = "";

    snakePicks.forEach(function (pick, snakeIndex) {
      var div = document.createElement("div");
      div.className =
        "draft-pick draft-pick-snake" +
        (pick.isKeeper ? " is-keeper-pick" : "");

            var round = Number(pick.round) || 0;

      /*
       * Use the pick's actual position within its round (1-12), not its
       * visual position in the reversed-for-display even rounds.
       */
      var pickWithinRound = Number(pick.roundPick) || 0;

      /*
       * Arrows are only meaningful on the complete board. When a team is
       * selected, other teams' intervening picks are hidden, so suppress
       * the path indicators entirely.
       */
      var directionArrow = selectedTeam
        ? ""
        : getSnakeArrow(
            round,
            pickWithinRound,
            12,
            snakeIndex === snakePicks.length - 1
          );

      var directionText = getSnakeArrowText(directionArrow);

      var arrowHtml = directionArrow
        ? '<div class="draft-direction" title="' +
          directionText +
          '" aria-label="' +
          directionText +
          '">' +
          directionArrow +
          "</div>"
        : "";

      var teamLabel = pick.owner
        ? escapeHtml(pick.team) + " (" + escapeHtml(pick.owner) + ")"
        : escapeHtml(pick.team);

      var metaLine =
        (pick.position ? escapeHtml(pick.position) : "") +
        (pick.position && pick.nflTeam ? " - " : "") +
        (pick.nflTeam ? escapeHtml(pick.nflTeam) : "");

      var keeperTag = "";

      div.innerHTML =
        '<div class="pick-num">Pick ' +
        pick.overallPick +
        " (R" +
        pick.round +
        "." +
        pick.roundPick +
        ")</div>" +
        arrowHtml +
        "<div>" +
        escapeHtml(pick.playerName) +
        "</div>" +
        (metaLine
          ? '<div class="draft-meta">' + metaLine + "</div>"
          : "") +
        '<div class="draft-owner">' +
        teamLabel +
        "</div>" +
        keeperTag;

      board.appendChild(div);
    });
  }
  function renderTransactionsUnavailable() {
    var list = byId("transactions-list");
    if (list) {
      list.innerHTML =
        "<li>Detailed per-move transaction history is not available for ESPN seasons. " +
        "Total transaction counts, if available, show on the Teams tab for each team.</li>";
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
        draftPicksLoaded: state.espnDraftData ? state.espnDraftData.picks.length : 0,
      },
      null,
      2
    );
  }

  /**
   * Sleeper draft tab entry point. Delegates to renderDraftEspn() for
   * ESPN seasons; otherwise fetches the Sleeper draft, populates the
   * #draft-team-filter dropdown, and renders the board filtered to
   * whatever is currently selected.
   */
  async function renderDraft() {
    if (state.dataSource === "espn") {
      await renderDraftEspn(state.season);
      return;
    }
    var board = byId("draft-board");
    if (!board) return;
    board.innerHTML = "<p>Loading&hellip;</p>";
    try {
      var draft = await SleeperAPI.getDraft(state.leagueId);
      if (!draft) {
        board.innerHTML = "<p>No draft found for this season.</p>";
        return;
      }
      var picks = await SleeperAPI.getDraftPicks(draft.draft_id);
      var boardData = SleeperAPI.buildDraftBoard(picks, state.rosterMap);
      state.sleeperDraftBoardData = boardData;
      populateDraftTeamFilter(boardData);
      renderDraftBoardFiltered();
    } catch (e) {
      console.error(e);
      board.innerHTML = "<p>Draft data unavailable.</p>";
    }
  }

  /**
   * Populates the #draft-team-filter dropdown for Sleeper seasons.
   */
  function populateDraftTeamFilter(boardData) {
    var select = byId("draft-team-filter");
    if (!select) return;

    var previousValue = select.value;

    var seen = {};
    var teams = [];
    boardData.forEach(function (pick) {
      var key = String(pick.rosterId);
      if (seen[key]) return;
      seen[key] = true;
      teams.push({ rosterId: pick.rosterId, teamName: pick.teamName, ownerName: pick.ownerName });
    });
    teams.sort(function (a, b) {
      return a.teamName.localeCompare(b.teamName);
    });

    select.innerHTML = '<option value="">All Teams</option>';
    teams.forEach(function (t) {
      var opt = document.createElement("option");
      opt.value = String(t.rosterId);
      opt.textContent =
        t.ownerName && t.ownerName !== t.teamName
          ? t.teamName + " (" + t.ownerName + ")"
          : t.teamName;
      select.appendChild(opt);
    });

    select.value = seen[previousValue] ? previousValue : "";
    select.onchange = renderDraftBoardFiltered;
  }

  /**
   * Renders the Sleeper draft board filtered to the currently-selected
   * team (or all teams), plus the By Position / By NFL Team breakdown.
   */
     function renderDraftBoardFiltered() {
    var board = byId("draft-board");
    if (!board || !state.sleeperDraftBoardData) return;

    var filterSelect = byId("draft-team-filter");
    var selectedRosterId = filterSelect ? filterSelect.value : "";

    var picks = state.sleeperDraftBoardData.filter(function (pick) {
      return !selectedRosterId || String(pick.rosterId) === selectedRosterId;
    });

    renderDraftBreakdownHtml(picks, "draft-breakdown");

    if (picks.length === 0) {
      board.innerHTML = "<p>No picks found for this team.</p>";
      return;
    }

    var teamCount = Object.keys(
      state.sleeperDraftBoardData.reduce(function (acc, pick) {
        acc[pick.rosterId] = true;
        return acc;
      }, {})
    ).length || 12;

    var picksByRound = {};

    picks.forEach(function (pick) {
      var round = Number(pick.round) || 0;

      if (!picksByRound[round]) {
        picksByRound[round] = [];
      }

      picksByRound[round].push(pick);
    });

    var snakePicks = [];

    Object.keys(picksByRound)
      .map(Number)
      .sort(function (a, b) {
        return a - b;
      })
      .forEach(function (round) {
        var roundPicks = picksByRound[round].slice();

        roundPicks.sort(function (a, b) {
          return Number(a.pickNo) - Number(b.pickNo);
        });

        if (round % 2 === 0) {
          roundPicks.reverse();
        }

        snakePicks = snakePicks.concat(roundPicks);
      });

    board.innerHTML = "";

    snakePicks.forEach(function (pick, snakeIndex) {
      var div = document.createElement("div");
      div.className =
        "draft-pick draft-pick-snake" +
        (pick.isKeeper ? " is-keeper-pick" : "");

     var round = Number(pick.round) || 0;

/*
 * Calculate the actual pick number inside the round.
 * Example in a 12-team league:
 * Pick 24 in Round 2 becomes R2.12.
 */
var pickWithinRound =
  Number(pick.pickNo) - (round - 1) * teamCount;

/*
 * Hide arrows for a filtered single-team view because the picks
 * between that team's selections are not shown.
 */
var directionArrow = selectedRosterId
  ? ""
  : getSnakeArrow(
      round,
      pickWithinRound,
      teamCount,
      snakeIndex === snakePicks.length - 1
    );

      var directionText = getSnakeArrowText(directionArrow);

      var arrowHtml = directionArrow
        ? '<div class="draft-direction" title="' +
          directionText +
          '" aria-label="' +
          directionText +
          '">' +
          directionArrow +
          "</div>"
        : "";

      var teamLabel =
        pick.ownerName && pick.ownerName !== pick.teamName
          ? escapeHtml(pick.teamName) +
            " (" +
            escapeHtml(pick.ownerName) +
            ")"
          : escapeHtml(pick.teamName);

      var metaLine = pick.position
        ? escapeHtml(pick.position) +
          (pick.position && pick.nflTeam ? " - " : "") +
          (pick.nflTeam ? escapeHtml(pick.nflTeam) : "")
        : "";

      var keeperTag = "";

      var pickLabel =
        "Pick " +
        pick.pickNo +
        " (R" +
        pick.round +
        (pickWithinRound ? "." + pickWithinRound : "") +
        ")";

      div.innerHTML =
        '<div class="pick-num">' +
        pickLabel +
        "</div>" +
        arrowHtml +
        "<div>" +
        escapeHtml(pick.playerName) +
        "</div>" +
        (metaLine
          ? '<div class="draft-meta">' + metaLine + "</div>"
          : "") +
        '<div class="draft-owner">' +
        teamLabel +
        "</div>" +
        keeperTag;

      board.appendChild(div);
    });
  }
  /**
   * Shared breakdown renderer used by both the Sleeper and ESPN draft
   * tabs: groups whichever `picks` array is currently visible by
   * position and by NFL team, and renders each group as a small stat
   * card (matching the site's existing .h2h-stat-card visual language)
   * inside the given container id.
   */
  function renderDraftBreakdownHtml(picks, containerId) {
    var container = byId(containerId);
    if (!container) return;

    if (!picks || picks.length === 0) {
      container.innerHTML = "";
      return;
    }

    function countBy(getKey) {
      var counts = {};
      picks.forEach(function (pick) {
        var key = getKey(pick) || "Unknown";
        counts[key] = (counts[key] || 0) + 1;
      });
      return Object.keys(counts)
        .map(function (key) {
          return { key: key, count: counts[key] };
        })
        .sort(function (a, b) {
          return b.count - a.count;
        });
    }

    function cardsHtml(entries) {
      return entries
        .map(function (e) {
          return (
            '<div class="breakdown-card">' +
            '<div class="breakdown-card-value">' + e.count + "</div>" +
            '<div class="breakdown-card-label">' + escapeHtml(e.key) + "</div>" +
            "</div>"
          );
        })
        .join("");
    }

    var byPosition = countBy(function (p) {
      return p.position;
    });
    var byNflTeam = countBy(function (p) {
      return p.nflTeam;
    });

    container.innerHTML =
      '<h3 class="playoff-heading">By Position</h3>' +
      '<div class="breakdown-grid">' + cardsHtml(byPosition) + "</div>" +
      '<h3 class="playoff-heading">By NFL Team</h3>' +
      '<div class="breakdown-grid">' + cardsHtml(byNflTeam) + "</div>";
  }

  async function ensureAllWeeksMatchups() {
    if (state.dataSource !== "sleeper") return null;
    if (state.allWeeksMatchups) return state.allWeeksMatchups;
    state.allWeeksMatchups = await SleeperAPI.getAllWeeksMatchups(
      state.leagueId,
      SleeperAPI.MAX_SLEEPER_WEEK
    );
    return state.allWeeksMatchups;
  }

  async function ensureAllTransactions() {
    if (state.dataSource !== "sleeper") return [];
    if (state.allTransactionsFlat) return state.allTransactionsFlat;
    var maxWeek = SleeperAPI.MAX_SLEEPER_WEEK || 17;
    var weeks = [];
    for (var w = 1; w <= maxWeek; w++) weeks.push(w);
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
    if (state.dataSource === "espn") return;

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
          var tag = isChamp ? " \ud83c\udfc6" : isRunnerUp ? " \ud83e\udd48" : "";
          return (
            "<tr><td>" + (idx + 1) + "</td><td>" + escapeHtml(team.teamName) + tag +
            "</td><td>" + team.wins + "-" + team.losses + "-" + team.ties +
            "</td><td>" + team.fpts.toFixed(2) + "</td></tr>"
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

    // Only the winners/playoff bracket gets "Championship" and
    // "Nth Place Game" placement labels. The consolation bracket (losers
    // bracket / toilet bowl) never had a real championship or placement
    // structure in this league, so it only ever shows plain "Round N"
    // titles - for both Sleeper AND ESPN seasons.
    var isPlayoffBracket = containerId === "playoff-bracket";

    container.innerHTML = "";
    var matchCounter = 0;
    var totalRounds = rounds.length;

    rounds.forEach(function (roundData, roundIndex) {
      var roundDiv = document.createElement("div");
      roundDiv.className = "bracket-round";
      var roundTitle = document.createElement("h4");
      roundTitle.textContent = bracketRoundLabel(containerId, roundIndex, totalRounds);
      roundDiv.appendChild(roundTitle);

      roundData.matches.forEach(function (m) {
        matchCounter++;
        var matchDiv = document.createElement("div");
        matchDiv.className = "bracket-match";

        // Render first-round byes (see SleeperAPI.buildBracketView) as a
        // single-team bye card instead of a normal two-slot matchup.
        if (m.isBye) {
          matchDiv.classList.add("bye-match");
          var byeSlot = m.slot1;
          var byeSeedHtml = byeSlot.seed ? '<span class="seed">#' + byeSlot.seed + "</span>" : "";
          var byeScoreHtml =
            m.slot1Score !== null && m.slot1Score !== undefined
              ? '<span class="score">' + m.slot1Score.toFixed(2) + "</span>"
              : "";
          var byeSlotDiv = document.createElement("div");
          byeSlotDiv.className = "bracket-slot bye-slot";
          byeSlotDiv.innerHTML =
            "<span>" + byeSeedHtml + escapeHtml(bracketSlotLabel(byeSlot)) + "</span>" + byeScoreHtml;
          matchDiv.appendChild(byeSlotDiv);

          var byeTagDiv = document.createElement("div");
          byeTagDiv.className = "bracket-slot bye-tag-row";
          byeTagDiv.textContent = "BYE";
          matchDiv.appendChild(byeTagDiv);

          roundDiv.appendChild(matchDiv);
          return;
        }

        // buildBracketView exposes the placement as `position` (from
        // Sleeper's p field); fall back to other names just in case.
        // Placement labels ("Championship", "3rd Place Game", etc.) only
        // apply to the playoff/winners bracket - the consolation bracket
        // skips this block entirely and keeps its plain "Round N" title.
        if (isPlayoffBracket) {
          var placement = Number(m.position || m.placement || m.p || 0);
          if (placement > 1) {
            var placementLabel = document.createElement("div");
            placementLabel.className = "bracket-placement-label";
            placementLabel.textContent = ordinal(placement) + " Place Game";
            matchDiv.appendChild(placementLabel);
          } else if (placement === 1) {
            var championshipLabel = document.createElement("div");
            championshipLabel.className = "bracket-placement-label";
            championshipLabel.textContent = "Championship";
            matchDiv.appendChild(championshipLabel);
          }
        }

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
              ? '<span class="score">' + entry.score.toFixed(2) + "</span>"
              : "";
          slotDiv.innerHTML =
            "<span>" + seedHtml + escapeHtml(bracketSlotLabel(slot)) + "</span>" + scoreHtml;
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
              escapeHtml((r1 && state.rosterMap[r1]) ? state.rosterMap[r1].teamName : "Team 1") +
              "</h5>" +
              rosterListHtml(side1) +
              "</div>" +
              '<div class="matchup-roster-col"><h5>' +
              escapeHtml((r2 && state.rosterMap[r2]) ? state.rosterMap[r2].teamName : "Team 2") +
              "</h5>" +
              rosterListHtml(side2) +
              "</div>";
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
        var pts = p.points !== null ? p.points.toFixed(2) : "-";
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

    var playedWeeks =
      state.sleeperPlayedWeeks && state.sleeperPlayedWeeks.length
        ? state.sleeperPlayedWeeks
        : [state.currentWeek || 1];

    playedWeeks.forEach(function (w) {
      [weekSelect, rosterWeekSelect].forEach(function (sel) {
        var opt = document.createElement("option");
        opt.value = String(w);
        opt.textContent = "Week " + w;
        sel.appendChild(opt);
      });
    });

    var maxWeek = SleeperAPI.MAX_SLEEPER_WEEK || 17;
    for (var w = 1; w <= maxWeek; w++) {
      var opt = document.createElement("option");
      opt.value = String(w);
      opt.textContent = "Week " + w;
      txnWeekSelect.appendChild(opt);
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

    var recordsThisWeek =
      (state.sleeperRunningRecordsByWeek && state.sleeperRunningRecordsByWeek[week]) || {};

    var pairs = SleeperAPI.pairMatchups(matchups, state.rosterMap);

    // Determine which rosters are in a GENUINE two-team matchup: group the
    // raw weekly response by matchup_id (ignoring null ids) and keep only
    // groups with exactly two members. Sleeper gives every roster a row
    // each week, including teams on a bye — those get matchup_id === null
    // (or a single-member group). Everyone not in a genuine two-team
    // matchup is a bye and gets its own BYE card below. Byes are
    // display-only: they never count as games, wins/losses, PF/PA, records,
    // or All-Time stats.
    var groups = {};
    (matchups || []).forEach(function (m) {
      if (m.matchup_id === null || m.matchup_id === undefined) return;
      if (!groups[m.matchup_id]) groups[m.matchup_id] = [];
      groups[m.matchup_id].push(m);
    });
    var pairedRosterIds = {};
    Object.keys(groups).forEach(function (key) {
      var rows = groups[key];
      if (rows.length === 2) {
        if (rows[0].roster_id) pairedRosterIds[rows[0].roster_id] = true;
        if (rows[1].roster_id) pairedRosterIds[rows[1].roster_id] = true;
      }
    });

    list.innerHTML = "";

    // Resolve an owner name from the pair side, falling back to rosterMap
    // (pairMatchups may not always carry displayName through).
    function ownerOf(team) {
      if (!team) return null;
      return team.displayName ||
        (team.rosterId && state.rosterMap[team.rosterId]
          ? state.rosterMap[team.rosterId].displayName
          : null);
    }

    pairs.forEach(function (pair, idx) {
      // Skip byes here so they render once, as a dedicated BYE card, in the
      // bye block below (no duplicates). A pair is a bye if it has no second
      // team OR its matchup_id is null — Sleeper marks bye rosters with
      // matchup_id === null, and pairMatchups would otherwise pair the first
      // two null-id rows together incorrectly.
      if (!pair.teamB || pair.matchupId === null || pair.matchupId === undefined) return;

      var card = document.createElement("div");
      card.className = "matchup-card";
      var aWins = pair.teamA.points > pair.teamB.points;
      var bWins = pair.teamB.points > pair.teamA.points;
      var aLabel = teamWithOwner(pair.teamA.teamName, ownerOf(pair.teamA));
      var bLabel = teamWithOwner(pair.teamB.teamName, ownerOf(pair.teamB));

      var aRecord = recordsThisWeek[pair.teamA.rosterId]
        ? " (" + recordsThisWeek[pair.teamA.rosterId] + ")"
        : "";
      var bRecord = recordsThisWeek[pair.teamB.rosterId]
        ? " (" + recordsThisWeek[pair.teamB.rosterId] + ")"
        : "";

      var rowA =
        '<div class="matchup-row ' + (aWins ? "winner" : "") + '">' +
        "<span>" + escapeHtml(aLabel) + escapeHtml(aRecord) + "</span>" +
        "<span>" + Number(pair.teamA.points || 0).toFixed(2) + "</span></div>";
      var rowB =
        '<div class="matchup-row ' + (bWins ? "winner" : "") + '">' +
        "<span>" + escapeHtml(bLabel) + escapeHtml(bRecord) + "</span>" +
        "<span>" + Number(pair.teamB.points || 0).toFixed(2) + "</span></div>";

      var toggleId = "matchup-rosters-" + idx;
      var toggleHtml =
        '<div class="matchup-toggle"><button class="btn btn-small" data-target="' +
        toggleId + '">Show rosters</button></div>';

      var rosterAHtml = rosterListHtml(pair.teamA);
      var rosterBHtml = rosterListHtml(pair.teamB);

      var rostersHtml =
        '<div class="matchup-rosters" id="' + toggleId + '">' +
        '<div class="matchup-roster-col"><h5>' + escapeHtml(aLabel) + "</h5>" + rosterAHtml + "</div>" +
        '<div class="matchup-roster-col"><h5>' + escapeHtml(bLabel) + "</h5>" + rosterBHtml + "</div>" +
        "</div>";

      card.innerHTML = rowA + rowB + toggleHtml + rostersHtml;
      list.appendChild(card);
    });

    // Bye teams: raw weekly matchup entries that are not part of a two-team
    // pair. Shown as a card with team (owner), that week's points, and a BYE
    // row — matching the ESPN bye-card style.
    var byeEntries = (matchups || []).filter(function (raw) {
      return raw && raw.roster_id && !pairedRosterIds[raw.roster_id];
    });

    byeEntries.sort(function (a, b) {
      var teamA = state.rosterMap[a.roster_id];
      var teamB = state.rosterMap[b.roster_id];
      var nameA = teamA ? teamA.teamName : "";
      var nameB = teamB ? teamB.teamName : "";
      return nameA.localeCompare(nameB);
    });

    byeEntries.forEach(function (raw) {
      var team = state.rosterMap[raw.roster_id];
      if (!team) return;

      var card = document.createElement("div");
      card.className = "matchup-card bye-card";

      var byeLabel = teamWithOwner(team.teamName, team.displayName);
      var byeRecord = recordsThisWeek[raw.roster_id]
        ? " (" + recordsThisWeek[raw.roster_id] + ")"
        : "";
      var byePoints =
        raw.points !== null && raw.points !== undefined
          ? Number(raw.points).toFixed(2)
          : "-";

      card.innerHTML =
        '<div class="matchup-row"><span>' +
        escapeHtml(byeLabel) + escapeHtml(byeRecord) +
        "</span><span>" + byePoints + "</span></div>" +
        '<div class="matchup-row bye-row">BYE</div>';

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

    tbody.innerHTML = '<tr><td colspan="6">Loading…</td></tr>';
    await ensureAllWeeksMatchups();

    if (!state.sleeperRunningRecordsByWeek) {
      state.sleeperRunningRecordsByWeek = SleeperAPI.buildAllRunningRecords(
        state.allWeeksMatchups,
        state.playoffStartWeek
      );
    }

    var schedule = SleeperAPI.buildTeamSchedule(
      state.allWeeksMatchups,
      rosterId,
      state.rosterMap,
      state.sleeperRunningRecordsByWeek,
      state.playoffStartWeek
    );

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
      await renderFinalRosterEspn();
      return;
    }

    setRosterWeekSelectorVisible(true);

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

      var teamsDisplay = detail.teamsWithOwners && detail.teamsWithOwners.length
        ? detail.teamsWithOwners
        : detail.teams;

      var headerHtml =
        '<div class="txn-header"><span>' + escapeHtml(teamsDisplay.join(" ↔ ")) +
        '</span><span class="txn-type-tag">' + escapeHtml(detail.type) + "</span></div>";

      var dateHtml =
        '<div class="txn-detail-row">' + new Date(detail.statusUpdated).toLocaleString() +
        (txn._week ? " — Week " + txn._week : "") + "</div>";

      var addsHtml = detail.adds.length
        ? detail.adds.map(function (a) {
            var teamLabel = a.teamWithOwner || a.team;
            return '<div class="txn-detail-row"><span class="add-tag">+ ADD</span> ' +
              escapeHtml(a.player) + " → " + escapeHtml(teamLabel) + "</div>";
          }).join("")
        : "";

      var dropsHtml = detail.drops.length
        ? detail.drops.map(function (d) {
            var teamLabel = d.teamWithOwner || d.team;
            return '<div class="txn-detail-row"><span class="drop-tag">- DROP</span> ' +
              escapeHtml(d.player) + " from " + escapeHtml(teamLabel) + "</div>";
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

  // Label a team with its owner when the two differ (e.g. "Spencer's Team (Spencer)").
  function teamWithOwner(teamName, ownerName) {
    if (ownerName && teamName && ownerName !== teamName) {
      return teamName + " (" + ownerName + ")";
    }
    return teamName || ownerName || "Unknown";
  }

  // 1 -> "1st", 2 -> "2nd", 3 -> "3rd", 5 -> "5th", 12 -> "12th".
  function ordinal(place) {
    var suffix = "th";
    var lastTwo = place % 100;
    if (lastTwo < 11 || lastTwo > 13) {
      var last = place % 10;
      if (last === 1) suffix = "st";
      else if (last === 2) suffix = "nd";
      else if (last === 3) suffix = "rd";
    }
    return place + suffix;
  }

  // Bracket round title. Reverted to plain "Round N" per request; each
  // match within a round is distinguished by its placement label instead
  // (Championship, 3rd Place Game, 5th Place Game, etc.).
  function bracketRoundLabel(containerId, roundIndex, totalRounds) {
    return "Round " + (roundIndex + 1);
  }

  // Owner-aware label for a bracket slot.
  function bracketSlotLabel(slot) {
    if (!slot) return "TBD";
    var ownerName =
      slot.displayName ||
      slot.ownerName ||
      (slot.rosterId && state.rosterMap[slot.rosterId]
        ? state.rosterMap[slot.rosterId].displayName
        : null);
    if (ownerName && slot.teamName && ownerName !== slot.teamName) {
      return slot.teamName + " (" + ownerName + ")";
    }
    return slot.teamName || "TBD";
  }

  /* ============================================================
   * All-Time view: career totals + head-to-head + owner-vs-field +
   * league records across every season.
   * ============================================================ */

  function showAllTimeView() {
    byId("season-tabs").hidden = true;
    byId("season-main").hidden = true;
    byId("alltime-main").hidden = false;
    byId("season-picker").hidden = true;
    byId("alltime-picker").hidden = false;
    var championBanner = byId("champion-banner");
    if (championBanner) championBanner.hidden = true;
    loadAllTimeData();
  }

  function hideAllTimeView() {
    byId("alltime-main").hidden = true;
    byId("season-tabs").hidden = false;
    byId("season-main").hidden = false;
    byId("alltime-picker").hidden = true;
    byId("season-picker").hidden = false;
    // Restore the champion banner if the current season actually has a
    // champion - renderChampionBanner() (called during loadSeason) is
    // the source of truth for whether it should show at all, so just
    // re-run it rather than blindly setting hidden = false here.
    renderChampionBanner();
  }

  function setupAllTimeButtons() {
    var openBtn = byId("alltime-btn");
    var backBtn = byId("back-to-season-btn");
    if (openBtn) openBtn.addEventListener("click", showAllTimeView);
    if (backBtn) {
      backBtn.addEventListener("click", function () {
        hideAllTimeView();
        var select = byId("season-select");
        if (select && state.season !== null) {
          select.value = String(state.season);
        }
      });
    }
  }

  function setupAllTimeTabs() {
    var tabBtns = document.querySelectorAll(".alltime-tabs .tab-btn");
    tabBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        tabBtns.forEach(function (b) {
          b.classList.remove("active");
        });
        document.querySelectorAll("#alltime-content .tab-panel").forEach(function (p) {
          p.classList.remove("active");
        });
        btn.classList.add("active");
        var panel = byId("alltime-" + btn.dataset.alltimeTab);
        if (panel) panel.classList.add("active");
      });
    });
  }

  function setupCareerToggle() {
    var buttons = document.querySelectorAll(".career-toggle-btn");
    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        buttons.forEach(function (b) {
          b.classList.remove("active");
        });
        btn.classList.add("active");
        state.careerSplit = btn.dataset.split;
        if (state.allTimeData) {
          renderCareerTotals(state.allTimeData, state.careerSplit);
        }
      });
    });
  }

  function setupCareerSort() {
    var select = byId("career-sort-select");
    if (select) {
      select.onchange = function () {
        state.careerSort = select.value;
        syncCareerSortHeaders();
        if (state.allTimeData) renderCareerTotals(state.allTimeData, state.careerSplit);
      };
    }

    document.querySelectorAll("#career-totals-table th.sortable-col").forEach(function (th) {
      th.style.cursor = "pointer";
      th.addEventListener("click", function () {
        state.careerSort = th.dataset.sort;
        if (select) select.value = state.careerSort;
        syncCareerSortHeaders();
        if (state.allTimeData) renderCareerTotals(state.allTimeData, state.careerSplit);
      });
    });

    syncCareerSortHeaders();
  }

  // Adds a visual indicator (▲) to whichever column header matches the
  // currently active state.careerSort, so it's clear at a glance what
  // the table is sorted by - regardless of whether that sort was set via
  // clicking a header or via the #career-sort-select dropdown.
  function syncCareerSortHeaders() {
    document.querySelectorAll("#career-totals-table th.sortable-col").forEach(function (th) {
      if (th.dataset.sort === state.careerSort) {
        th.classList.add("sort-active");
      } else {
        th.classList.remove("sort-active");
      }
    });
  }

  function setupRecordsControls() {
    var viewButtons = document.querySelectorAll(".records-view-btn");
    viewButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        viewButtons.forEach(function (b) {
          b.classList.remove("active");
        });
        btn.classList.add("active");
        state.recordsView = btn.dataset.view;
        byId("records-member-picker-wrap").hidden = state.recordsView !== "member";
        renderRecords();
      });
    });

    var splitButtons = document.querySelectorAll(".records-split-btn");
    splitButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        splitButtons.forEach(function (b) {
          b.classList.remove("active");
        });
        btn.classList.add("active");
        state.recordsSplit = btn.dataset.split;
        renderRecords();
      });
    });
  }

  /* ============================================================
   * Season Records tab (per-season, not All-Time): shows the same six
   * "fun stats" as the All-Time Records tab, but scoped to just the
   * currently loaded season via buildSeasonMasterRecords()/
   * buildSeasonMemberRecords(). Reuses RECORD_DEFS and renderRecordCard()
   * defined further below. The underlying all-seasons dataset is cached
   * in seasonAllTimeDataForRecords so switching seasons only re-filters
   * already-fetched data instead of re-fetching every season again.
   * ============================================================ */

  async function ensureSeasonRecordsData() {
    if (seasonAllTimeDataForRecords) return seasonAllTimeDataForRecords;
    seasonAllTimeDataForRecords = await window.AllTimeStats.loadAllSeasons();
    return seasonAllTimeDataForRecords;
  }

  async function renderSeasonRecords() {
    var loadingEl = byId("season-records-loading");
    var contentEl = byId("season-records-content");
    var grid = byId("season-records-grid");
    if (!grid) return;

    if (loadingEl) loadingEl.hidden = false;
    if (contentEl) contentEl.hidden = true;

    try {
      var allSeasonsData = await ensureSeasonRecordsData();
      var records;
      if (seasonRecordsView === "master") {
        records = window.AllTimeStats.buildSeasonMasterRecords(allSeasonsData, state.season, seasonRecordsSplit);
      } else {
        var select = byId("season-records-member-select");
        var ownerKey = select ? select.value : null;
        if (!ownerKey) {
          grid.innerHTML = '<p class="status-text">Pick a member to see their personal records.</p>';
          if (loadingEl) loadingEl.hidden = true;
          if (contentEl) contentEl.hidden = false;
          return;
        }
        records = window.AllTimeStats.buildSeasonMemberRecords(allSeasonsData, state.season, seasonRecordsSplit, ownerKey);
      }
      grid.innerHTML = "";
      RECORD_DEFS.forEach(function (def) {
        grid.appendChild(renderRecordCard(def, records[def.key]));
      });
    } catch (err) {
      console.error("Failed to load season records", err);
      if (grid) grid.innerHTML = '<p class="status-text">Could not load records for this season.</p>';
    }

    if (loadingEl) loadingEl.hidden = true;
    if (contentEl) contentEl.hidden = false;
  }

  async function populateSeasonRecordsMemberSelector() {
    var select = byId("season-records-member-select");
    if (!select) return;
    var allSeasonsData = await ensureSeasonRecordsData();
    var owners = window.AllTimeStats.getAllOwnerNames(allSeasonsData);
    var previousValue = select.value;
    select.innerHTML = "";
    owners.forEach(function (o) {
      var opt = document.createElement("option");
      opt.value = o.key;
      opt.textContent = o.name;
      select.appendChild(opt);
    });
    if (previousValue && owners.some(function (o) { return o.key === previousValue; })) {
      select.value = previousValue;
    }
  }

  function setupSeasonRecordsControls() {
    var viewButtons = document.querySelectorAll(".season-records-view-btn");
    viewButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        viewButtons.forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        seasonRecordsView = btn.dataset.view;
        var wrap = byId("season-records-member-picker-wrap");
        if (wrap) wrap.hidden = seasonRecordsView !== "member";
        renderSeasonRecords();
      });
    });

    var splitButtons = document.querySelectorAll(".season-records-split-btn");
    splitButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        splitButtons.forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        seasonRecordsSplit = btn.dataset.split;
        renderSeasonRecords();
      });
    });

    var memberSelect = byId("season-records-member-select");
    if (memberSelect) {
      memberSelect.addEventListener("change", renderSeasonRecords);
    }
  }

  async function loadAllTimeData() {
    if (state.allTimeData) {
      renderCareerTotals(state.allTimeData, state.careerSplit);
      populateH2hSelectors(state.allTimeData);
      populateVsFieldSelector(state.allTimeData);
      populateRecordsMemberSelector(state.allTimeData);
      populateAllTimeDraftOwnerFilter(state.allTimeData);
      renderAllTimeDraftFiltered();
      byId("alltime-loading").hidden = true;
      byId("alltime-content").hidden = false;
      return;
    }

    byId("alltime-loading").hidden = false;
    byId("alltime-content").hidden = true;

    try {
      var allSeasonsData = await window.AllTimeStats.loadAllSeasons();
      state.allTimeData = allSeasonsData;
      renderCareerTotals(allSeasonsData, state.careerSplit);
      populateH2hSelectors(allSeasonsData);
      populateVsFieldSelector(allSeasonsData);
      populateRecordsMemberSelector(allSeasonsData);
      populateAllTimeDraftOwnerFilter(allSeasonsData);
      renderAllTimeDraftFiltered();
      byId("alltime-loading").hidden = true;
      byId("alltime-content").hidden = false;
    } catch (err) {
      console.error("Failed to load all-time data", err);
      byId("alltime-loading").textContent =
        "Could not load all-time data. Details: " + (err && err.message ? err.message : err);
    }
  }

  function renderCareerTotals(allSeasonsData, split) {
    var tbody = document.querySelector("#career-totals-table tbody");
    if (!tbody) return;

    var totals = window.AllTimeStats.buildCareerTotals(allSeasonsData);

    var sorted = totals.slice().sort(function (a, b) {
      var recA = a[split];
      var recB = b[split];
      var sortBy = state.careerSort || "championships";

      if (sortBy === "championships") {
        if (b.championships !== a.championships) {
          return b.championships - a.championships;
        }
        if (recB.winPct !== recA.winPct) {
          return recB.winPct - recA.winPct;
        }
        return recB.wins - recA.wins;
      }

      if (sortBy === "pf") {
        if (recB.pointsFor !== recA.pointsFor) {
          return recB.pointsFor - recA.pointsFor;
        }
        return recB.wins - recA.wins;
      }

      if (sortBy === "pa") {
        if (recA.pointsAgainst !== recB.pointsAgainst) {
          return recA.pointsAgainst - recB.pointsAgainst;
        }
        return recB.wins - recA.wins;
      }

      if (sortBy === "wins") {
        if (recB.wins !== recA.wins) {
          return recB.wins - recA.wins;
        }
        return recB.winPct - recA.winPct;
      }
      if (sortBy === "losses") {
        if (recB.losses !== recA.losses) return recA.losses - recB.losses;
        return recB.winPct - recA.winPct;
      }
      if (sortBy === "winPct") {
        if (recB.winPct !== recA.winPct) {
          return recB.winPct - recA.winPct;
        }
        return recB.wins - recA.wins;
      }

      if (sortBy === "seasons") {
        if (b.seasons !== a.seasons) {
          return b.seasons - a.seasons;
        }
        return recB.wins - recA.wins;
      }

      if (sortBy === "runnerUps") {
        if (b.runnerUps !== a.runnerUps) {
          return b.runnerUps - a.runnerUps;
        }
        return recB.wins - recA.wins;
      }

      if (sortBy === "transactions") {
        if (b.totalTransactions !== a.totalTransactions) {
          return b.totalTransactions - a.totalTransactions;
        }
        return recB.wins - recA.wins;
      }

      if (sortBy === "name") {
        return a.ownerName.localeCompare(b.ownerName);
      }

      return 0;
    });

    tbody.innerHTML = "";

    var anyIncomplete = false;

    sorted.forEach(function (owner, idx) {
      var rec = owner[split] || owner.combined;
      var tr = document.createElement("tr");
      if (idx === 0 && split === "combined" && owner.championships > 0) {
        tr.classList.add("top-champion");
      }
      var champHtml = owner.championships > 0 ? "\ud83c\udfc6 x" + owner.championships : "-";
      var runnerUpHtml = owner.runnerUps > 0 ? "\ud83e\udd48 x" + owner.runnerUps : "-";
      var txnHtml = owner.totalTransactions + (owner.hasIncompleteTransactionData ? "*" : "");
      if (owner.hasIncompleteTransactionData) anyIncomplete = true;

      tr.innerHTML =
        "<td>" + (idx + 1) + "</td>" +
        "<td>" + escapeHtml(owner.ownerName) + "</td>" +
        "<td>" + owner.seasons + "</td>" +
        "<td>" + rec.wins + "</td>" +
        "<td>" + rec.losses + "</td>" +
        "<td>" + rec.ties + "</td>" +
        "<td>" + (rec.winPct * 100).toFixed(1) + "%</td>" +
        "<td>" + rec.pointsFor.toFixed(2) + "</td>" +
        "<td>" + rec.pointsAgainst.toFixed(2) + "</td>" +
        "<td>" + champHtml + "</td>" +
        "<td>" + runnerUpHtml + "</td>" +
        "<td>" + txnHtml + "</td>";
      tbody.appendChild(tr);
    });

    var noteEl = byId("career-txn-note");
    if (noteEl) noteEl.hidden = !anyIncomplete;
  }

  function populateH2hSelectors(allSeasonsData) {
    var selectA = byId("h2h-owner-a");
    var selectB = byId("h2h-owner-b");
    if (!selectA || !selectB) return;

    var owners = window.AllTimeStats.getAllOwnerNames(allSeasonsData);

    [selectA, selectB].forEach(function (sel) {
      sel.innerHTML = "";
      owners.forEach(function (o) {
        var opt = document.createElement("option");
        opt.value = o.key;
        opt.textContent = o.name;
        sel.appendChild(opt);
      });
    });

    if (owners.length > 1) {
      selectA.value = owners[0].key;
      selectB.value = owners[1].key;
    }

    selectA.onchange = renderHeadToHead;
    selectB.onchange = renderHeadToHead;
    if (owners.length > 1) renderHeadToHead();
  }

  function renderDraftBreakdownGrid(containerId, breakdown) {
    var container = byId(containerId);
    if (!container) return;

    if (!breakdown || breakdown.totalPicks === 0) {
      container.innerHTML = '<p class="status-text">No data available.</p>';
      return;
    }

    function cardsHtml(entries) {
      return entries.map(function (e) {
        return (
          '<div class="breakdown-card">' +
            '<div class="breakdown-card-value">' + e.count + '</div>' +
            '<div class="breakdown-card-label">' + escapeHtml(e.key) + '</div>' +
          '</div>'
        );
      }).join('');
    }

    container.innerHTML =
      '<h4 class="breakdown-heading">By Position</h4>' +
      '<div class="breakdown-grid">' + cardsHtml(breakdown.byPosition) + '</div>' +
      '<h4 class="breakdown-heading">By NFL Team</h4>' +
      '<div class="breakdown-grid">' + cardsHtml(breakdown.byNflTeam) + '</div>';
  }

    /**
   * Renders every visible All-Time draft grouped by year.
   *
   * Each year is shown as a visual snake board:
   * - Odd-numbered rounds: ascending pick order, left → right.
   * - Even-numbered rounds: descending pick order, right ← left.
   *
   * This changes display order only. Historical pick numbers and their
   * R#.## labels are preserved exactly.
   */
    function renderAllTimeDraftByYear(picks, showSnakeArrows) {
    var container = byId("alltime-draft-by-year");
    if (!container) return;

    if (!picks || picks.length === 0) {
      container.innerHTML =
        '<p class="status-text">No draft picks found.</p>';
      return;
    }

    var picksByYear = {};

    picks.forEach(function (pick) {
      var year = Number(pick.year);

      if (!picksByYear[year]) {
        picksByYear[year] = [];
      }

      picksByYear[year].push(pick);
    });

    var years = Object.keys(picksByYear)
      .map(Number)
      .sort(function (a, b) {
        return b - a;
      });

    container.innerHTML = years
      .map(function (year) {
        var yearPicks = picksByYear[year].slice();

        /*
         * Calculate the number of teams in this season from Round 1
         * picks. This keeps the R#.## labels accurate across historical
         * years that may have a different number of teams.
         */
        var roundOneTeams = {};

        yearPicks.forEach(function (pick) {
          if (Number(pick.round) === 1 && pick.ownerKey) {
            roundOneTeams[pick.ownerKey] = true;
          }
        });

        var teamCount = Object.keys(roundOneTeams).length || 12;

        /*
         * Organize this year into individual draft rounds.
         */
        var picksByRound = {};

        yearPicks.forEach(function (pick) {
          var round = Number(pick.round) || 0;

          if (!picksByRound[round]) {
            picksByRound[round] = [];
          }

          picksByRound[round].push(pick);
        });

        /*
         * Create the display path:
         * odd rounds ascend left-to-right;
         * even rounds descend left-to-right.
         */
        var snakePicks = [];

        Object.keys(picksByRound)
          .map(Number)
          .sort(function (a, b) {
            return a - b;
          })
          .forEach(function (round) {
            var roundPicks = picksByRound[round].slice();

            roundPicks.sort(function (a, b) {
              return Number(a.pickNo || 0) - Number(b.pickNo || 0);
            });

            if (round % 2 === 0) {
              roundPicks.reverse();
            }

            snakePicks = snakePicks.concat(roundPicks);
          });

        var picksHtml = snakePicks
          .map(function (pick, snakeIndex) {
            var round = Number(pick.round) || 0;

            var roundPick =
              pick.roundPick ||
              (round && pick.pickNo
                ? pick.pickNo - (round - 1) * teamCount
                : null);

            var pickLabel =
              "Pick " +
              (pick.pickNo || "-") +
              (round
                ? " (R" +
                  round +
                  (roundPick ? "." + roundPick : "") +
                  ")"
                : "");

            /*
             * Direction rules:
             * → on non-final cards in odd rounds
             * ← on non-final cards in even rounds
             * ↓ on the last card of every non-final round
             * no arrow on the final card in the year's draft
             */
                        /*
             * Find this pick's original selection number inside its round.
             * This is intentionally calculated from pickNo rather than
             * its visual grid position: the board reverses even rounds,
             * but the #12 pick of every round should always get ↓.
             */
                      /*
             * Determine the turn from the visual snake ordering, not from
             * the raw ".12" pick number. `snakePicks` has already reversed
             * even rounds:
             *
             * R15 displays R15.1 through R15.12, so R15.12 gets ↓.
             * R16 displays R16.12 through R16.1, so R16.1 gets ↓.
             *
             * Only the actual final card in the year's complete draft has
             * no arrow at all.
             */
            var pickWithinRound = Number(
              pick.roundPick ||
              (round && pick.pickNo
              ? pick.pickNo - (round - 1) * teamCount
              : 0)
            );

            /*
             * The board has already been put in snake display order:
             * odd rounds go left-to-right; even rounds have been reversed.
             *
             * Therefore, the last displayed item of an odd row is R#.12,
             * while the last displayed item of an even row is R#.1.
             * That final displayed item gets the downward turn arrow.
             */
            var directionArrow = getSnakeArrow(
              round,
              pickWithinRound,
              teamCount,
              snakeIndex === snakePicks.length - 1
            );

            var directionText = "";
            if (directionArrow === "→") {
              directionText = "Next pick to the right";
            } else if (directionArrow === "←") {
              directionText = "Next pick to the left";
            } else if (directionArrow === "↓") {
              directionText = "Next round";
            }

            var keeperTag = "";

            var metaLine = pick.position
              ? escapeHtml(pick.position) +
                (pick.nflTeam
                  ? " - " + escapeHtml(pick.nflTeam)
                  : "")
              : "";

            var arrowHtml = directionArrow
              ? '<div class="draft-direction" title="' +
                directionText +
                '" aria-label="' +
                directionText +
                '">' +
                directionArrow +
                "</div>"
              : "";

            return (
              '<div class="draft-pick draft-pick-snake' +   (pick.isKeeper ? ' is-keeper-pick' : '') +   '">' +
                '<div class="pick-num">' +
                  pickLabel +
                "</div>" +
                arrowHtml +
                "<div>" +
                  escapeHtml(pick.playerName || "Unknown Player") +
                "</div>" +
                (metaLine
                  ? '<div class="draft-meta">' + metaLine + "</div>"
                  : "") +
                '<div class="draft-owner">' +
                  escapeHtml(pick.ownerName || "") +
                "</div>" +
                keeperTag +
              "</div>"
            );
          })
          .join("");

        return (
          '<h3 class="playoff-heading">' +
            year +
            " Draft</h3>" +
          '<div class="draft-board draft-board-snake">' +
            picksHtml +
          "</div>"
        );
      })
      .join("");
  }
  
  function renderAllTimeDraftFiltered() {
    if (!state.allTimeData) return;
    var select = byId('alltime-draft-owner-filter');
    var ownerName = select ? select.value : '';

    var allPicks = window.AllTimeStats.buildAllTimeDraftPicks(state.allTimeData, ownerName || null);

    var allBreakdown = window.AllTimeStats.buildDraftBreakdown(allPicks);
    renderDraftBreakdownGrid('alltime-draft-breakdown', allBreakdown);

    var keeperBreakdown = window.AllTimeStats.buildKeeperDraftBreakdown(allPicks);
    renderDraftBreakdownGrid('alltime-keeper-breakdown', keeperBreakdown);

        renderAllTimeDraftByYear(allPicks, !ownerName);
  }

  function populateAllTimeDraftOwnerFilter(allSeasonsData) {
    var select = byId('alltime-draft-owner-filter');
    if (!select) return;

    var owners = window.AllTimeStats.getAllOwnerNames(allSeasonsData);
    select.innerHTML = '<option value="">All Owners</option>';
    owners.forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o.name;
      opt.textContent = o.name;
      select.appendChild(opt);
    });

    select.onchange = renderAllTimeDraftFiltered;
  }

  function renderSummaryCards(containerId, summary, nameA, nameB) {
    var el = byId(containerId);
    if (!el) return;

    if (summary.totalGames === 0) {
      el.innerHTML = '<p class="status-text">No games in this split.</p>';
      return;
    }

    el.innerHTML =
      '<div class="h2h-stat-card"><div class="h2h-stat-value">' + summary.totalGames +
      '</div><div class="h2h-stat-label">Games</div></div>' +
      '<div class="h2h-stat-card"><div class="h2h-stat-value">' + summary.ownerAWins + "-" + summary.ownerBWins +
      (summary.ties ? "-" + summary.ties : "") +
      '</div><div class="h2h-stat-label">' + escapeHtml(nameA) + " Record</div></div>" +
      '<div class="h2h-stat-card"><div class="h2h-stat-value">' + summary.ownerAvgA.toFixed(2) +
      '</div><div class="h2h-stat-label">' + escapeHtml(nameA) + ' Avg Score</div></div>' +
      '<div class="h2h-stat-card"><div class="h2h-stat-value">' + summary.ownerAvgB.toFixed(2) +
      '</div><div class="h2h-stat-label">' + escapeHtml(nameB) + ' Avg Score</div></div>';
  }

  function renderHeadToHead() {
    var selectA = byId("h2h-owner-a");
    var selectB = byId("h2h-owner-b");
    var tbody = document.querySelector("#h2h-games-table tbody");
    if (!selectA || !selectB || !tbody || !state.allTimeData) return;

    var keyA = selectA.value;
    var keyB = selectB.value;

    if (!keyA || !keyB || keyA === keyB) {
      ["h2h-summary-combined", "h2h-summary-regular", "h2h-summary-playoff"].forEach(function (id) {
        byId(id).innerHTML = '<p class="status-text">Pick two different owners to compare.</p>';
      });
      tbody.innerHTML = "";
      return;
    }

    var result = window.AllTimeStats.buildHeadToHead(state.allTimeData, keyA, keyB);
    var nameA = selectA.options[selectA.selectedIndex].textContent;
    var nameB = selectB.options[selectB.selectedIndex].textContent;

    if (result.matchups.length === 0) {
      ["h2h-summary-combined", "h2h-summary-regular", "h2h-summary-playoff"].forEach(function (id) {
        byId(id).innerHTML = "";
      });
      byId("h2h-summary-combined").innerHTML =
        "<p class=\"status-text\">" + escapeHtml(nameA) + " and " + escapeHtml(nameB) +
        " have never played each other.</p>";
      tbody.innerHTML = "";
      return;
    }

    renderSummaryCards("h2h-summary-combined", result.summary, nameA, nameB);
    renderSummaryCards("h2h-summary-regular", result.regularSummary, nameA, nameB);
    renderSummaryCards("h2h-summary-playoff", result.playoffSummary, nameA, nameB);

    tbody.innerHTML = "";
    result.matchups.forEach(function (m) {
      var tr = document.createElement("tr");
      if (m.ownerAScore > m.ownerBScore) tr.classList.add("h2h-a-win");
      else if (m.ownerBScore > m.ownerAScore) tr.classList.add("h2h-b-win");

      var weekTag = "";
      if (m.gameType === "playoff") {
        tr.classList.add("h2h-playoff-row");
        weekTag = " (Playoff)";
      } else if (m.gameType === "consolation") {
        tr.classList.add("h2h-consolation-row");
        weekTag = " (Consolation)";
      }

      var weekLabel = m.week + weekTag + " (" + m.source.toUpperCase() + ")";
      tr.innerHTML =
        "<td>" + m.year + "</td>" +
        "<td>" + weekLabel + "</td>" +
        "<td>" + escapeHtml(m.ownerATeamName) + "</td>" +
        "<td>" + m.ownerAScore.toFixed(2) + "</td>" +
        "<td>" + m.ownerBScore.toFixed(2) + "</td>" +
        "<td>" + escapeHtml(m.ownerBTeamName) + "</td>";
      tbody.appendChild(tr);
    });
  }

  function populateVsFieldSelector(allSeasonsData) {
    var select = byId("vsfield-owner-select");
    if (!select) return;

    var owners = window.AllTimeStats.getAllOwnerNames(allSeasonsData);
    select.innerHTML = "";
    owners.forEach(function (o) {
      var opt = document.createElement("option");
      opt.value = o.key;
      opt.textContent = o.name;
      select.appendChild(opt);
    });

    if (owners.length > 0) {
      select.value = owners[0].key;
    }

    select.onchange = renderOwnerVsField;

    if (owners.length > 0) renderOwnerVsField();
  }

  function renderOverallCard(containerId, summary) {
    var el = byId(containerId);
    if (!el) return;

    if (summary.totalGames === 0) {
      el.innerHTML = '<p class="status-text">No games in this split.</p>';
      return;
    }

    el.innerHTML =
      '<div class="h2h-stat-card"><div class="h2h-stat-value">' + summary.totalGames +
      '</div><div class="h2h-stat-label">Games</div></div>' +
      '<div class="h2h-stat-card"><div class="h2h-stat-value">' + summary.wins + "-" + summary.losses +
      (summary.ties ? "-" + summary.ties : "") +
      '</div><div class="h2h-stat-label">Record</div></div>' +
      '<div class="h2h-stat-card"><div class="h2h-stat-value">' + (summary.winPct * 100).toFixed(1) + '%' +
      '</div><div class="h2h-stat-label">Win %</div></div>' +
      '<div class="h2h-stat-card"><div class="h2h-stat-value">' + summary.avgFor.toFixed(2) +
      '</div><div class="h2h-stat-label">Avg PF</div></div>' +
      '<div class="h2h-stat-card"><div class="h2h-stat-value">' + summary.avgAgainst.toFixed(2) +
      '</div><div class="h2h-stat-label">Avg PA</div></div>';
  }

  function renderOwnerVsField() {
    var select = byId("vsfield-owner-select");
    var tbody = document.querySelector("#vsfield-table tbody");
    if (!select || !tbody || !state.allTimeData) return;

    var ownerKey = select.value;
    if (!ownerKey) {
      tbody.innerHTML = "";
      return;
    }

    var result = window.AllTimeStats.buildOwnerVsAll(state.allTimeData, ownerKey);

    renderOverallCard("vsfield-overall-regular", result.overallRegular);
    renderOverallCard("vsfield-overall-playoff", result.overallPlayoff);

    tbody.innerHTML = "";
    if (result.byOpponent.length === 0) {
      tbody.innerHTML = '<tr><td colspan="11">No games recorded for this owner yet.</td></tr>';
      return;
    }

    result.byOpponent.forEach(function (row) {
      var tr = document.createElement("tr");
      var reg = row.regularSummary;
      var po = row.playoffSummary;

      if (reg.totalGames > 0) {
        if (reg.wins > reg.losses) tr.classList.add("vsfield-winning-record");
        else if (reg.losses > reg.wins) tr.classList.add("vsfield-losing-record");
      }

      tr.innerHTML =
        "<td>" + escapeHtml(row.opponentName) + "</td>" +
        "<td>" + reg.wins + "</td>" +
        "<td>" + reg.losses + "</td>" +
        "<td>" + reg.ties + "</td>" +
        "<td>" + reg.pointsFor.toFixed(2) + "</td>" +
        "<td>" + reg.pointsAgainst.toFixed(2) + "</td>" +
        "<td>" + po.wins + "</td>" +
        "<td>" + po.losses + "</td>" +
        "<td>" + po.ties + "</td>" +
        "<td>" + po.pointsFor.toFixed(2) + "</td>" +
        "<td>" + po.pointsAgainst.toFixed(2) + "</td>";
      tbody.appendChild(tr);
    });
  }

  function populateRecordsMemberSelector(allSeasonsData) {
    var select = byId("records-member-select");
    if (!select) return;

    var owners = window.AllTimeStats.getAllOwnerNames(allSeasonsData);
    select.innerHTML = "";
    owners.forEach(function (o) {
      var opt = document.createElement("option");
      opt.value = o.key;
      opt.textContent = o.name;
      select.appendChild(opt);
    });

    if (owners.length > 0) select.value = owners[0].key;

    select.onchange = renderRecords;

    renderRecords();
  }

  var RECORD_DEFS = [
    { key: "mostPoints", title: "Most Points in a Week", showOpponent: true, mode: "score" },
    { key: "leastPoints", title: "Least Points in a Week", showOpponent: true, mode: "score" },
    { key: "largestMarginVictory", title: "Largest Margin of Victory", showOpponent: true, mode: "margin" },
    { key: "smallestMarginVictory", title: "Smallest Margin of Victory", showOpponent: true, mode: "margin" },
    { key: "largestMarginDefeat", title: "Largest Margin of Defeat", showOpponent: true, mode: "margin" },
    { key: "smallestMarginDefeat", title: "Smallest Margin of Defeat", showOpponent: true, mode: "margin" },
  ];

  function renderRecordCard(def, entry) {
    var card = document.createElement("div");
    card.className = "record-card";

    if (!entry) {
      card.classList.add("no-data");
      card.innerHTML = "<h4>" + escapeHtml(def.title) + "</h4><p>No games in this split yet.</p>";
      return card;
    }

    var valueText = def.mode === "score" ? entry.myScore.toFixed(2) : entry.margin.toFixed(2);
    var scoreLine = entry.myScore.toFixed(2) + " – " + entry.oppScore.toFixed(2);
    var vsLine = "vs " + escapeHtml(entry.opponentName);
    var yearWeek = "Week " + entry.week + ", " + entry.year + " (" + entry.source.toUpperCase() + ")";

    card.innerHTML =
      "<h4>" + escapeHtml(def.title) + "</h4>" +
      '<div class="record-value">' + valueText + "</div>" +
      '<div class="record-holder">' + escapeHtml(entry.ownerName) + "</div>" +
      '<div class="record-detail">' + scoreLine + " " + vsLine + "</div>" +
      '<div class="record-detail">' + yearWeek + "</div>";

    return card;
  }

  /**
   * Renders the All-Time Records tab for the currently selected view
   * ("master" = league-wide leaderboard, "member" = one owner's
   * personal bests/worsts) and split ("regular" or "playoff" - never
   * blended together, per league preference).
   */
  function renderRecords() {
    var grid = byId("records-grid");
    if (!grid || !state.allTimeData) return;

    var records;
    if (state.recordsView === "master") {
      records = window.AllTimeStats.buildMasterRecords(state.allTimeData, state.recordsSplit);
    } else {
      var select = byId("records-member-select");
      var ownerKey = select ? select.value : null;
      if (!ownerKey) {
        grid.innerHTML = "<p class=\"status-text\">Pick a member to see their personal records.</p>";
        return;
      }
      records = window.AllTimeStats.buildMemberRecords(state.allTimeData, state.recordsSplit, ownerKey);
    }

    grid.innerHTML = "";
    RECORD_DEFS.forEach(function (def) {
      grid.appendChild(renderRecordCard(def, records[def.key]));
    });
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
    setupAllTimeButtons();
    setupAllTimeTabs();
    setupCareerToggle();
    setupCareerSort();
    setupRecordsControls();
    setupSeasonRecordsControls();

    var urlSeason = getSeasonFromURL();
    var defaultSeason =
      urlSeason && (SleeperAPI.SLEEPER_SEASONS[urlSeason] || isEspnYear(urlSeason))
        ? urlSeason
        : SleeperAPI.CURRENT_LIVE_SEASON;

    byId("season-select").value = String(defaultSeason);
    byId("season-select").addEventListener("change", function (e) {
      var value = e.target.value;

      if (value === "alltime") {
        showAllTimeView();
        return;
      }

      var season = Number(value);
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
