/* UFC Power Rankings tab (image-based). Fills the static #tab-power panel in index.html.
   Weekly update: upload assets/power-rankings/YYYY-week-NN.jpg (e.g. 2026-week-05.jpg). It appears automatically. */
(function () {
    "use strict";
    var FOLDER = "assets/power-rankings/";
    var SEASONS = [2017, 2026, 2027];
    var MAX_WEEK = 18;
    var CSS = ".pr-controls{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-bottom:18px}.pr-image-wrap{display:flex;justify-content:center}.pr-image-wrap img{width:100%;max-width:860px;height:auto;border-radius:10px;border:1px solid var(--border)}.pr-title{margin:0 0 10px}";
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
    function discover() {
        var found = {};
        var jobs = [];
        SEASONS.forEach(function (y) {
            for (var w = 1; w <= MAX_WEEK; w++) {
                (function (year, week) {
                    var src = FOLDER + year + "-week-" + pad(week) + ".jpg";
                    jobs.push(exists(src).then(function (ok) {
                        if (ok) { (found[year] = found[year] || []).push({ week: week, src: src }); }
                    }));
                })(y, w);
            }
        });
        return Promise.all(jobs).then(function () { return found; });
    }
    function init() {
        var panel = document.getElementById("tab-power");
        if (!panel) return;
        var style = el("style"); style.textContent = CSS; document.head.appendChild(style);
        panel.innerHTML = '<h2>Power Rankings</h2><div class="pr-controls"><label for="pr-season">Season</label><select id="pr-season"></select><label for="pr-week">Week</label><select id="pr-week"></select></div><div id="pr-content"><p class="status-text">Loading power rankings&hellip;</p></div>';
        var seasonSel = panel.querySelector("#pr-season"), weekSel = panel.querySelector("#pr-week"), content = panel.querySelector("#pr-content");
        discover().then(function (found) {
            var years = Object.keys(found).sort(function (a, b) { return b - a; });
            if (!years.length) { content.innerHTML = '<p class="status-text">No power rankings have been posted yet.</p>'; return; }
            years.forEach(function (y) { var o = el("option"); o.value = y; o.textContent = y; seasonSel.appendChild(o); });
            function fillWeeks() {
                weekSel.innerHTML = "";
                found[seasonSel.value].slice().sort(function (a, b) { return b.week - a.week; }).forEach(function (w) {
                    var o = el("option"); o.value = w.week; o.textContent = "Week " + w.week; weekSel.appendChild(o);
                });
            }
            function show() {
                var entry = found[seasonSel.value].filter(function (w) { return String(w.week) === weekSel.value; })[0];
                if (!entry) { content.innerHTML = ""; return; }
                content.innerHTML = '<h3 class="pr-title">' + esc(seasonSel.value) + " Season &middot; Week " + entry.week + "</h3>" +
                    '<div class="pr-image-wrap"><img src="' + esc(entry.src) + '" alt="Power Rankings ' + esc(seasonSel.value) + " Week " + entry.week + '"></div>';
            }
            seasonSel.addEventListener("change", function () { fillWeeks(); show(); });
            weekSel.addEventListener("change", show);
            fillWeeks(); show();
        });
    }
    init();
})();
