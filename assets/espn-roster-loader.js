/**
 * espn-roster-loader.js
 *
 * Loads ESPN end-of-season roster snapshots from:
 * assets/data/espn-final-rosters.csv
 *
 * Compatible headers include:
 * Season, Team, Owner, Player Name, Position, NFL Team
 *
 * Extra CSV columns are ignored safely.
 */

(function () {
  "use strict";

  var cachedRows = null;

  function parseCsv(text) {
    var rows = [];
    var row = [];
    var cell = "";
    var inQuotes = false;

    for (var i = 0; i < text.length; i++) {
      var char = text[i];
      var nextChar = text[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        row.push(cell);
        cell = "";
      } else if ((char === "\n" || char === "\r") && !inQuotes) {
        if (char === "\r" && nextChar === "\n") {
          i += 1;
        }

        row.push(cell);

        var hasContent = row.some(function (value) {
          return String(value || "").trim() !== "";
        });

        if (hasContent) {
          rows.push(row);
        }

        row = [];
        cell = "";
      } else {
        cell += char;
      }
    }

    if (cell !== "" || row.length > 0) {
      row.push(cell);

      var finalRowHasContent = row.some(function (value) {
        return String(value || "").trim() !== "";
      });

      if (finalRowHasContent) {
        rows.push(row);
      }
    }

    return rows;
  }

  function normalizeHeader(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "");
  }

  function findColumn(headerMap, possibleNames) {
    for (var i = 0; i < possibleNames.length; i++) {
      var key = normalizeHeader(possibleNames[i]);

      if (headerMap[key] !== undefined) {
        return headerMap[key];
      }
    }

    return -1;
  }

  function cellValue(row, columnIndex) {
    if (columnIndex < 0 || row[columnIndex] === undefined) {
      return "";
    }

    return String(row[columnIndex]).trim();
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
    var parsedRows = parseCsv(text);

    if (!parsedRows || parsedRows.length < 2) {
      throw new Error("The ESPN final-roster CSV has no roster rows.");
    }

    var headerMap = {};

    parsedRows[0].forEach(function (header, index) {
      headerMap[normalizeHeader(header)] = index;
    });

    /*
     * Supports both your actual header names:
     * Season, Team, Owner, Player Name, Position, NFL Team
     *
     * and the alternate camelCase names used in earlier examples.
     */
    var seasonColumn = findColumn(headerMap, [
      "season",
      "year",
    ]);

    var teamColumn = findColumn(headerMap, [
      "team",
      "teamName",
      "fantasyTeam",
      "fantasyTeamName",
    ]);

    var ownerColumn = findColumn(headerMap, [
      "owner",
      "ownerName",
      "manager",
      "displayName",
    ]);

    var playerColumn = findColumn(headerMap, [
      "playerName",
      "player",
      "name",
    ]);

    var positionColumn = findColumn(headerMap, [
      "position",
      "pos",
    ]);

    var nflTeamColumn = findColumn(headerMap, [
      "nflTeam",
      "nfl",
      "proTeam",
      "teamAbbr",
    ]);

    var missingColumns = [];

    if (seasonColumn === -1) missingColumns.push("Season");
    if (teamColumn === -1) missingColumns.push("Team");
    if (ownerColumn === -1) missingColumns.push("Owner");
    if (playerColumn === -1) missingColumns.push("Player Name");
    if (positionColumn === -1) missingColumns.push("Position");
    if (nflTeamColumn === -1) missingColumns.push("NFL Team");

    if (missingColumns.length > 0) {
      throw new Error(
        "Missing roster CSV column(s): " +
          missingColumns.join(", ") +
          ". Found headers: " +
          parsedRows[0].join(", ")
      );
    }

    cachedRows = parsedRows
      .slice(1)
      .map(function (row) {
        return {
          season: Number(cellValue(row, seasonColumn)),
          teamName: cellValue(row, teamColumn),
          owner: cellValue(row, ownerColumn),
          playerName: cellValue(row, playerColumn),
          position: cellValue(row, positionColumn),
          nflTeam: cellValue(row, nflTeamColumn),
        };
      })
      .filter(function (row) {
        // Ignores blank rows and malformed rows that appear later in the CSV.
        return (
          Number.isFinite(row.season) &&
          row.season > 0 &&
          row.teamName &&
          row.owner &&
          row.playerName
        );
      });

    return cachedRows;
  }

  async function loadSeasonRoster(season) {
    var selectedSeason = Number(season);
    var allRows = await loadAllRows();

    var seasonRows = allRows.filter(function (row) {
      return row.season === selectedSeason;
    });

    var teamsByOwner = {};

    seasonRows.forEach(function (row) {
      var owner = row.owner || row.teamName || "Unknown Owner";
      var teamName = row.teamName || owner;

      /*
       * Uses owner + team name as the grouping key. This protects against
       * any rare case of one owner appearing with a different team name
       * during the same historical season.
       */
      var teamKey = owner + "||" + teamName;

      if (!teamsByOwner[teamKey]) {
        teamsByOwner[teamKey] = {
          owner: owner,
          teamName: teamName,
          players: [],
        };
      }

      teamsByOwner[teamKey].players.push({
        playerName: row.playerName,
        position: row.position || "-",
        nflTeam: row.nflTeam || "-",

        /*
         * Your historical CSV is a final-roster list, not a weekly lineup.
         * It does not identify starter, bench, IR, or keeper status.
         */
        slot: "Final Roster",
        isStarter: false,
        isKeeper: false,
      });
    });

    var teams = Object.keys(teamsByOwner)
      .map(function (teamKey) {
        var team = teamsByOwner[teamKey];

        team.players.sort(function (a, b) {
          return a.playerName.localeCompare(b.playerName);
        });

        return team;
      })
      .sort(function (a, b) {
        return a.teamName.localeCompare(b.teamName);
      });

    return {
      season: selectedSeason,
      teams: teams,
    };
  }

  window.EspnRosterLoader = {
    loadSeasonRoster: loadSeasonRoster,
  };
})();
