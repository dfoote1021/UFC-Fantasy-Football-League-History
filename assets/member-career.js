/* member-career.js - Member Career tab for the All-Time section.
Pick a member to see their whole career by season with Points For vs Points Against and Wins vs Losses charts.
Click a season on either chart to see the exact numbers. Uses window.AllTimeStats (same data as the other All-Time tabs).
Consolation games are excluded. Charts are inline SVG. */
(function () {
'use strict';
var Q = String.fromCharCode(34);
var state = { data: null, owners: [], ownerKey: null, split: 'combined', loading: false, played: [] };
var C = { pf: '#4f8cff', pa: '#ff6b6b', win: '#3ecf8e', loss: '#ff6b6b', line: '#f5c451', axis: '#8b97ab', grid: 'rgba(139,151,171,0.22)', sel: 'rgba(245,196,81,0.16)' };
function esc(v) { return String(v == null ? '' : v).split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;').split(Q).join('&quot;'); }
function h(tag, attrs, inner) {
var a = '';
Object.keys(attrs || {}).forEach(function (k) { a += ' ' + k + '=' + Q + esc(attrs[k]) + Q; });
return '<' + tag + a + '>' + (inner == null ? '' : inner) + '</' + tag + '>';
}
function fmt(n, d) { return Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }); }
function pct(w, l, t) { var g = w + l + t; return g > 0 ? w / g : null; }
function newRec() { return { w: 0, l: 0, t: 0, pf: 0, pa: 0 }; }
function add(rec, my, opp) { rec.pf += my; rec.pa += opp; if (my > opp) rec.w++; else if (my < opp) rec.l++; else rec.t++; }
function games(r) { return r.w + r.l + r.t; }
function merge(a, b) { return { w: a.w + b.w, l: a.l + b.l, t: a.t + b.t, pf: a.pf + b.pf, pa: a.pa + b.pa }; }
function pick(row, split) { return split === 'regular' ? row.reg : split === 'playoff' ? row.po : row.all; }
function dash() { return '-'; }

function buildSeasons(data, ownerKey) {
var rows = [];
data.forEach(function (season) {
var team = null;
(season.teamSummaries || []).forEach(function (t) { if (t.ownerKey === ownerKey) team = t; });
if (!team) return;
var reg = newRec(), po = newRec();
(season.games || []).forEach(function (g) {
if (g.gameType === 'consolation') return;
var mine = null;
if (g.ownerAKey === ownerKey) mine = [g.ownerAScore, g.ownerBScore];
else if (g.ownerBKey === ownerKey) mine = [g.ownerBScore, g.ownerAScore];
if (!mine) return;
add(g.gameType === 'playoff' ? po : reg, Number(mine[0]) || 0, Number(mine[1]) || 0);
});
var result = team.isChampion ? 'Champion' : team.isRunnerUp ? 'Runner-up' : team.madePlayoffs ? 'Made playoffs' : 'Missed playoffs';
rows.push({ year: season.year, source: season.source, teamName: team.teamName, reg: reg, po: po, all: merge(reg, po),
champion: !!team.isChampion, runnerUp: !!team.isRunnerUp, madePlayoffs: !!team.madePlayoffs, result: result,
txns: team.transactions || 0, txnIncomplete: !!team.hasIncompleteTransactionData });
});
rows.sort(function (a, b) { return a.year - b.year; });
return rows;
}
function totals(rows, split) { var t = newRec(); rows.forEach(function (r) { t = merge(t, pick(r, split)); }); return t; }

function niceMax(v) {
if (v <= 0) return 1;
var p = Math.pow(10, Math.floor(Math.log(v) / Math.LN10)), n = v / p;
return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
function frame(w, hgt, m, maxV, ticks, yFmt) {
var out = '';
for (var i = 0; i <= ticks; i++) {
var y = m.t + (hgt - m.t - m.b) * (1 - i / ticks);
out += h('line', { x1: m.l, x2: w - m.r, y1: y, y2: y, stroke: C.grid }) +
h('text', { x: m.l - 6, y: y + 4, 'text-anchor': 'end', 'font-size': 11, fill: C.axis }, yFmt(maxV * i / ticks));
}
return out;
}
function svgWrap(w, hgt, inner, label) {
return h('svg', { viewBox: '0 0 ' + w + ' ' + hgt, role: 'img', 'aria-label': label, style: 'width:100%;height:auto;max-width:' + w + 'px;display:block' }, inner);
}
function legend(items) {
return h('div', { class: 'mc-legend' }, items.map(function (i) { return h('span', {}, h('i', { style: 'background:' + i.color }, '') + esc(i.label)); }).join(''));
}
function rect(x, y, w, hh, fill, tip) { return h('rect', { x: x, y: y, width: w, height: Math.max(hh, 0), fill: fill, rx: 2 }, h('title', {}, esc(tip))); }
function yearLabel(cx, hgt, year) { return h('text', { x: cx, y: hgt - 14, 'text-anchor': 'middle', 'font-size': 11, fill: C.axis }, year); }
function hitRect(x, y, w, hh, chart, i, tip) {
return h('rect', { x: x, y: y, width: w, height: hh, fill: 'transparent', class: 'mc-hit', 'data-chart': chart, 'data-i': i, style: 'cursor:pointer' }, h('title', {}, esc(tip)));
}

function barChart(rows, series, opts) {
var w = Math.max(560, 90 + rows.length * 62), hgt = 280, m = { l: 56, r: 12, t: 14, b: 36 }, maxV = 0;
rows.forEach(function (r) {
if (opts.stacked) maxV = Math.max(maxV, series.reduce(function (s, x) { return s + (x.val(r) || 0); }, 0));
else series.forEach(function (x) { maxV = Math.max(maxV, x.val(r) || 0); });
});
maxV = niceMax(maxV);
var plotW = w - m.l - m.r, plotH = hgt - m.t - m.b, slot = plotW / Math.max(rows.length, 1);
var out = frame(w, hgt, m, maxV, 5, opts.yFmt);
rows.forEach(function (r, i) {
var cx = m.l + slot * i + slot / 2;
if (opts.stacked) {
var bw = Math.min(36, slot * 0.6), acc = 0;
series.forEach(function (s) {
var v = s.val(r) || 0, bh = plotH * v / maxV, y = m.t + plotH - plotH * acc / maxV - bh;
if (v > 0) out += rect(cx - bw / 2, y, bw, bh, s.color, r.year + ' ' + s.label + ': ' + s.fmt(v));
if (v > 0 && bh > 14) out += h('text', { x: cx, y: y + bh / 2 + 4, 'text-anchor': 'middle', 'font-size': 11, fill: '#0b1220', 'font-weight': 700 }, s.fmt(v));
acc += v;
});
} else {
var gw = Math.min(26, slot * 0.38);
series.forEach(function (s, k) {
var v = s.val(r) || 0, bh = plotH * v / maxV;
out += rect(cx - gw + k * gw, m.t + plotH - bh, gw - 2, bh, s.color, r.year + ' ' + s.label + ': ' + s.fmt(v));
});
}
out += yearLabel(cx, hgt, r.year);
out += hitRect(m.l + slot * i, m.t, slot, plotH, opts.id, i, r.year + ': click for exact numbers');
});
return svgWrap(w, hgt, out, opts.label);
}
function lineChart(rows, val, opts) {
var w = Math.max(560, 90 + rows.length * 62), hgt = 240, m = { l: 56, r: 16, t: 14, b: 36 };
var plotW = w - m.l - m.r, plotH = hgt - m.t - m.b, slot = plotW / Math.max(rows.length, 1), pts = [];
var out = frame(w, hgt, m, 1, 4, function (v) { return Math.round(v * 100) + '%'; });
rows.forEach(function (r, i) {
var v = val(r), cx = m.l + slot * i + slot / 2;
out += yearLabel(cx, hgt, r.year);
if (v != null) pts.push([cx, m.t + plotH * (1 - v), v, r.year]);
});
if (pts.length > 1) out += h('polyline', { fill: 'none', stroke: C.line, 'stroke-width': 2.5, points: pts.map(function (p) { return p[0] + ',' + p[1]; }).join(' ') }, '');
pts.forEach(function (p) { out += h('circle', { cx: p[0], cy: p[1], r: 4.5, fill: C.line }, h('title', {}, esc(p[3] + ': ' + (p[2] * 100).toFixed(1) + '% wins'))); });
return svgWrap(w, hgt, out, opts.label);
}

function splitLabel(s) { return s === 'regular' ? 'Regular season' : s === 'playoff' ? 'Playoffs' : 'Regular season + playoffs'; }
function winPctText(r) { var p = pct(r.w, r.l, r.t); return p == null ? dash() : (p * 100).toFixed(1) + '%'; }
function recText(r) { return r.w + '-' + r.l + (r.t ? '-' + r.t : ''); }
function td(v) { return h('td', {}, v); }

function detailText(chart, r, split) {
var x = pick(r, split), gp = games(x);
var head = '<strong>' + esc(r.year) + '</strong> - ' + esc(r.teamName) + ' (' + esc(splitLabel(split)) + ')';
if (chart === 'pfpa') {
var d = x.pf - x.pa;
return head + '<br>Points for: <strong>' + fmt(x.pf, 2) + '</strong> &nbsp; Points against: <strong>' + fmt(x.pa, 2) + '</strong> &nbsp; Difference: <strong>' + (d >= 0 ? '+' : '-') + fmt(Math.abs(d), 2) + '</strong>' +
'<br>Per game: ' + fmt(x.pf / gp, 2) + ' for, ' + fmt(x.pa / gp, 2) + ' against &nbsp; Record: ' + recText(x) + ' (' + winPctText(x) + ')';
}
return head + '<br>Wins: <strong>' + x.w + '</strong> &nbsp; Losses: <strong>' + x.l + '</strong>' + (x.t ? ' &nbsp; Ties: <strong>' + x.t + '</strong>' : '') +
' &nbsp; Win %: <strong>' + winPctText(x) + '</strong>' + '<br>Result: ' + esc(r.result);
}

function render() {
var root = document.getElementById('mc-body');
if (!root) return;
var rows = buildSeasons(state.data, state.ownerKey), split = state.split;
if (!rows.length) { root.innerHTML = h('p', { class: 'status-text' }, 'No seasons found for this member.'); return; }
var tot = totals(rows, split), g = games(tot);
var champs = rows.filter(function (r) { return r.champion; }).length;
var ru = rows.filter(function (r) { return r.runnerUp; }).length;
var po = rows.filter(function (r) { return r.madePlayoffs; }).length;
var played = rows.filter(function (r) { return games(pick(r, split)) > 0; });
state.played = played;
var best = null, worst = null;
played.forEach(function (r) {
var x = pick(r, split), p = pct(x.w, x.l, x.t);
if (best == null || p > best.p) best = { p: p, r: r };
if (worst == null || p < worst.p) worst = { p: p, r: r };
});
var cards = [['Seasons', rows.length], ['Championships', champs], ['Runner-ups', ru], ['Playoff trips', po], ['Record', recText(tot)], ['Win %', winPctText(tot)],
['Points for', fmt(tot.pf, 2)], ['Points against', fmt(tot.pa, 2)], ['Avg points for', g ? fmt(tot.pf / g, 2) : dash()], ['Avg points against', g ? fmt(tot.pa / g, 2) : dash()],
['Best season', best ? best.r.year + ' (' + (best.p * 100).toFixed(0) + '%)' : dash()], ['Worst season', worst ? worst.r.year + ' (' + (worst.p * 100).toFixed(0) + '%)' : dash()]];
var html = h('div', { class: 'mc-cards' }, cards.map(function (c) {
return h('div', { class: 'mc-card' }, h('div', { class: 'mc-card-v' }, esc(c[1])) + h('div', { class: 'mc-card-l' }, esc(c[0])));
}).join(''));
html += h('h3', { class: 'playoff-heading' }, 'Points For vs Points Against') +
legend([{ color: C.pf, label: 'Points for' }, { color: C.pa, label: 'Points against' }]) +
h('div', { class: 'mc-chart' }, barChart(played, [
{ label: 'Points for', color: C.pf, val: function (r) { return pick(r, split).pf; }, fmt: function (v) { return fmt(v, 1); } },
{ label: 'Points against', color: C.pa, val: function (r) { return pick(r, split).pa; }, fmt: function (v) { return fmt(v, 1); } }
], { id: 'pfpa', stacked: false, label: 'Points for versus points against by season', yFmt: function (v) { return fmt(v, 0); } })) +
h('div', { class: 'mc-detail', id: 'mc-detail-pfpa' }, 'Click a season on the chart to see the exact numbers.');
html += h('h3', { class: 'playoff-heading' }, 'Wins vs Losses') +
legend([{ color: C.win, label: 'Wins' }, { color: C.loss, label: 'Losses' }]) +
h('div', { class: 'mc-chart' }, barChart(played, [
{ label: 'Wins', color: C.win, val: function (r) { return pick(r, split).w; }, fmt: function (v) { return String(v); } },
{ label: 'Losses', color: C.loss, val: function (r) { return pick(r, split).l; }, fmt: function (v) { return String(v); } }
], { id: 'wl', stacked: true, label: 'Wins and losses by season', yFmt: function (v) { return String(Math.round(v)); } })) +
h('div', { class: 'mc-detail', id: 'mc-detail-wl' }, 'Click a season on the chart to see the exact numbers.');
html += h('h3', { class: 'playoff-heading' }, 'Win % by Season') +
h('div', { class: 'mc-chart' }, lineChart(played, function (r) { var x = pick(r, split); return pct(x.w, x.l, x.t); }, { label: 'Win percentage by season' }));

var heads = ['Season', 'Team', 'Record', 'Win %', 'PF', 'PA', 'PF/G', 'PA/G', 'Playoff W-L', 'Result', 'Txns'];
var body = '', incomplete = false;
rows.slice().reverse().forEach(function (r) {
var x = pick(r, split), gp = games(x);
if (r.txnIncomplete) incomplete = true;
var tag = r.champion ? '&#127942; ' : r.runnerUp ? '&#129352; ' : '';
body += h('tr', {}, td(r.year + (r.source === 'espn' ? ' (ESPN)' : '')) + td(esc(r.teamName)) +
td(gp ? recText(x) : dash()) + td(gp ? winPctText(x) : dash()) + td(gp ? fmt(x.pf, 2) : dash()) + td(gp ? fmt(x.pa, 2) : dash()) +
td(gp ? fmt(x.pf / gp, 2) : dash()) + td(gp ? fmt(x.pa / gp, 2) : dash()) +
td(games(r.po) ? r.po.w + '-' + r.po.l + (r.po.t ? '-' + r.po.t : '') : dash()) + td(tag + esc(r.result)) + td(r.txnIncomplete ? 'n/a' : r.txns));
});
var txnTotal = rows.reduce(function (s, r) { return s + (r.txns || 0); }, 0);
body += h('tr', { class: 'mc-total' }, td('<strong>Career</strong>') + td('') + td('<strong>' + (g ? recText(tot) : dash()) + '</strong>') + td('<strong>' + (g ? winPctText(tot) : dash()) + '</strong>') +
td('<strong>' + fmt(tot.pf, 2) + '</strong>') + td('<strong>' + fmt(tot.pa, 2) + '</strong>') +
td('<strong>' + (g ? fmt(tot.pf / g, 2) : dash()) + '</strong>') + td('<strong>' + (g ? fmt(tot.pa / g, 2) : dash()) + '</strong>') + td('') + td('') + td('<strong>' + txnTotal + '</strong>'));
html += h('h3', { class: 'playoff-heading' }, 'Season by Season') +
h('div', { class: 'mc-scroll' }, h('table', { class: 'data-table mc-table' },
h('thead', {}, h('tr', {}, heads.map(function (x) { return h('th', {}, x); }).join(''))) + h('tbody', {}, body)));
if (incomplete) html += h('p', { class: 'status-text' }, 'n/a: transaction counts are not available for some ESPN seasons.');
html += h('p', { class: 'status-text' }, 'Showing: ' + esc(splitLabel(split)) + '. Consolation and placement games are not counted. Seasons with no recorded games are left out of the charts.');
root.innerHTML = html;
}

function onChartClick(e) {
var t = e.target && e.target.closest ? e.target.closest('.mc-hit') : null;
if (!t) return;
var chart = t.getAttribute('data-chart'), i = Number(t.getAttribute('data-i'));
var r = state.played[i];
var box = document.getElementById('mc-detail-' + chart);
if (!r || !box) return;
box.innerHTML = detailText(chart, r, state.split);
var all = document.querySelectorAll('.mc-hit');
for (var k = 0; k < all.length; k++) {
if (all[k].getAttribute('data-chart') === chart) all[k].setAttribute('fill', all[k] === t ? C.sel : 'transparent');
}
}

function buildUi(panel) {
var splits = [['combined', 'Combined'], ['regular', 'Regular Season'], ['playoff', 'Playoffs']];
panel.innerHTML = h('div', { class: 'week-picker mc-controls' },
h('label', { for: 'mc-owner' }, 'Member') + h('select', { id: 'mc-owner' }, '') +
h('div', { class: 'records-split-toggle', id: 'mc-split' }, splits.map(function (s, i) {
return h('button', { class: 'btn mc-split-btn' + (i === 0 ? ' active' : ''), 'data-split': s[0] }, s[1]);
}).join(''))) + h('div', { id: 'mc-body' }, h('p', { class: 'status-text' }, 'Loading career data...'));
var sel = panel.querySelector('#mc-owner');
sel.addEventListener('change', function () { state.ownerKey = sel.value; render(); });
panel.querySelector('#mc-body').addEventListener('click', onChartClick);
panel.querySelectorAll('.mc-split-btn').forEach(function (b) {
b.addEventListener('click', function () {
panel.querySelectorAll('.mc-split-btn').forEach(function (x) { x.classList.remove('active'); });
b.classList.add('active');
state.split = b.getAttribute('data-split');
if (state.data) render();
});
});
}
function ensureLoaded(panel) {
if (state.data || state.loading) return;
var body = panel.querySelector('#mc-body');
if (!window.AllTimeStats || typeof window.AllTimeStats.loadAllSeasons !== 'function') { body.innerHTML = h('p', { class: 'status-text' }, 'All-time data is not available (all-time.js did not load).'); return; }
state.loading = true;
window.AllTimeStats.loadAllSeasons().then(function (data) {
state.data = data;
state.owners = window.AllTimeStats.getAllOwnerNames(data);
panel.querySelector('#mc-owner').innerHTML = state.owners.map(function (o) { return h('option', { value: o.key }, esc(o.name)); }).join('');
state.ownerKey = state.owners.length ? state.owners[0].key : null;
state.loading = false;
if (state.ownerKey) render(); else body.innerHTML = h('p', { class: 'status-text' }, 'No members found.');
}).catch(function (err) {
state.loading = false;
console.error('Member career failed to load', err);
body.innerHTML = h('p', { class: 'status-text' }, 'Could not load career data. Details are in the browser console.');
});
}
function init() {
var content = document.getElementById('alltime-content');
var nav = content && content.querySelector('.alltime-tabs');
if (!content || !nav || document.getElementById('alltime-member')) return;
var style = document.createElement('style');
style.textContent = '.mc-controls{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:14px}' +
'.mc-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin:8px 0 18px}' +
'.mc-card{background:rgba(255,255,255,.04);border:1px solid rgba(139,151,171,.25);border-radius:10px;padding:10px 12px}' +
'.mc-card-v{font-size:1.25rem;font-weight:700}.mc-card-l{font-size:.78rem;opacity:.7;margin-top:2px}' +
'.mc-chart{margin:6px 0 8px;overflow-x:auto}.mc-legend{display:flex;gap:16px;font-size:.85rem;margin:4px 0}' +
'.mc-legend i{display:inline-block;width:11px;height:11px;border-radius:2px;margin-right:6px;vertical-align:-1px}' +
'.mc-detail{margin:0 0 18px;padding:10px 12px;border:1px solid rgba(139,151,171,.25);border-radius:10px;background:rgba(255,255,255,.04);font-size:.92rem;line-height:1.5}' +
'.mc-scroll{overflow-x:auto}.mc-total td{border-top:2px solid rgba(139,151,171,.5)}';
document.head.appendChild(style);
var btn = document.createElement('button');
btn.className = 'tab-btn'; btn.setAttribute('data-alltime-tab', 'member'); btn.textContent = 'Member Career';
nav.appendChild(btn);
var panel = document.createElement('section');
panel.id = 'alltime-member'; panel.className = 'tab-panel';
content.appendChild(panel);
buildUi(panel);
btn.addEventListener('click', function () {
nav.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
content.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active'); });
btn.classList.add('active'); panel.classList.add('active');
ensureLoaded(panel);
});
nav.addEventListener('click', function (e) {
var b = e.target.closest && e.target.closest('.tab-btn');
if (b && b !== btn) panel.classList.remove('active');
});
}
window.MemberCareer = { buildSeasons: buildSeasons, totals: totals, pct: pct, render: render, st: state, detailText: detailText };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
