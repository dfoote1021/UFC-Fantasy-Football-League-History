/* roster-stats.js
   Adds historical NFL team + weekly stat lines to the Sleeper "Weekly Rosters" table.
   ESPN seasons are untouched. Load this AFTER sleeper-common.js and BEFORE season.js. */
(function () {
    "use strict";
    var API = window.SleeperAPI;
    if (!API || typeof API.buildWeeklyRoster !== "function") return;

    var original = API.buildWeeklyRoster;
    var pending = null;
    var statsCache = {};
    var applying = false;

    function n(s, k) { var v = Number(s && s[k]); return isFinite(v) ? v : 0; }

    function formatStats(s, pos) {
        if (!s) return "";
        var parts = [];
        pos = String(pos || "").toUpperCase();
        if (pos === "QB") {
            if (n(s, "pass_att")) parts.push(n(s, "pass_cmp") + "/" + n(s, "pass_att") + ", " + n(s, "pass_yd") + " YDS, " + n(s, "pass_td") + " TD, " + n(s, "pass_int") + " INT");
            if (n(s, "rush_att")) parts.push(n(s, "rush_att") + " CAR, " + n(s, "rush_yd") + " YDS" + (n(s, "rush_td") ? ", " + n(s, "rush_td") + " TD" : ""));
        } else if (pos === "K") {
            if (n(s, "fga") || n(s, "fgm")) parts.push("FG " + n(s, "fgm") + "/" + n(s, "fga"));
            if (n(s, "xpa") || n(s, "xpm")) parts.push("XP " + n(s, "xpm") + "/" + n(s, "xpa"));
        } else if (pos === "DEF" || pos === "DST") {
            parts.push(n(s, "sack") + " SCK");
            parts.push(n(s, "int") + " INT");
            if (n(s, "fum_rec")) parts.push(n(s, "fum_rec") + " FR");
            var tds = n(s, "def_td") + n(s, "def_st_td");
            if (tds) parts.push(tds + " TD");
            if (s.pts_allow !== undefined) parts.push(n(s, "pts_allow") + " PA");
        } else {
            if (n(s, "rush_att")) parts.push(n(s, "rush_att") + " CAR, " + n(s, "rush_yd") + " YDS" + (n(s, "rush_td") ? ", " + n(s, "rush_td") + " TD" : ""));
            if (n(s, "rec") || n(s, "rec_tgt")) parts.push(n(s, "rec") + (n(s, "rec_tgt") ? "/" + n(s, "rec_tgt") : "") + " REC, " + n(s, "rec_yd") + " YDS" + (n(s, "rec_td") ? ", " + n(s, "rec_td") + " TD" : ""));
            if (n(s, "fum_lost")) parts.push(n(s, "fum_lost") + " FUM");
        }
        return parts.join(" | ");
    }

    function parseWeekStats(data) {
        var map = {};
        if (Array.isArray(data)) {
            data.forEach(function (row) {
                if (!row || !row.player_id) return;
                map[row.player_id] = { team: row.team || null, stats: row.stats || row };
            });
        } else if (data && typeof data === "object") {
            Object.keys(data).forEach(function (id) {
                var v = data[id];
                if (!v || typeof v !== "object") return;
                map[id] = { team: v.team || null, stats: v.stats || v };
            });
        }
        return map;
    }

    function getWeekStats(season, week) {
        var key = season + "-" + week;
        if (statsCache[key]) return statsCache[key];
        var url = "https://api.sleeper.com/stats/nfl/" + season + "/" + week + "?season_type=regular";
        statsCache[key] = fetch(url)
            .then(function (res) { if (!res.ok) throw new Error("stats " + res.status); return res.json(); })
            .then(parseWeekStats)
            .catch(function (err) { console.warn("Roster stats unavailable", err); return {}; });
        return statsCache[key];
    }

    API.buildWeeklyRoster = function (matchups, rosterId, playersMap) {
        var out = original.apply(this, arguments);
        try {
            var side = (matchups || []).filter(function (m) { return m.roster_id === rosterId; })[0];
            var nameToId = {};
            ((side && side.players) || []).forEach(function (id) {
                var meta = (playersMap && playersMap[id]) || {};
                var name = meta.full_name || (meta.first_name ? meta.first_name + " " + meta.last_name : id);
                nameToId[name] = id;
            });
            pending = { nameToId: nameToId };
        } catch (e) { pending = null; }
        return out;
    };

    function isEspnSelected() {
        var sel = document.getElementById("season-select");
        if (!sel || !sel.options[sel.selectedIndex]) return false;
        return /ESPN/i.test(sel.options[sel.selectedIndex].textContent);
    }

    function ensureHeader(show) {
        var table = document.getElementById("roster-table");
        if (!table) return;
        var headRow = table.querySelector("thead tr");
        if (!headRow) return;
        var existing = headRow.querySelector("th[data-rs]");
        if (show && !existing) {
            var th = document.createElement("th");
            th.setAttribute("data-rs", "1");
            th.textContent = "Stats";
            headRow.appendChild(th);
        } else if (!show && existing) {
            existing.remove();
        }
    }

    function apply() {
        if (applying) return;
        var tbody = document.querySelector("#roster-table tbody");
        if (!tbody) return;
        if (isEspnSelected()) { ensureHeader(false); pending = null; return; }
        if (!pending) return;
        var rows = Array.prototype.slice.call(tbody.querySelectorAll("tr"));
        if (!rows.length || rows.some(function (tr) { return tr.querySelectorAll("td").length < 5; })) return;
        var ctx = pending;
        pending = null;

        var seasonSel = document.getElementById("season-select");
        var weekSel = document.getElementById("roster-week-select");
        var season = seasonSel ? seasonSel.value : null;
        var week = weekSel ? weekSel.value : null;
        if (!season || !week) return;

        applying = true;
        ensureHeader(true);
        rows.forEach(function (tr) {
            var td = document.createElement("td");
            td.className = "roster-stats-cell";
            td.textContent = "\u2026";
            tr.appendChild(td);
        });
        applying = false;

        getWeekStats(season, week).then(function (statsById) {
            if (isEspnSelected()) return;
            applying = true;
            rows.forEach(function (tr) {
                var cells = tr.querySelectorAll("td");
                var statCell = tr.querySelector("td.roster-stats-cell");
                if (!statCell) return;
                var name = cells[1] ? cells[1].textContent.replace(/\s+/g, " ").trim() : "";
                var pos = cells[2] ? cells[2].textContent.trim() : "";
                var id = ctx.nameToId[name];
                if (!id) {
                    Object.keys(ctx.nameToId).some(function (k) {
                        if (name.indexOf(k) === 0) { id = ctx.nameToId[k]; return true; }
                        return false;
                    });
                }
                var row = id ? statsById[id] : null;
                if (row && row.team && cells[3]) cells[3].textContent = row.team;
                var text = row ? formatStats(row.stats, pos) : "";
                statCell.textContent = text || "\u2014";
            });
            applying = false;
        });
    }

    function init() {
        var style = document.createElement("style");
        style.textContent = ".roster-stats-cell{font-size:.85em;opacity:.9;white-space:normal;min-width:180px}";
        document.head.appendChild(style);
        var tbody = document.querySelector("#roster-table tbody");
        if (!tbody) return;
        new MutationObserver(function () { apply(); }).observe(tbody, { childList: true });
        var seasonSel = document.getElementById("season-select");
        if (seasonSel) seasonSel.addEventListener("change", function () { if (isEspnSelected()) ensureHeader(false); });
    }

    window.RosterStats = { formatStats: formatStats, parseWeekStats: parseWeekStats };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
