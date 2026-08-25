/**
 * nfl-team-colors.js
 *
 * Shared NFL-team color lookup for the league-history site.
 * Each entry includes a primary, secondary, and contrast color. The draft
 * tab uses these for compact team badges and two-color NFL-team cards in
 * the "By NFL Team" breakdown.
 */

(function () {
  "use strict";

  var COLORS = {
    ARI: { primary: "#97233F", secondary: "#000000", contrast: "#FFFFFF" },
    ATL: { primary: "#A71930", secondary: "#000000", contrast: "#FFFFFF" },
    BAL: { primary: "#241773", secondary: "#9E7C0C", contrast: "#FFFFFF" },
    BUF: { primary: "#00338D", secondary: "#C60C30", contrast: "#FFFFFF" },
    CAR: { primary: "#0085CA", secondary: "#101820", contrast: "#FFFFFF" },
    CHI: { primary: "#0B162A", secondary: "#C83803", contrast: "#FFFFFF" },
    CIN: { primary: "#FB4F14", secondary: "#000000", contrast: "#111111" },
    CLE: { primary: "#311D00", secondary: "#FF3C00", contrast: "#FFFFFF" },
    DAL: { primary: "#003594", secondary: "#869397", contrast: "#FFFFFF" },
    DEN: { primary: "#FB4F14", secondary: "#002244", contrast: "#111111" },
    DET: { primary: "#0076B6", secondary: "#B0B7BC", contrast: "#FFFFFF" },
    GB: { primary: "#203731", secondary: "#FFB612", contrast: "#FFFFFF" },
    HOU: { primary: "#03202F", secondary: "#A71930", contrast: "#FFFFFF" },
    IND: { primary: "#002C5F", secondary: "#A2AAAD", contrast: "#FFFFFF" },
    JAX: { primary: "#006778", secondary: "#D7A22A", contrast: "#FFFFFF" },
    KC: { primary: "#E31837", secondary: "#FFB81C", contrast: "#FFFFFF" },
    LAC: { primary: "#0080C6", secondary: "#FFC20E", contrast: "#FFFFFF" },
    LAR: { primary: "#003594", secondary: "#FFA300", contrast: "#FFFFFF" },
    LV: { primary: "#000000", secondary: "#A5ACAF", contrast: "#FFFFFF" },
    MIA: { primary: "#008E97", secondary: "#FC4C02", contrast: "#FFFFFF" },
    MIN: { primary: "#4F2683", secondary: "#FFC62F", contrast: "#FFFFFF" },
    NE: { primary: "#002244", secondary: "#C60C30", contrast: "#FFFFFF" },
    NO: { primary: "#D3BC8D", secondary: "#101820", contrast: "#111111" },
    NYG: { primary: "#0B2265", secondary: "#A71930", contrast: "#FFFFFF" },
    NYJ: { primary: "#125740", secondary: "#FFFFFF", contrast: "#FFFFFF" },
    PHI: { primary: "#004C54", secondary: "#A5ACAF", contrast: "#FFFFFF" },
    PIT: { primary: "#FFB612", secondary: "#101820", contrast: "#111111" },
    SEA: { primary: "#002244", secondary: "#69BE28", contrast: "#FFFFFF" },
    SF: { primary: "#AA0000", secondary: "#B3995D", contrast: "#FFFFFF" },
    TB: { primary: "#D50A0A", secondary: "#34302B", contrast: "#FFFFFF" },
    TEN: { primary: "#0C2340", secondary: "#4B92DB", contrast: "#FFFFFF" },
    WAS: { primary: "#5A1414", secondary: "#FFB612", contrast: "#FFFFFF" }
  };

  function get(team) {
    return COLORS[String(team || "").trim().toUpperCase()] || {
      primary: "#48505c",
      secondary: "#717b8a",
      contrast: "#FFFFFF"
    };
  }

  window.NflTeamColors = {
    COLORS: COLORS,
    get: get
  };
})();
