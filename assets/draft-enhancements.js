/**
 * draft-enhancements.js
 *
 * 1. Applies NFL team colors to every "By NFL Team" draft breakdown box,
 *    and distinct position colors to every "By Position" draft breakdown
 *    box, in both the single-season Draft tab and the All-Time Draft tab.
 * 2. Applies the same position colors to every individual pick card on
 *    the draft board itself (#draft-board and #alltime-draft-by-year),
 *    coloring the card by the drafted player's position. Player names
 *    and text content are left untouched.
 *
 * Load after nfl-team-colors.js and before or after season.js. This script
 * retries after the page's async draft renderers build/rebuild the cards,
 * and watches all relevant containers for re-renders (season change,
 * team/owner filter change, switching into All-Time view, etc).
 */
(function () {
  "use strict";

  var BREAKDOWN_CONTAINER_IDS = [
    "draft-breakdown",
    "alltime-draft-breakdown",
    "alltime-keeper-breakdown"
  ];

  var PICK_BOARD_CONTAINER_IDS = [
    "draft-board",
    "alltime-draft-by-year"
  ];

  var POSITION_LIST = ["QB", "RB", "WR", "TE", "K", "D/ST", "DST"];

  function normalizeKey(value) {
    return String(value || "").trim().toUpperCase();
  }

  function getTeamColors(team) {
    if (window.NflTeamColors && typeof window.NflTeamColors.get === "function") {
      return window.NflTeamColors.get(team);
    }
    return { primary: "#48505c", secondary: "#717b8a" };
  }

  function getPositionColors(position) {
    if (window.NflTeamColors && typeof window.NflTeamColors.getPosition === "function") {
      return window.NflTeamColors.getPosition(position);
    }
    return { primary: "#48505c", secondary: "#717b8a" };
  }

  function isNflTeamCode(value) {
    return /^[A-Z]{2,4}$/.test(value) && value !== "UNKNOWN" && POSITION_LIST.indexOf(value) === -1;
  }

  function isPositionCode(value) {
    return POSITION_LIST.indexOf(value) !== -1;
  }

  // Pulls a position code (QB/RB/WR/TE/K/D-ST) out of pick-card text like
  // "RB - PIT", "D/ST - BAL", or "QB-SEA" (owner/team name lines are never
  // shaped like this, so this pattern is safe against false positives).
  function extractPositionFromText(text) {
    var match = /^([A-Z\/]{1,4})\s*-\s*[A-Z]{2,4}$/.exec(normalizeKey(text).replace(/\s+/g, " "));
    if (!match) return null;
    var candidate = match[1];
    if (isPositionCode(candidate)) return candidate;
    return null;
  }

  function findGridByHeading(container, headingMatch) {
    if (!container) return null;
    var headings = container.querySelectorAll("h3");
    for (var i = 0; i < headings.length; i++) {
      var headingText = (headings[i].textContent || "").trim().toLowerCase();
      if (headingText === headingMatch) {
        var grid = headings[i].nextElementSibling;
        if (grid && grid.classList.contains("breakdown-grid")) return grid;
      }
    }
    return null;
  }

  function applyColorsToGrid(grid, cardClass, colorFn, matchFn, primaryVar, secondaryVar) {
    if (!grid) return;
    grid.querySelectorAll(".breakdown-card").forEach(function (card) {
      var label = card.querySelector(".breakdown-card-label");
      if (!label) return;

      var rawKey = normalizeKey(label.textContent);
      if (!matchFn(rawKey)) return;

      var colors = colorFn(rawKey);
      card.classList.add(cardClass);
      card.style.setProperty(primaryVar, colors.primary);
      card.style.setProperty(secondaryVar, colors.secondary);
    });
  }

  function applyBreakdownColors() {
    BREAKDOWN_CONTAINER_IDS.forEach(function (containerId) {
      var container = document.getElementById(containerId);
      if (!container) return;

      var nflGrid = findGridByHeading(container, "by nfl team");
      applyColorsToGrid(
        nflGrid,
        "nfl-breakdown-card",
        getTeamColors,
        isNflTeamCode,
        "--nfl-primary",
        "--nfl-secondary"
      );

      var posGrid = findGridByHeading(container, "by position");
      applyColorsToGrid(
        posGrid,
        "position-breakdown-card",
        getPositionColors,
        isPositionCode,
        "--pos-primary",
        "--pos-secondary"
      );
    });
  }

  // Colors each individual .draft-pick card on the draft board by the
  // drafted player's position, read from whichever line inside the card
  // matches the "POS - TEAM" pattern (works for both Sleeper and ESPN
  // era picks, and for both the single-season and All-Time boards).
  function applyPickCardColors() {
    PICK_BOARD_CONTAINER_IDS.forEach(function (containerId) {
      var container = document.getElementById(containerId);
      if (!container) return;

      container.querySelectorAll(".draft-pick").forEach(function (card) {
        if (card.dataset.posColored === "1") return;

        var lines = card.querySelectorAll("div");
        var position = null;
        for (var i = 0; i < lines.length; i++) {
          position = extractPositionFromText(lines[i].textContent);
          if (position) break;
        }
        if (!position) return;

        var colors = getPositionColors(position);
        card.classList.add("position-draft-pick");
        card.style.setProperty("--pos-primary", colors.primary);
        card.style.setProperty("--pos-secondary", colors.secondary);
        card.dataset.posColored = "1";
      });
    });
  }

  function applyAll() {
    applyBreakdownColors();
    applyPickCardColors();
  }

  function watchForRenders() {
    BREAKDOWN_CONTAINER_IDS.concat(PICK_BOARD_CONTAINER_IDS).forEach(function (containerId) {
      var container = document.getElementById(containerId);
      if (!container || container.dataset.posWatching === "1") return;
      container.dataset.posWatching = "1";
      new MutationObserver(function () {
        applyAll();
      }).observe(container, {
        childList: true,
        subtree: true
      });
    });

    // season.js / all-time.js render draft data asynchronously, and the
    // All-Time containers don't exist in the DOM until that tab is opened.
    // These retries cover initial load, changing seasons, changing the
    // team/owner filter, and opening the All-Time view for the first time.
    [0, 100, 300, 700, 1500, 3000, 6000].forEach(function (delay) {
      window.setTimeout(function () {
        watchForRenders();
        applyAll();
      }, delay);
    });
  }

  function init() {
    watchForRenders();
    applyAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
