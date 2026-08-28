/**
 * nfl-team-colors.js
 * Official-ish primary/secondary brand colors for all 32 NFL teams, plus a
 * distinct color per fantasy position. Exposes window.NflTeamColors.get(team)
 * returning { primary, secondary } for team codes, and
 * window.NflTeamColors.getPosition(position) returning the same shape for
 * QB/RB/WR/TE/K/D-ST, used by draft-enhancements.js to color the "By NFL
 * Team" and "By Position" draft breakdown boxes (single-season + All-Time).
 */
(function () {
  "use strict";

  var TEAM_COLORS = {
    ARI: { primary: "#97233F", secondary: "#FFB612" },
    ATL: { primary: "#A71930", secondary: "#FFFFFF" },
    BAL: { primary: "#241773", secondary: "#9E7C0C" },
    BUF: { primary: "#00338D", secondary: "#C60C30" },
    CAR: { primary: "#0085CA", secondary: "#101820" },
    CHI: { primary: "#0B162A", secondary: "#C83803" },
    CIN: { primary: "#FB4F14", secondary: "#000000" },
    CLE: { primary: "#311D00", secondary: "#FF3C00" },
    DAL: { primary: "#003594", secondary: "#869397" },
    DEN: { primary: "#FB4F14", secondary: "#002244" },
    DET: { primary: "#0076B6", secondary: "#B0B7BC" },
    GB: { primary: "#203731", secondary: "#FFB612" },
    HOU: { primary: "#03202F", secondary: "#A71930" },
    IND: { primary: "#002C5F", secondary: "#A2AAAD" },
    JAX: { primary: "#101820", secondary: "#D7A22A" },
    KC: { primary: "#E31837", secondary: "#FFB81C" },
    LAC: { primary: "#0080C6", secondary: "#FFC20E" },
    LAR: { primary: "#003594", secondary: "#FFA300" },
    LV: { primary: "#000000", secondary: "#A5ACAF" },
    MIA: { primary: "#008E97", secondary: "#FC4C02" },
    MIN: { primary: "#4F2683", secondary: "#FFC62F" },
    NE: { primary: "#002244", secondary: "#C60C30" },
    NO: { primary: "#D3BC8D", secondary: "#101820" },
    NYG: { primary: "#0B2265", secondary: "#A71930" },
    NYJ: { primary: "#125740", secondary: "#FFFFFF" },
    PHI: { primary: "#004C54", secondary: "#A5ACAF" },
    PIT: { primary: "#FFB612", secondary: "#101820" },
    SEA: { primary: "#002244", secondary: "#69BE28" },
    SF: { primary: "#AA0000", secondary: "#B3995D" },
    TB: { primary: "#D50A0A", secondary: "#FFFFFF" },
    TEN: { primary: "#0C2340", secondary: "#4B92DB" },
    WAS: { primary: "#5A1414", secondary: "#FFB612" }
  };

  // Distinct, high-contrast colors per fantasy position - deliberately
  // different from the NFL team palette above so position-mode boxes are
  // visually distinguishable from team-mode boxes at a glance.
  var POSITION_COLORS = {
    QB: { primary: "#7A2E8C", secondary: "#F3D9FF" },
    RB: { primary: "#1E6E4F", secondary: "#D6FFEC" },
    WR: { primary: "#1D5FA8", secondary: "#DCEEFF" },
    TE: { primary: "#B45309", secondary: "#FFE9C7" },
    K: { primary: "#4B5563", secondary: "#F1F2F4" },
    "D/ST": { primary: "#7A1F2B", secondary: "#FBDADA" },
    DST: { primary: "#7A1F2B", secondary: "#FBDADA" }
  };

  var DEFAULT_COLOR = { primary: "#48505c", secondary: "#717b8a" };

  function get(team) {
    if (!team) return DEFAULT_COLOR;
    var key = String(team).trim().toUpperCase();
    return TEAM_COLORS[key] || DEFAULT_COLOR;
  }

  function getPosition(position) {
    if (!position) return DEFAULT_COLOR;
    var key = String(position).trim().toUpperCase();
    return POSITION_COLORS[key] || DEFAULT_COLOR;
  }

  window.NflTeamColors = {
    TEAM_COLORS: TEAM_COLORS,
    POSITION_COLORS: POSITION_COLORS,
    get: get,
    getPosition: getPosition
  };
})();
