/**
 * draft-enhancements.js
 *
 * Reliably applies NFL colors to the Draft tab's "By NFL Team" breakdown.
 * It does not modify player cards; they remain normal "Position - Team" text.
 *
 * Load after nfl-team-colors.js and before or after season.js. This script
 * retries after the page's async draft renderer builds/rebuilds the cards.
 */

(function () {
  "use strict";

  function normalizeTeam(value) {
    return String(value || "").trim().toUpperCase();
  }

  function getTeamColors(team) {
    if (window.NflTeamColors && typeof window.NflTeamColors.get === "function") {
      return window.NflTeamColors.get(team);
    }
    return {
      primary: "#48505c",
      secondary: "#717b8a"
    };
  }

  function getNflTeamGrid() {
    var breakdown = document.getElementById("draft-breakdown");
    if (!breakdown) return null;

    var headings = breakdown.querySelectorAll("h3");
    for (var i = 0; i < headings.length; i++) {
      var headingText = (headings[i].textContent || "").trim().toLowerCase();
      if (headingText === "by nfl team") {
        var grid = headings[i].nextElementSibling;
        if (grid && grid.classList.contains("breakdown-grid")) return grid;
      }
    }

    return null;
  }

  function applyNflBreakdownColors() {
    var grid = getNflTeamGrid();
    if (!grid) return;

    grid.querySelectorAll(".breakdown-card").forEach(function (card) {
      var label = card.querySelector(".breakdown-card-label");
      if (!label) return;

      var nflTeam = normalizeTeam(label.textContent);
      if (!/^[A-Z]{2,3}$/.test(nflTeam) || nflTeam === "UNKNOWN") return;

      var colors = getTeamColors(nflTeam);
      card.classList.add("nfl-breakdown-card");
      card.style.setProperty("--nfl-primary", colors.primary);
      card.style.setProperty("--nfl-secondary", colors.secondary);
    });
  }

  function watchForDraftRenders() {
    var breakdown = document.getElementById("draft-breakdown");
    if (breakdown) {
      new MutationObserver(function () {
        applyNflBreakdownColors();
      }).observe(breakdown, {
        childList: true,
        subtree: true
      });
    }

    // season.js renders draft data asynchronously. These short retries cover
    // initial load, changing seasons, and changing the team filter.
    [0, 100, 300, 700, 1500, 3000].forEach(function (delay) {
      window.setTimeout(applyNflBreakdownColors, delay);
    });
  }

  function init() {
    watchForDraftRenders();
    applyNflBreakdownColors();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
