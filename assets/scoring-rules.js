/**
 * scoring-rules.js
 * Adds the season-specific "Scoring & Rules" tab to index.html.
 * Data transcribed from the UFC League Scoring Rules PDF (2012-2026).
 * Re-renders whenever season.js changes the season badge.
 */
(function () {
    "use strict";

    var FIRST_YEAR = 2012;
    var LAST_ESPN_YEAR = 2021;
    var YEAR_COUNT = 15;
    var SCORING_DATA = {
        // [group, section, label, run-length values [[value, years], ...] from FIRST_YEAR; null = not listed]
        rows: [
            ["Roster","","Roster size",[["16",8],["17",2],["16",5]]],
            ["Roster","","QB",[["1",15]]],
            ["Roster","","RB",[["2",15]]],
            ["Roster","","RB/WR",[["1",15]]],
            ["Roster","","WR",[["2",15]]],
            ["Roster","","WR/TE",[["1",15]]],
            ["Roster","","TE",[["1",15]]],
            ["Roster","","DEF",[["1",15]]],
            ["Roster","","K",[["1",15]]],
            ["Roster","","Bench",[["6",15]]],
            ["Roster","","IR",[["1",8],["2 (COVID)",2],["1",5]]],
            ["Scoring","Passing","Every 1 yard",[[null,10],["0.04",5]]],
            ["Scoring","Passing","Every 5 yards",[[null,1],["0.2",9],[null,5]]],
            ["Scoring","Passing","Every 25 yards",[["1",1],[null,14]]],
            ["Scoring","Passing","TD Pass",[["4",15]]],
            ["Scoring","Passing","40 Yard+ Bonus",[[null,14],["1",1]]],
            ["Scoring","Passing","50 Yard TD Bonus",[["4",4],["2",10],[null,1]]],
            ["Scoring","Passing","INT",[["-2",15]]],
            ["Scoring","Passing","2 PT Conversion",[["2",15]]],
            ["Scoring","Passing","400 Yards",[["5",9],["2",6]]],
            ["Scoring","Rushing","Every 1 yard",[[null,1],["0.1",14]]],
            ["Scoring","Rushing","Every 10 yards",[["1",1],[null,14]]],
            ["Scoring","Rushing","TD",[["6",15]]],
            ["Scoring","Rushing","40 Yard+ Bonus",[[null,14],["2",1]]],
            ["Scoring","Rushing","50 Yard TD Bonus",[["6",4],["3",6],["2",1],["3",3],[null,1]]],
            ["Scoring","Rushing","2 PT Conversion",[["2",15]]],
            ["Scoring","Rushing","200 Yards",[["4",9],["2",6]]],
            ["Scoring","Rushing","First Down",[[null,14],["0.5",1]]],
            ["Scoring","Receiving","Every 1 yard",[[null,1],["0.1",14]]],
            ["Scoring","Receiving","Every 10 yards",[["1",1],[null,14]]],
            ["Scoring","Receiving","Each Reception",[["1",15]]],
            ["Scoring","Receiving","TD",[["6",15]]],
            ["Scoring","Receiving","40 Yard+ Bonus",[[null,14],["2",1]]],
            ["Scoring","Receiving","50 Yard TD Bonus",[["6",4],["3",6],["2",1],["3",3],[null,1]]],
            ["Scoring","Receiving","2 PT Conversion",[["2",15]]],
            ["Scoring","Receiving","200 Yards",[["5",9],["2",6]]],
            ["Scoring","Receiving","First Down",[[null,14],["0.5",1]]],
            ["Scoring","Kicking","PAT",[["1",15]]],
            ["Scoring","Kicking","PAT Missed",[["-1",15]]],
            ["Scoring","Kicking","FG Missed",[["-1",15]]],
            ["Scoring","Kicking","FG Made",[[null,10],["3",5]]],
            ["Scoring","Kicking","FG Yard Over 30",[[null,10],["0.1",5]]],
            ["Scoring","Kicking","FG (0-39)",[["3",10],[null,5]]],
            ["Scoring","Kicking","FG (40-49)",[["4",10],[null,5]]],
            ["Scoring","Kicking","FG (50-59)",[["5",10],[null,5]]],
            ["Scoring","Kicking","FG (60+)",[["6",10],[null,5]]],
            ["Scoring","Defense/Special Teams","Kickoff Return TD",[["6",15]]],
            ["Scoring","Defense/Special Teams","Punt Return TD",[["6",15]]],
            ["Scoring","Defense/Special Teams","INT TD",[["6",15]]],
            ["Scoring","Defense/Special Teams","Fumble TD",[["6",15]]],
            ["Scoring","Defense/Special Teams","Block Punt or FG TD",[["6",15]]],
            ["Scoring","Defense/Special Teams","Sack",[["1",15]]],
            ["Scoring","Defense/Special Teams","Block Punt,FG, PAT",[["2",15]]],
            ["Scoring","Defense/Special Teams","INT",[["2",15]]],
            ["Scoring","Defense/Special Teams","Fumble Recovered",[["2",11],["1",4]]],
            ["Scoring","Defense/Special Teams","Fumble Forced",[["1",15]]],
            ["Scoring","Defense/Special Teams","Safety",[["2",15]]],
            ["Scoring","Defense/Special Teams","0 Points allowed",[["5",10],["6",5]]],
            ["Scoring","Defense/Special Teams","1-6 Points allowed",[["4",10],["6",5]]],
            ["Scoring","Defense/Special Teams","7-13 Points allowed",[["3",10],["6",5]]],
            ["Scoring","Defense/Special Teams","14-20 Points allowed",[[null,10],["6",5]]],
            ["Scoring","Defense/Special Teams","21-27 Points allowed",[[null,10],["6",5]]],
            ["Scoring","Defense/Special Teams","14-17 Points allowed",[["1",10],[null,5]]],
            ["Scoring","Defense/Special Teams","28-34 Points allowed",[["-1",10],["6",5]]],
            ["Scoring","Defense/Special Teams","35-45 Points allowed",[["-3",10],["6",5]]],
            ["Scoring","Defense/Special Teams","Points per allowed",[[null,10],["-0.2",5]]],
            ["Scoring","Defense/Special Teams","46+ Points allowed",[["-5",10],[null,5]]],
            ["Scoring","Defense/Special Teams","Less 100 Yards",[["5",10],["6",5]]],
            ["Scoring","Defense/Special Teams","100-199 Yards",[["3",10],["6",5]]],
            ["Scoring","Defense/Special Teams","200-299 Yards",[["2",10],["6",5]]],
            ["Scoring","Defense/Special Teams","300-349 Yards",[[null,10],["6",5]]],
            ["Scoring","Defense/Special Teams","350-399 Yards",[["-1",10],["6",5]]],
            ["Scoring","Defense/Special Teams","400-449 Yards",[["-3",10],["6",5]]],
            ["Scoring","Defense/Special Teams","450-499 Yards",[["-5",10],["6",5]]],
            ["Scoring","Defense/Special Teams","500-550 Yards",[["-6",10],["6",5]]],
            ["Scoring","Defense/Special Teams","550+ Yards",[["-7",10],["6",5]]],
            ["Scoring","Defense/Special Teams","Points per yard",[[null,10],["-0.02",5]]],
            ["Scoring","Miscellaneous","Kickoff Return TD",[["6",15]]],
            ["Scoring","Miscellaneous","Punt Return TD",[["6",15]]],
            ["Scoring","Miscellaneous","Fumble TD",[["6",15]]],
            ["Scoring","Miscellaneous","Fumble Lost",[["-2",15]]],
            ["Acquisitions & Trades","","Player Acquisition",[["Waivers",12],["FAAB ($100 Budget)",3]]],
            ["Acquisitions & Trades","","Acquisition Limit",[["None",15]]],
            ["Acquisitions & Trades","","Waiver Period",[["2 Days",10],["1 Day",5]]],
            ["Acquisitions & Trades","","Waiver Order",[["Each Week Inverse",12],["FAAB ($100 Budget)",3]]],
            ["Acquisitions & Trades","","Trade Limit",[["None",15]]],
            ["Acquisitions & Trades","","Trade Deadline",[["Nov 28,2012",1],["Nov 27,2013",1],["No Deadline",1],["Dec 3, 2015",1],["Nov 30, 2016",1],["Nov 29, 2017",1],["Nov 28, 2018",1],["Nov 29, 2019",1],["Dec 4, 2020",1],["Dec 1, 2021",1],["Week 11",4],["Week 9",1]]],
            ["Acquisitions & Trades","","Trade Review",[["2 Days",10],["1 Day",5]]],
            ["Acquisitions & Trades","","Veto",[["4 Votes",10],["6 Votes",5]]],
            ["Draft","","Draft Date",[["Sept 5, 2012",1],["Sept 1, 2013",1],["Aug 22, 2014",1],["Sept 1, 2015",1],["Aug 31, 2016",1],["Aug 30, 2017",1],["Sept 4, 2018",1],["Sept 4, 2019",1],["Sept 6, 2020",1],["Sept 8, 2021",1],["Sept 5, 2022",1],["Sept 4, 2023",1],["Sept 4, 2024",1],["Sept 1, 2025",1],["Sept 4, 2026",1]]],
            ["Draft","","Draft Order",[["Randomized",1],["Results",7],["Randomized",1],["Results",5],["Results/Lottery",1]]],
            ["Draft","","Keepers (No Rookies)",[[null,10],["Two (One Required)",5]]],
            ["Draft","","Keepers",[["None",1],["One",2],["Two",3],["Two (One Required)",2],["None",1],["Two (One Required)",1],[null,5]]],
            ["Draft","","Pick Trading",[["No",1],["Yes (Pre-season)",7],["No",1],["Yes (Pre-season)",1],["Yes (No 1st or 2nd)",5]]],
            ["Regular Season","","Regular Season",[["13 Weeks",4],["14 Weeks",1],["13 Weeks",4],["14 Weeks",6]]],
            ["Regular Season","","Matchups",[["1 Week",15]]],
            ["Regular Season","","Tie-Breaker",[["None",15]]],
            ["Playoffs","","Playoffs",[["4 Teams",4],["6 Teams",11]]],
            ["Playoffs","","Division Winners",[["2 Wild Cards",4],["4 Wild Cards",5],["3 Wild Cards",6]]],
            ["Playoffs","","Matchups",[["2 Weeks",4],["1 Week",11]]],
            ["Playoffs","","Bye Week",[["None",4],["Top 2 Seeds",11]]],
            ["Playoffs","","Tie-Breaker",[["Total Points For",15]]]
        ],
        divisions: {
            "2012":[{"name":"East","members":["Dan","Spencer","Ken","James","Ed","TSizz"]},{"name":"West","members":["Tom","Spear","Carson","Charles","Gavin","Dylan"]}],
            "2013":[{"name":"East","members":["Dan","Spencer","Ken","James","Ed","TSizz"]},{"name":"West","members":["Tom","Spear","Carson","Charles","Gavin","Dylan"]}],
            "2014":[{"name":"East","members":["Dan","Spencer","Ken","James","Rob","TSizz"]},{"name":"West","members":["Tom","Spear","Geoff","Charles","Gavin","Wes"]}],
            "2015":[{"name":"East","members":["Dan","Spencer","Ken","James","Rob","TSizz"]},{"name":"West","members":["Tom","Spear","Geoff","Dylan","Gavin","Wes"]}],
            "2016":[{"name":"East","members":["Dan","Spencer","Ken","James","Rob","TSizz"]},{"name":"West","members":["Tom","Spear","Geoff","Dylan","Gavin","Wes"]}],
            "2017":[{"name":"East","members":["Dan","Spencer","Ken","James","Rob","TSizz"]},{"name":"West","members":["Tom","Spear","Geoff","Dylan","Gavin","Wes"]}],
            "2018":[{"name":"East","members":["Dan","Spencer","Ken","James","Rob","TSizz"]},{"name":"West","members":["Tom","Spear","Geoff","Dylan","Gavin","Wes"]}],
            "2019":[{"name":"East","members":["Dan","Spencer","Ken","James","Rob","TSizz"]},{"name":"West","members":["Tom","Spear","Geoff","Dylan","Gavin","Wes"]}],
            "2020":[{"name":"East","members":["Dan","Spencer","Ken","James","Rob","TSizz"]},{"name":"West","members":["Tom","Spear","Geoff","Connor","Gavin","Wes"]}],
            "2021":[{"name":"SLOB","members":["Ken","Rob","TSizz","Geoff"]},{"name":"SALT","members":["Dan","Wes","Spear","Gavin"]},{"name":"SMART","members":["Spencer","Connor","Tom","James"]}],
            "2022":[{"name":"SLOB","members":["Ken","Rob","TSizz","Geoff"]},{"name":"SALT","members":["Dan","Gavin","Wes","Spear"]},{"name":"SMART","members":["Spencer","Connor","Tom","James"]}],
            "2023":[{"name":"SLOB","members":["Ken","Rob","TSizz","Geoff"]},{"name":"SALT","members":["Dan","Gavin","Wes","Spear"]},{"name":"SMART","members":["Spencer","Connor","Tom","James"]}],
            "2024":[{"name":"SLOB","members":["Zach","Dan","Connor","Rob"]},{"name":"SALT","members":["TSizz","Gavin","Wes","James"]},{"name":"SMART","members":["Spencer","Dylan","Tom","Ken"]}],
            "2025":[{"name":"SLOB","members":["Zach","Dan","Connor","Cameron"]},{"name":"SALT","members":["TSizz","Gavin","Wes","James"]},{"name":"SMART","members":["Spencer","Dylan","Tom","Eric"]}],
            "2026":[{"name":"SLOB","members":["Zach","Dan","Connor","Ken"]},{"name":"SALT","members":["TSizz","Gavin","Wes","James"]},{"name":"SMART","members":["Spencer","Dylan","Tom","Eric"]}]
        },
        notes: {
            "2026": { noSameDivision: ["Gavin and Wes", "Spencer and Tom"] }
        }
    };

    function expand(runs) {
        var out = [];
        runs.forEach(function (r) {
            for (var i = 0; i < r[1]; i++) out.push(r[0]);
        });
        return out;
    }

    SCORING_DATA.rows.forEach(function (row) {
        row[3] = expand(row[3]);
    });
    SCORING_DATA.years = [];
    for (var yy = 0; yy < YEAR_COUNT; yy++) SCORING_DATA.years.push(FIRST_YEAR + yy);
    SCORING_DATA.platform = function (year) {
        return year <= LAST_ESPN_YEAR ? "ESPN" : "Sleeper";
    };

    var GROUP_ORDER = ["Roster", "Scoring", "Acquisitions & Trades", "Draft", "Regular Season", "Playoffs"];
    var NO_DIFF_LABELS = { "Draft Date": 1, "Trade Deadline": 1 };
    var TILES = [
        ["Roster", "Roster size", "Roster Spots"],
        ["Regular Season", "Regular Season", "Regular Season"],
        ["Playoffs", "Playoffs", "Playoff Field"],
        ["Acquisitions & Trades", "Player Acquisition", "Acquisitions"]
    ];

    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined && text !== null) n.textContent = text;
        return n;
    }

    function currentSeason() {
        var badge = document.getElementById("season-badge");
        var n = badge ? Number(badge.textContent) : NaN;
        if (!n) n = Number(new URLSearchParams(window.location.search).get("season"));
        return n || null;
    }

    function valueAt(row, idx) {
        return idx >= 0 ? row[3][idx] : null;
    }

    function has(v) {
        return v !== null && v !== undefined;
    }

    function rowValue(group, label, idx) {
        for (var i = 0; i < SCORING_DATA.rows.length; i++) {
            var r = SCORING_DATA.rows[i];
            if (r[0] === group && r[2] === label) return valueAt(r, idx);
        }
        return null;
    }

    function buildTiles(idx) {
        var wrap = el("div", "scoring-tiles");
        TILES.forEach(function (t) {
            var v = rowValue(t[0], t[1], idx);
            if (!has(v)) return;
            var tile = el("div", "scoring-tile");
            tile.appendChild(el("div", "scoring-tile-label", t[2]));
            tile.appendChild(el("div", "scoring-tile-value", v));
            wrap.appendChild(tile);
        });
        return wrap;
    }

    function buildCard(title, rows, idx, prevIdx, prevYear) {
        var card = el("div", "scoring-card");
        card.appendChild(el("h4", "scoring-card-title", title));
        var table = el("table", "data-table scoring-table");
        var body = el("tbody");
        var removed = [];
        rows.forEach(function (row) {
            var v = valueAt(row, idx);
            var pv = valueAt(row, prevIdx);
            var track = prevIdx >= 0 && !NO_DIFF_LABELS[row[2]];
            if (!has(v)) {
                if (track && has(pv)) removed.push(row[2] + " (was " + pv + ")");
                return;
            }
            var tr = el("tr");
            tr.appendChild(el("td", "scoring-label", row[2]));
            var td = el("td", "scoring-value", v);
            if (row[0] === "Scoring" && /^-/.test(v)) td.classList.add("scoring-neg");
            if (track && !has(pv)) {
                td.appendChild(el("span", "scoring-change scoring-new", "new"));
                tr.classList.add("scoring-changed");
            } else if (track && pv !== v) {
                td.appendChild(el("span", "scoring-change", "was " + pv));
                tr.classList.add("scoring-changed");
            }
            tr.appendChild(td);
            body.appendChild(tr);
        });
        table.appendChild(body);
        card.appendChild(table);
        if (removed.length) {
            card.appendChild(el("p", "scoring-removed", "Removed since " + prevYear + ": " + removed.join(", ")));
        }
        return (body.children.length || removed.length) ? card : null;
    }

    function buildDivisions(year) {
        var divs = SCORING_DATA.divisions[String(year)];
        if (!divs || !divs.length) return null;
        var card = el("div", "scoring-card");
        card.appendChild(el("h4", "scoring-card-title", "Divisions"));
        var wrap = el("div", "scoring-divisions");
        divs.forEach(function (d) {
            var box = el("div", "scoring-division");
            box.appendChild(el("div", "scoring-division-name", d.name));
            d.members.forEach(function (m) { box.appendChild(el("div", "scoring-division-member", m)); });
            wrap.appendChild(box);
        });
        card.appendChild(wrap);
        var note = SCORING_DATA.notes[String(year)];
        if (note && note.noSameDivision) {
            card.appendChild(el("p", "scoring-removed", "Not in the same division: " + note.noSameDivision.join("; ")));
        }
        return card;
    }

    function render() {
        var host = document.getElementById("scoring-rules-content");
        if (!host) return;
        var year = currentSeason();
        var idx = SCORING_DATA.years.indexOf(year);
        host.innerHTML = "";
        var heading = document.getElementById("scoring-rules-heading");
        if (idx < 0) {
            if (heading) heading.textContent = "Scoring & Rules";
            host.appendChild(el("p", "scoring-empty", "No scoring and rules data is available for this season."));
            return;
        }
        var prevIdx = idx - 1;
        var prevYear = SCORING_DATA.years[prevIdx];
        if (heading) heading.textContent = year + " Scoring & Rules";
        host.appendChild(el("p", "scoring-intro", year + " season on " + SCORING_DATA.platform(year) + "." +
            (prevIdx >= 0 ? " Highlighted rows changed from " + prevYear + "." : " First season of the league.")));
        host.appendChild(buildTiles(idx));

        var grid = el("div", "scoring-grid");
        GROUP_ORDER.forEach(function (group) {
            var rows = SCORING_DATA.rows.filter(function (r) { return r[0] === group; });
            if (group !== "Scoring") {
                var c = buildCard(group, rows, idx, prevIdx, prevYear);
                if (c) grid.appendChild(c);
                return;
            }
            var sections = [];
            rows.forEach(function (r) { if (sections.indexOf(r[1]) < 0) sections.push(r[1]); });
            sections.forEach(function (s) {
                var sr = rows.filter(function (r) { return r[1] === s; });
                var sc = buildCard("Scoring: " + s, sr, idx, prevIdx, prevYear);
                if (sc) grid.appendChild(sc);
            });
        });
        var d = buildDivisions(year);
        if (d) grid.appendChild(d);
        host.appendChild(grid);
    }

    function init() {
        render();
        var badge = document.getElementById("season-badge");
        if (badge && window.MutationObserver) {
            new MutationObserver(render).observe(badge, { childList: true, characterData: true, subtree: true });
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
