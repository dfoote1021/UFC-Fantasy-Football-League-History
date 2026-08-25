/**
 * draft-enhancements.js
 *
 * Adds two presentation/data enhancements without modifying season.js:
 * 1. Gold KEEPER labels to Sleeper draft picks listed in keeper-overrides.js.
 * 2. NFL team-color badges beside draft-player metadata and team-colored
 *    cards in the "By NFL Team" draft breakdown.
 *
 * Required scripts, in this order, immediately before season.js in index.html:
 *   <script src="assets/keeper-overrides.js"></script>
 *   <script src="assets/nfl-team-colors.js"></script>
 *   <script src="assets/draft-enhancements.js"></script>
 *   <script src="assets/season.js"></script>
 */

(function () {
  "use strict";

  function currentSeason() {
    var select = document.getElementById("season-select");
    if (!select || select.value === "alltime") return null;
    var year = Number(select.value);
    return isNaN(year) ? null : year;
  }

  function isEspnSeason(year) {
    return !!(
      window.EspnLoader &&
      window.EspnLoader.ESPN_SEASONS &&
      window.EspnLoader.ESPN_SEASONS.indexOf(year) !== -1
    );
  }

  function normalizeTeam(value) {
    return String(value || "").trim().toUpperCase();
  }

  function getTeamColors(team) {
    if (window.NflTeamColors && typeof window.NflTeamColors.get === "function") {
      return window.NflTeamColors.get(team);
    }
    return { primary: "#48505c", contrast: "#ffffff" };
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
    badge.style.backgroundColor = colors.primary;
    badge.style.color = colors.contrast;

    meta.textContent = parts.length > 1 ? parts.slice(0, -1).join(" - ") + " " : "";
    meta.appendChild(badge);
    meta.dataset.nflBadgeApplied = "true";
  }

  function addKeeperBadge(pick, season) {
    if (!pick || pick.dataset.keeperChecked === "true") return;

    var playerNameEl = pick.querySelector(".pick-num + div");
    if (!playerNameEl || !window.KeeperOverrides || typeof window.KeeperOverrides.isKeeper !== "function") {
      pick.dataset.keeperChecked = "true";
      return;
    }

    var playerName = (playerNameEl.childNodes[0] && playerNameEl.childNodes[0].textContent)
      ? playerNameEl.childNodes[0].textContent.trim()
      : playerNameEl.textContent.trim();

    if (window.KeeperOverrides.isKeeper(season, playerName)) {
      var existing = pick.querySelector(".keeper-badge");
      if (!existing) {
        var badge = document.createElement("span");
        badge.className = "keeper-badge";
        badge.textContent = "KEEPER";
        playerNameEl.appendChild(document.createTextNode(" "));
        playerNameEl.appendChild(badge);
        pick.classList.add("keeper-pick");
      }
    }

    pick.dataset.keeperChecked = "true";
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

    var cards = grid.querySelectorAll(".breakdown-card");
    cards.forEach(function (card) {
      var label = card.querySelector(".breakdown-card-label");
      if (!label || card.dataset.nflColorApplied === "true") return;

      var nflTeam = normalizeTeam(label.textContent);
      if (!/^[A-Z]{2,3}$/.test(nflTeam) || nflTeam === "UNKNOWN") return;

      var colors = getTeamColors(nflTeam);
      card.style.borderColor = colors.primary;
      card.style.boxShadow = "inset 0 3px 0 " + colors.primary;
      label.style.color = colors.primary;
      card.dataset.nflColorApplied = "true";
    });
  }

  function enhanceDraft() {
    var season = currentSeason();
    if (!season) return;

    document.querySelectorAll("#draft-board .draft-meta").forEach(addNflBadge);

    // ESPN already has keeper values from espn-draft.csv. The manual
    // override only applies to Sleeper years, where that API field is absent.
    if (!isEspnSeason(season)) {
      document.querySelectorAll("#draft-board .draft-pick").forEach(function (pick) {
        addKeeperBadge(pick, season);
      });
    }

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
