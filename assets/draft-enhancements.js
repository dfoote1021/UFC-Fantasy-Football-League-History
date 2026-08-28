/**
 * draft-enhancements.js
 *
 * Applies NFL team colors to every "By NFL Team" draft breakdown on the
 * site (both the single-season Draft tab AND the All-Time Draft tab), and
 * applies distinct position colors to every "By Position" draft breakdown
 * in the same two places. It does not modify player cards; they remain
 * normal "Position - Team" text.
 *
 * Load after nfl-team-colors.js and before or after season.js. This script
 * retries after the page's async draft renderers build/rebuild the cards,
 * and watches both breakdown containers for re-renders (season change,
 * team/owner filter change, switching into All-Time view, etc).
 */
(function () {
  "use strict";

  var BREAKDOWN_CONTAINER_IDS = [
    "draft-breakdown",
    "alltime-draft-breakdown",
    "alltime-keeper-breakdown"
  ];

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
    return /^[A-Z]{2,4}$/.test(value) && value !== "UNKNOWN";
  }

  function isPositionCode(value) {
    return ["QB", "RB", "WR", "TE", "K", "D/ST", "DST"].indexOf(value) !== -1;
  }

  // Finds the breakdown-grid immediately following an <h3> whose text
  // matches headingMatch, inside the given container.
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

      var rawKey = normalizeKey(label.textContent === "D/ST" ? "D/ST" : label.textContent);
      if (!matchFn(rawKey)) return;

      var colors = colorFn(rawKey);
      card.classList.add(cardClass);
      card.style.setProperty(primaryVar, colors.primary);
      card.style.setProperty(secondaryVar, colors.secondary);
    });
  }

  function applyAllBreakdownColors() {
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

  function watchForDraftRenders() {
    BREAKDOWN_CONTAINER_IDS.forEach(function (containerId) {
      var container = document.getElementById(containerId);
      if (!container) return;
      new MutationObserver(function () {
        applyAllBreakdownColors();
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
        watchForDraftRenders();
        applyAllBreakdownColors();
      }, delay);
    });
  }

  function init() {
    watchForDraftRenders();
    applyAllBreakdownColors();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
