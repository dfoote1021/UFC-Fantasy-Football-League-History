/**
 * draft-enhancements.js
 *
 * 1. Applies NFL team colors to every "By NFL Team" draft breakdown box,
 *    and distinct position colors to every "By Position" draft breakdown
 *    box, in both the single-season Draft tab and the All-Time Draft tab
 *    (including the separate Keepers Breakdown section there).
 * 2. Applies the same position colors to every individual pick card on
 *    the draft board itself (#draft-board and #alltime-draft-by-year),
 *    coloring the card by the drafted player's position.
 * 3. Marks any pick card containing "KEEPER" text with a class that adds
 *    a corner badge (see season.css .is-keeper-pick::after).
 *
 * IMPORTANT TIMING NOTE: the All-Time Draft tab renders many years of
 * picks, and individual year sections can attach to the DOM well after
 * the initial fixed-delay retries below have already fired (confirmed
 * via DOM inspection - a card can exist with data-pos-colored="1" set
 * but never receive is-keeper-pick, because the one-time retry list
 * finished before that particular card was added). To make this robust
 * regardless of how the page renders, applyKeeperBadges() runs on BOTH
 * the fixed retry schedule AND a standing setInterval that keeps running
 * for the life of the page - it is a cheap no-op once a card is already
 * tagged (classList.add on an existing class does nothing), so running
 * it repeatedly forever has no real cost.
 *
 * Load after nfl-team-colors.js and before or after season.js.
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

  var POSITION_LIST = ["QB", "RB", "WR", "TE", "K", "D/ST", "DST", "DEF"];

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
    var key = position === "DEF" ? "D/ST" : position;
    if (window.NflTeamColors && typeof window.NflTeamColors.getPosition === "function") {
      return window.NflTeamColors.getPosition(key);
    }
    return { primary: "#48505c", secondary: "#717b8a" };
  }

  function isNflTeamCode(value) {
    return /^[A-Z]{2,4}$/.test(value) && value !== "UNKNOWN" && POSITION_LIST.indexOf(value) === -1;
  }

  function isPositionCode(value) {
    return POSITION_LIST.indexOf(value) !== -1;
  }

  function extractPositionFromText(text) {
    var match = /^([A-Z\/]{1,4})\s*-\s*[A-Z]{2,4}$/.exec(normalizeKey(text).replace(/\s+/g, " "));
    if (!match) return null;
    var candidate = match[1];
    if (isPositionCode(candidate)) return candidate;
    return null;
  }

  function findGridByHeading(container, headingMatch) {
    if (!container) return null;
    var candidates = container.querySelectorAll("h2, h3, h4, h5, .breakdown-heading");
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      var text = (el.textContent || "").trim().toLowerCase();
      if (text === headingMatch) {
        var grid = el.nextElementSibling;
        var hops = 0;
        while (grid && !grid.classList.contains("breakdown-grid") && hops < 3) {
          if (grid.querySelector && grid.querySelector(".breakdown-grid")) {
            grid = grid.querySelector(".breakdown-grid");
            break;
          }
          grid = grid.nextElementSibling;
          hops++;
        }
        if (grid && grid.classList && grid.classList.contains("breakdown-grid")) return grid;
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
      applyColorsToGrid(nflGrid, "nfl-breakdown-card", getTeamColors, isNflTeamCode, "--nfl-primary", "--nfl-secondary");

      var posGrid = findGridByHeading(container, "by position");
      applyColorsToGrid(posGrid, "position-breakdown-card", getPositionColors, isPositionCode, "--pos-primary", "--pos-secondary");
    });

    document.querySelectorAll(".breakdown-grid").forEach(function (grid) {
      var firstLabel = grid.querySelector(".breakdown-card-label");
      if (!firstLabel) return;
      var key = normalizeKey(firstLabel.textContent);
      if (isPositionCode(key)) {
        applyColorsToGrid(grid, "position-breakdown-card", getPositionColors, isPositionCode, "--pos-primary", "--pos-secondary");
      } else if (isNflTeamCode(key)) {
        applyColorsToGrid(grid, "nfl-breakdown-card", getTeamColors, isNflTeamCode, "--nfl-primary", "--nfl-secondary");
      }
    });
  }

  function applyPositionColorsToPickCards() {
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

  // Unconditional, page-wide, un-guarded sweep - deliberately re-checks
  // every .draft-pick every time it runs (no dataset flag skip) so a
  // card that attaches to the DOM late (confirmed to happen in the
  // All-Time Draft tab) still gets tagged on the next tick, whenever
  // that tick happens to land after the card exists.
   function applyKeeperBadges() {
    document.querySelectorAll(".draft-pick").forEach(function (card) {
      if (card.classList.contains("is-keeper-pick")) return;
      var keeperEl = card.querySelector('[style*="ffd25c"]');
      var hasKeeperText = keeperEl && /KEEPER/i.test(keeperEl.textContent || "");
      if (hasKeeperText) {
        card.classList.add("is-keeper-pick");
    }
  });
}

  function applyAll() {
    applyBreakdownColors();
    applyPositionColorsToPickCards();
    applyKeeperBadges();
  }

  function watchForRenders() {
    if (document.body && document.body.dataset.draftWatching !== "1") {
      document.body.dataset.draftWatching = "1";
      new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
          if (mutations[i].addedNodes && mutations[i].addedNodes.length > 0) {
            applyAll();
            break;
          }
        }
      }).observe(document.body, {
        childList: true,
        subtree: true
      });
    }

    [0, 100, 300, 700, 1500, 3000, 6000].forEach(function (delay) {
      window.setTimeout(applyAll, delay);
    });

    // Standing interval: keeps re-checking for the life of the page.
    // Handles any pick cards that attach after all fixed retries above
    // have already fired (e.g. slow-loading All-Time year sections).
    if (!window.__draftEnhancementsInterval) {
      window.__draftEnhancementsInterval = window.setInterval(applyAll, 2000);
    }
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
