/**
 * draft-enhancements.js
 *
 * NFL colors for the Draft tab's "By NFL Team" breakdown only.
 *
 * This file intentionally does NOT modify player metadata. Draft cards keep
 * their normal readable "Position - NFL Team" text, for example: WR - KC.
 *
 * Required script order in index.html:
 *   <script src="assets/nfl-team-colors.js"></script>
 *   <script src="assets/draft-enhancements.js"></script>
 *   <script src="assets/season.js"></script>
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
      secondary: "#717b8a",
      contrast: "#ffffff"
    };
  }

  function colorNflBreakdownCards() {
    var breakdown = document.getElementById("draft-breakdown");
    if (!breakdown) return;

    var headings = breakdown.querySelectorAll("h3");
    var nflHeading = null;

    for (var i = 0; i < headings.length; i++) {
      if ((headings[i].textContent || "").trim().toLowerCase() === "by nfl team") {
        nflHeading = headings[i];
        break;
      }
    }

    if (!nflHeading) return;

    var grid = nflHeading.nextElementSibling;
    if (!grid || !grid.classList.contains("breakdown-grid")) return;

    grid.querySelectorAll(".breakdown-card").forEach(function (card) {
      var label = card.querySelector(".breakdown-card-label");
      if (!label || card.dataset.nflColorApplied === "true") return;

      var nflTeam = normalizeTeam(label.textContent);
      if (!/^[A-Z]{2,3}$/.test(nflTeam) || nflTeam === "UNKNOWN") return;

      var colors = getTeamColors(nflTeam);
      card.classList.add("nfl-breakdown-card");
      card.style.setProperty("--nfl-primary", colors.primary);
      card.style.setProperty("--nfl-secondary", colors.secondary);
      card.dataset.nflColorApplied = "true";
    });
  }

  function observeBreakdownChanges() {
    var breakdown = document.getElementById("draft-breakdown");
    if (!breakdown) return;

    new MutationObserver(colorNflBreakdownCards).observe(breakdown, {
      childList: true,
      subtree: true
    });
  }

  function init() {
    observeBreakdownChanges();
    colorNflBreakdownCards();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
