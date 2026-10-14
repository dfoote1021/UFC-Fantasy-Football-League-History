/* UFC Power Rankings tab (image-based). Follows the site's main Season picker (#season-select).
   Weekly update: upload assets/power-rankings/YYYY-week-NN.jpg (e.g. 2026-week-05.jpg). It appears automatically. */
(function () {
    "use strict";
    var FOLDER = "assets/power-rankings/";
    var MAX_WEEK = 18;
    var CSS = ".pr-controls{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-bottom:18px}.pr-image-wrap{display:flex;justify-content:center}.pr-image-wrap img{width:100%;max-width:860px;height:auto;border-radius:10px;border:1px solid var(--border)}.pr-title{margin:0 0 10px}";
    var loadId = 0;
    function el(tag, cls, html) { var n = document.createElement(tag); if (cls) n.className = cls; if (html !== undefined) n.innerHTML = html; return n; }
    function esc(v) { return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
    function pad(n) { return n < 10 ? "0" + n : String(n); }
    function exists(url) {
        return new Promise(function (resolve) {
            var img = new Image();
            img.onload = function () { resolve(true); };
            img.onerror = function () { resolve(false); };
            img.src = url;
        });
    }
    function findWeeks(year) {
        var jobs = [];
        var found = [];
        for (var w = 1; w <= MAX_WEEK; w++) {
            (function (week) {
                var src = FOLDER + year + "-week-" + pad(week) + ".jpg";
                jobs.push(exists(src).then(function (ok) { if (ok) found.push({ week: week, src: src }); }));
            })(w);
        }
        return Promise.all(jobs).then(function () {
            return found.sort(function (a, b) { return b.week - a.week; });
        });
    }
    function init() {
        var panel = document.getElementById("tab-power");
        var seasonSel = document.getElementById("season-select");
        if (!panel || !seasonSel) return;
        var style = el("style"); style.textContent = CSS; document.head.appendChild(style);
        panel.innerHTML = '<h2>Power Rankings</h2><div class="pr-controls" id="pr-controls" hidden><label for="pr-week">Week</label><select id="pr-week"></select></div><div id="pr-content"><p class="status-text">Loading power rankings&hellip;</p></div>';
        var controls = panel.querySelector("#pr-controls");
        var weekSel = panel.querySelector("#pr-week");
        var content = panel.querySelector("#pr-content");
        var weeks = [];
        var year = null;

        function show() {
            var entry = weeks.filter(function (w) { return String(w.week) === weekSel.value; })[0];
            if (!entry) { content.innerHTML = ""; return; }
            content.innerHTML = '<h3 class="pr-title">' + esc(year) + " Season &middot; Week " + entry.week + "</h3>" +
                '<div class="pr-image-wrap"><img src="' + esc(entry.src) + '" alt="Power Rankings ' + esc(year) + " Week " + entry.week + '"></div>';
        }
        function load() {
            var y = seasonSel.value;
            if (!y || y === year) return;
            year = y;
            var myLoad = ++loadId;
            controls.hidden = true;
            content.innerHTML = '<p class="status-text">Loading power rankings&hellip;</p>';
            findWeeks(y).then(function (found) {
                if (myLoad !== loadId) return;
                weeks = found;
                if (!weeks.length) {
                    content.innerHTML = '<p class="status-text">No power rankings were posted for the ' + esc(y) + ' season.</p>';
                    return;
                }
                weekSel.innerHTML = "";
                weeks.forEach(function (w) {
                    var o = el("option"); o.value = w.week; o.textContent = "Week " + w.week; weekSel.appendChild(o);
                });
                controls.hidden = false;
                show();
            });
        }
        weekSel.addEventListener("change", show);
        seasonSel.addEventListener("change", load);
        new MutationObserver(function () { load(); }).observe(seasonSel, { childList: true });
        load();
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
