/**
 * nfl-team-colors.js
 *
 * Shared NFL-team color lookup for the league-history site.
 * Uses a primary and contrast color for every current NFL abbreviation.
 * The draft tab uses this for small team badges next to players and for
 * colored NFL-team breakdown cards.
 */

(function () {
  "use strict";

  var COLORS = {
    ARI: { primary: "#97233F", contrast: "#FFFFFF" },
    ATL: { primary: "#A71930", contrast: "#FFFFFF" },
    BAL: { primary: "#241773", contrast: "#FFFFFF" },
    BUF: { primary: "#00338D", contrast: "#FFFFFF" },
    CAR: { primary: "#0085CA", contrast: "#FFFFFF" },
    CHI: { primary: "#0B162A", contrast: "#FFFFFF" },
    CIN: { primary: "#FB4F14", contrast: "#111111" },
    CLE: { primary: "#311D00", contrast: "#FFFFFF" },
    DAL: { primary: "#003594", contrast: "#FFFFFF" },
    DEN: { primary: "#FB4F14", contrast: "#111111" },
    DET: { primary: "#0076B6", contrast: "#FFFFFF" },
    GB: { primary: "#203731", contrast: "#FFFFFF" },
    HOU: { primary: "#03202F", contrast: "#FFFFFF" },
    IND: { primary: "#002C5F", contrast: "#FFFFFF" },
    JAX: { primary: "#006778", contrast: "#FFFFFF" },
    KC: { primary: "#E31837", contrast: "#FFFFFF" },
    LAC: { primary: "#0080C6", contrast: "#FFFFFF" },
    LAR: { primary: "#003594", contrast: "#FFFFFF" },
    LV: { primary: "#000000", contrast: "#FFFFFF" },
    MIA: { primary: "#008E97", contrast: "#FFFFFF" },
    MIN: { primary: "#4F2683", contrast: "#FFFFFF" },
    NE: { primary: "#002244", contrast: "#FFFFFF" },
    NO: { primary: "#D3BC8D", contrast: "#111111" },
    NYG: { primary: "#0B2265", contrast: "#FFFFFF" },
    NYJ: { primary: "#125740", contrast: "#FFFFFF" },
    PHI: { primary: "#004C54", contrast: "#FFFFFF" },
    PIT: { primary: "#FFB612", contrast: "#111111" },
    SEA: { primary: "#002244", contrast: "#FFFFFF" },
    SF: { primary: "#AA0000", contrast: "#FFFFFF" },
    TB: { primary: "#D50A0A", contrast: "#FFFFFF" },
    TEN: { primary: "#0C2340", contrast: "#FFFFFF" },
    WAS: { primary: "#5A1414", contrast: "#FFFFFF" }
  };

  function get(team) {
    return COLORS[String(team || "").trim().toUpperCase()] || {
      primary: "#48505c",
      contrast: "#FFFFFF"
    };
  }

  window.NflTeamColors = {
    COLORS: COLORS,
    get: get
  };
})();
