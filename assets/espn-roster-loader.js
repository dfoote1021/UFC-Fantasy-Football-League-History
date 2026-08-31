/**
 * espn-roster-loader.js
 *
 * Loads end-of-season ESPN roster snapshots from:
 * assets/data/espn-final-rosters.csv
 *
 * Expected CSV columns:
 * season,teamName,owner,playerName,position,nflTeam,slot,isStarter,isKeeper
 */

(function () {
  "use strict";

  var cachedRows = null;

  function parseCsv(text) {
    var rows = [];
    var currentRow = [];
    var currentCell = "";
    var inQuotes = false;
    var i;

    for (i = 0; i < text.length; i++) {
      var ch = text[i];
      var next = text[i + 1];

      if (ch === '"') {
        if (inQuotes && next === '"') {
          currentCell += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        currentRow.push(currentCell);
        currentCell = "";
      } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
        if (ch === "\r" && next === "\n") {
          i++;
        }

        currentRow.push(currentCell);

        if (
          currentRow.length > 1 ||
          (currentRow.length === 1 && currentRow[0].trim() !== "")
        ) {
          rows.push(currentRow);
        }

        currentRow = [];
        currentCell = "";
      } else {
        currentCell += ch;
      }
    }

    if (currentCell !== "" || currentRow.length > 0) {
      currentRow.push(currentCell);
      rows.push(currentRow);
    }

    return rows;
  }

  function normalizeHeader(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "");
  }

  function parseBoolean(value) {
    var normalized = String(value || "")
      .trim()
      .toLowerCase();

    return (
      normalized === "true" ||
      normalized === "1" ||
      normalized === "yes" ||
      normalized === "y" ||
      normalized === "starter" ||
      normalized === "keeper"
    );
  }

  function valueAt(row, headerMap, names) {
    var i;

    for (i = 0; i < names.length; i++) {
      var key = normalizeHeader(names[i]);

      if (headerMap[key] !== undefined) {
        return String(row[headerMap[key]] || "").trim();
      }
    }

    return "";
  }

  async function loadAllRows() {
    if (cachedRows) {
      return cachedRows;
    }

    var response = await fetch("assets/data/espn-final-rosters.csv");

    if (!response.ok) {
      throw new Error(
        "Could not load assets/data/espn-final-rosters.csv (HTTP " +
          response.status +
          ")"
      );
    }

    var text = await response.text();
    var table = parseCsv(text);

    if (!table || table.length < 2) {
      throw new Error("The ESPN final-roster CSV is empty or has no data rows.");
    }

    var headers = table[0];
    var headerMap = {};

    headers.forEach(function (header, index) {
      headerMap[normalizeHeader(header)] = index;
    });

    cachedRows = table.slice(1).map(function (row) {
      return {
        season: Number(
          valueAt(row, headerMap, ["season", "year"])
        ),

        teamName: valueAt(row, headerMap, [
          "teamName",
          "team",
          "fantasyTeam",
          "fantasyTeamName",
        ]),

        owner: valueAt(row, headerMap, [
          "owner",
          "ownerName",
          "manager",
          "displayName",
        ]),

        playerName: valueAt(row, headerMap, [
          "playerName",
          "player",
          "name",
        ]),

        position: valueAt(row, headerMap, [
          "position",
          "pos",
        ]),

        nflTeam: valueAt(row, headerMap, [
          "nflTeam",
          "nfl",
          "proTeam",
          "teamAbbr",
        ]),

        slot: valueAt(row, headerMap, [
          "slot",
          "rosterSlot",
          "lineupSlot",
          "status",
        ]),

        isStarter: parseBoolean(
          valueAt(row, headerMap, [
            "isStarter",
            "starter",
          ])
        ),

        isKeeper: parseBoolean(
          valueAt(row, headerMap, [
            "isKeeper",
            "keeper",
          ])
        ),
      };
    });

    return cachedRows;
  }

  async function loadSeasonRoster(season) {
    var year = Number(season);
    var rows = await loadAllRows();

    var seasonRows = rows.filter(function (row) {
      return row.season === year;
    });

    var teamsByOwner = {};

    seasonRows.forEach(function (row) {
      var owner = row.owner || row.teamName || "Unknown Owner";
      var teamName = row.teamName || owner;

      if (!teamsByOwner[owner]) {
        teamsByOwner[owner] = {
          owner: owner,
          teamName: teamName,
          players: [],
        };
      }

      var slot = row.slot || (row.isStarter ? "Starter" : "Bench");

      teamsByOwner[owner].players.push({
        playerName: row.playerName || "Unknown Player",
        position: row.position || "-",
        nflTeam: row.nflTeam || "-",
        slot: slot,
        isStarter: row.isStarter,
        isKeeper: row.isKeeper,
      });
    });

    var teams = Object.keys(teamsByOwner)
      .map(function (owner) {
        var team = teamsByOwner[owner];

        // Sort roster display: starting lineup first, then bench, then IR;
        // within each group, sort alphabetically by player name.
        team.players.sort(function (a, b) {
          function slotRank(player) {
            if (player.slot === "IR") return 3;
            if (player.isStarter) return 1;
            return 2;
          }

          var rankA = slotRank(a);
          var rankB = slotRank(b);

          if (rankA !== rankB) {
            return rankA - rankB;
          }

          return a.playerName.localeCompare(b.playerName);
        });

        return team;
      })
      .sort(function (a, b) {
        return a.teamName.localeCompare(b.teamName);
      });

    return {
      season: year,
      teams: teams,
    };
  }

  window.EspnRosterLoader = {
    loadSeasonRoster: loadSeasonRoster,
  };
})();
