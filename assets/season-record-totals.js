/* Single-season totals for All-Time > Records. Raw games preserve playoff round W-L. */
(function () {
'use strict';
function key(v) { return String(v || '').trim().toLowerCase(); }
function number(v) { return v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)); }
function round(v) { return Math.round(v * 100) / 100; }
function build(data, split, owner) {
var rows = [];
(data || []).forEach(function (season) {
var teams = Object.create(null), seen = Object.create(null);
(season.teamSummaries || []).forEach(function (t) {
var k = key(t.ownerKey);
if (!k) return;
teams[k] = { ownerKey: k, ownerName: t.ownerName, teamName: t.teamName, year: season.year,
pf: 0, pa: 0, wins: 0, losses: 0, ties: 0, games: 0, played: false,
moves: !t.hasIncompleteTransactionData && number(t.transactions) && Number(t.transactions) >= 0 ? Number(t.transactions) : null };
});
(season.games || []).forEach(function (g) {
if (g.gameType !== 'regular' && g.gameType !== 'playoff') return;
if (!number(g.ownerAScore) || !number(g.ownerBScore)) return;
var a = key(g.ownerAKey), b = key(g.ownerBKey);
var id = JSON.stringify([g.matchupPeriod || g.week, g.gameType, [a, b].sort()]);
if (seen[id]) return;
seen[id] = true;
[[a, Number(g.ownerAScore), Number(g.ownerBScore)], [b, Number(g.ownerBScore), Number(g.ownerAScore)]].forEach(function (side) {
var t = teams[side[0]];
if (!t) return;
t.played = true;
if (g.gameType !== split) return;
t.games++; t.pf += side[1]; t.pa += side[2];
if (side[1] > side[2]) t.wins++; else if (side[1] < side[2]) t.losses++; else t.ties++;
});
});
Object.keys(teams).forEach(function (k) {
var t = teams[k];
t.pf = round(t.pf); t.pa = round(t.pa);
t.margin = round(t.pf - t.pa);
t.avgPF = t.games ? t.pf / t.games : null;
t.avgPA = t.games ? t.pa / t.games : null;
t.avgMargin = t.games ? t.margin / t.games : null;
if (t.played && (!owner || key(owner) === k)) rows.push(t);
});
});
return rows;
}
var specs = [['Most PF in a Season', 'pf', false], ['Most PA in a Season', 'pa', false],
['Most Moves in a Season', 'moves', false], ['Fewest Moves in a Season', 'moves', true],
['Most Wins in a Season', 'wins', false], ['Most Losses in a Season', 'losses', false],
['Highest Average PF in a Season', 'avgPF', false], ['Highest Average PA in a Season', 'avgPA', false],
['Best Season Point Differential', 'margin', false], ['Worst Season Point Differential', 'margin', true],
['Best Average Season Differential', 'avgMargin', false], ['Worst Average Season Differential', 'avgMargin', true]];
function records(rows) {
return specs.map(function (s) {
var eligible = rows.filter(function (r) { return s[1] === 'moves' ? r.moves !== null : r.games > 0; });
var value = eligible.length ? eligible.reduce(function (v, r) { return s[2] ? Math.min(v, r[s[1]]) : Math.max(v, r[s[1]]); }, eligible[0][s[1]]) : null;
return { title: s[0], metric: s[1], value: value, holders: eligible.filter(function (r) { return Math.abs(r[s[1]] - value) < 1e-9; }).sort(function (a, b) { return a.year - b.year || String(a.ownerName).localeCompare(String(b.ownerName)); }) };
});
}
function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function fmt(v, digits, signed) {
return (signed && v > 0 ? '+' : '') + Number(v === 0 ? 0 : v).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function holderText(t, metric) {
var text = esc(t.ownerName) + ' &mdash; ' + esc(t.teamName) + ' (' + esc(t.year) + ')';
if (metric === 'moves') return text;
text += '<br>' + t.games + (t.games === 1 ? ' game' : ' games');
if (metric === 'wins' || metric === 'losses') text += ' &middot; Record: ' + t.wins + '-' + t.losses + '-' + t.ties + ' (W-L-T)';
if (metric === 'avgPF') text += ' &middot; Total PF: ' + fmt(t.pf, 2);
if (metric === 'avgPA') text += ' &middot; Total PA: ' + fmt(t.pa, 2);
if (metric === 'margin' || metric === 'avgMargin') text += ' &middot; PF: ' + fmt(t.pf, 2) + ' &middot; PA: ' + fmt(t.pa, 2);
return text;
}
var data = null, pending = null;
function init() {
var panel = document.getElementById('alltime-records'), grid = document.getElementById('records-grid');
if (!panel || !grid || !window.AllTimeStats) return;
var section = document.createElement('section'); section.id = 'season-total-records';
panel.appendChild(section);
function render() {
if (!data) {
if (pending) return;
section.textContent = 'Loading single-season records...';
pending = window.AllTimeStats.loadAllSeasons().then(function (result) { data = result; pending = null; render(); }).catch(function (err) {
pending = null; section.textContent = 'Could not load single-season records. Reopen Records to retry.';
console.error('Single-season records failed', err);
});
return;
}
var splitButton = panel.querySelector('.records-split-btn.active');
var viewButton = panel.querySelector('.records-view-btn.active');
var member = document.getElementById('records-member-select');
var owner = viewButton && viewButton.getAttribute('data-view') === 'member' ? member && member.value : null;
if (viewButton && viewButton.getAttribute('data-view') === 'member' && !owner) { section.textContent = 'Select a member to see single-season records.'; return; }
var split = splitButton ? splitButton.getAttribute('data-split') : 'regular';
var cards = records(build(data, split, owner)).map(function (r) {
var points = ['moves', 'wins', 'losses'].indexOf(r.metric) === -1;
var signed = r.metric === 'margin' || r.metric === 'avgMargin';
var value = r.value === null ? 'No eligible data' : fmt(r.value, points ? 2 : 0, signed);
if (r.value !== null && r.metric.indexOf('avg') === 0) value += ' / game';
return '<article style="padding:16px;border:1px solid rgba(139,151,171,.3);border-radius:10px"><h4>' + esc(r.title) + '</h4><p style="font-size:1.5rem;font-weight:700">' + esc(value) + '</p>' + r.holders.map(function (t) {
return '<p>' + holderText(t, r.metric) + '</p>';
}).join('') + '</article>';
}).join('');
section.innerHTML = '<h3 class="playoff-heading">Single-Season Records</h3><p class="status-text">Scoring and W-L records: ' + (split === 'playoff' ? 'playoffs' : 'regular season') + '. Moves: full season. Differential = PF minus PA across all counted games in the selected split, not the largest single-game margin. Average PF, PA and differential = season total divided by games. Two-week playoff rounds count as one game for W-L and averages; these are per-matchup, not per-week averages. Consolation and placement games are excluded. Missing move counts are excluded; verified zero counts are eligible. All tied holders are shown; averages are ranked before display rounding. Loaded seasons may be in progress; no completed-season minimum is applied.</p><div class="records-grid">' + cards + '</div>';
}
new MutationObserver(render).observe(grid, { childList: true, subtree: true });
panel.addEventListener('click', function () { setTimeout(render, 0); });
panel.addEventListener('change', render);
var tab = document.querySelector('[data-alltime-tab="records"]');
if (tab) tab.addEventListener('click', function () { setTimeout(render, 0); });
if (grid.childNodes.length) render();
}
window.SeasonRecordTotals = { build: build, records: records, holderText: holderText };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
