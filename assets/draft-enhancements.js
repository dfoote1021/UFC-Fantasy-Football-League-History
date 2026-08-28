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
 *    a corner badge (see season.css .is-keeper-pick::after) - a color
 *    not used anywhere else on the site, deliberately distinct from
 *    every NFL team color and every position color.
 *
 * Player names and text content are never modified - only classes and
 * CSS custom properties are added to existing cards.
 *
 * Heading search for breakdown boxes checks h2/h3/h4/h5/.breakdown-heading
 * (not just h3), plus a page-wide fallback pass that infers grid type
 * directly from card labels, since different breakdown sections on this
 * site use different heading tag levels / nesting.
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

  // Finds the .breakdown-grid immediately following ANY heading-like
  // element (h2/h3/h4/h5, or .breakdown-heading class) whose text matches
  // headingMatch, searched anywhere inside container.
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

    // Fallback safety net: scan every .breakdown-grid on the page directly
    // and infer its type from its own cards' labels, so nothing is missed
    // even if heading matching above fails to find a container match.
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

  function applyPickCardColors() {
    PICK_BOARD_CONTAINER_IDS.forEach(function (containerId) {
      var container = document.getElementById(containerId);
      if (!container) return;

      container.querySelectorAll(".draft-pick").forEach(function (card) {
        // Position coloring.
        if (card.dataset.posColored !== "1") {
          var lines = card.querySelectorAll("div");
          var position = null;
          for (var i = 0; i < lines.length; i++) {
            position = extractPositionFromText(lines[i].textContent);
            if (position) break;
          }
          if (position) {
            var colors = getPositionColors(position);
            card.classList.add("position-draft-pick");
            card.style.setProperty("--pos-primary", colors.primary);
            card.style.setProperty("--pos-secondary", colors.secondary);
            card.dataset.posColored = "1";
          }
        }

        // Keeper corner badge - independent of position coloring above.
        if (card.dataset.keeperChecked !== "1") {
          var text = card.textContent || "";
          if (/\bKEEPER\b/i.test(text)) {
            card.classList.add("is-keeper-pick");
          }
          card.dataset.keeperChecked = "1";
        }
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

    [0, 100, 300, 700, 1500, 3000, 6000, 10000].forEach(function (delay) {
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
