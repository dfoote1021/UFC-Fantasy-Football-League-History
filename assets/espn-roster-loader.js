/**
 * espn-roster-loader.js
 *
 * Loads final ESPN end-of-season roster snapshots from:
 * assets/data/espn-final-rosters.csv
 *
 * CSV headers required:
 * season,teamName,owner,playerName,position,nflTeam
 */

(function () {
  "use strict";

  var cachedRows = null;

  function parseCsv(text) {
    var rows = [];
    var currentRow = [];
    var currentCell = "";
    var inQuotes = false;

    for (var i = 0; i < text.length; i++) {
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

  async function loadAllRows() {
    if (cachedRows) return cachedRows;

    var response = await fetch("assets/data/espn-final-rosters.csv");

    if (!response.ok) {
      throw new Error(
        "Could not load assets/data/espn-final-rosters.csv (HTTP " +
          response.status +
          ")"
      );
    }

    var rows = parseCsv(await response.text());

    if (!rows || rows.length < 2) {
      throw new Error("The ESPN final-roster CSV is empty.");
    }

    var headers = rows[0].map(function (header) {
      return String(header || "").trim().toLowerCase();
    });

    function col(name) {
      return headers.indexOf(name);
    }

    var seasonCol = col("season");
    var teamNameCol = col("teamname");
    var ownerCol = col("owner");
    var playerNameCol = col("playername");
    var positionCol = col("position");
    var nflTeamCol = col("nflteam");

    var requiredColumns = [
      { name: "season", index: seasonCol },
      { name: "teamName", index: teamNameCol },
      { name: "owner", index: ownerCol },
      { name: "playerName", index: playerNameCol },
      { name: "position", index: positionCol },
      { name: "nflTeam", index: nflTeamCol },
    ];

    requiredColumns.forEach(function (column) {
      if (column.index === -1) {
        throw new Error(
          "Missing required CSV column: " +
            column.name +
            ". Expected: season,teamName,owner,playerName,position,nflTeam"
        );
      }
    });

    cachedRows = rows.slice(1).map(function (row) {
      return {
        season: Number(row[seasonCol] || 0),
        teamName: String(row[teamNameCol] || "").trim(),
        owner: String(row[ownerCol] || "").trim(),
        playerName: String(row[playerNameCol] || "").trim(),
        position: String(row[positionCol] || "").trim(),
        nflTeam: String(row[nflTeamCol] || "").trim(),
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

      teamsByOwner[owner].players.push({
        playerName: row.playerName || "Unknown Player",
        position: row.position || "-",
        nflTeam: row.nflTeam || "-",

        // Your CSV is an end-of-season roster list only, not a weekly
        // lineup export. Therefore, it does not identify starters/bench/IR.
        slot: "Final Roster",
        isStarter: false,
        isKeeper: false,
      });
    });

    var teams = Object.keys(teamsByOwner)
      .map(function (owner) {
        var team = teamsByOwner[owner];

        team.players.sort(function (a, b) {
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
