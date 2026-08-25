/**
 * draft-enhancements.js
 *
 * NFL team-color enhancements for the Draft tab, without changing season.js.
 *
 * - Adds a compact NFL badge next to player metadata.
 * - Styles By NFL Team breakdown cards with a solid secondary-color box and
 *   primary-color text for better readability.
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

  function addNflBadge(meta) {
    if (!meta || meta.dataset.nflBadgeApplied === "true") return;

    var rawText = meta.textContent || "";
    var parts = rawText.split(" - ");
    var nflTeam = normalizeTeam(parts.length > 1 ? parts[parts.length - 1] : "");

    if (!/^[A-Z]{2,3}$/.test(nflTeam)) return;

    var colors = getTeamColors(nflTeam);
    var badge = document.createElement("span");
    badge.className = "nfl-team-badge";
    badge.textContent = nflTeam;
    badge.style.backgroundColor = colors.secondary;
    badge.style.color = colors.primary;
    badge.style.borderColor = colors.primary;

    meta.textContent = parts.length > 1 ? parts.slice(0, -1).join(" - ") + " " : "";
    meta.appendChild(badge);
    meta.dataset.nflBadgeApplied = "true";
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

  function enhanceDraft() {
    document.querySelectorAll("#draft-board .draft-meta").forEach(addNflBadge);
    colorNflBreakdownCards();
  }

  function observeDraftChanges() {
    var board = document.getElementById("draft-board");
    var breakdown = document.getElementById("draft-breakdown");

    if (board) {
      new MutationObserver(enhanceDraft).observe(board, {
        childList: true,
        subtree: true
      });
    }

    if (breakdown) {
      new MutationObserver(enhanceDraft).observe(breakdown, {
        childList: true,
        subtree: true
      });
    }
  }

  function init() {
    observeDraftChanges();
    enhanceDraft();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
