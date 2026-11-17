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
/* Sleeper lineup analysis: independent of matchup W-L and projections. */
(function () {
'use strict';
var A = window.SleeperAPI;
var POS = {QB:['QB'],RB:['RB'],WR:['WR'],TE:['TE'],K:['K'],DEF:['DEF','DST'],FLEX:['RB','WR','TE'],SUPER_FLEX:['QB','RB','WR','TE'],WRRB_FLEX:['WR','RB'],RB_WR_FLEX:['RB','WR'],WR_TE_FLEX:['WR','TE'],REC_FLEX:['WR','TE'],IDP_FLEX:['DL','LB','DB'],DL:['DL','DE','DT'],LB:['LB'],DB:['DB','CB','S']};
function slotLabel(slot) { return slot === 'WRRB_FLEX' ? 'WR/RB' : slot === 'REC_FLEX' ? 'WR/TE' : slot; }
function num(v) { return v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)); }
function rnd(v) { return Math.round(v * 100) / 100; }
function analyze(side, positions, meta) {
var slots = positions.filter(function (s) { return ['BN','IR','TAXI','RESERVE'].indexOf(s) < 0; });
function bad(s) { return { error:s }; }
var unsupported=slots.filter(function(s){return !POS[s];});
if (!slots.length || slots.length > 16 || unsupported.length) return bad('Unsupported lineup slots: '+(unsupported.join(', ') || slots.length+' starter slots'));
if (!side || !Array.isArray(side.starters) || side.starters.length !== slots.length || !side.players_points) return bad('Weekly starters or scores unavailable; expected '+slots.length+' starters, received '+(side && side.starters ? side.starters.length : 0)+'.');
var starters = side.starters.map(String), excluded = (side.reserve || []).concat(side.taxi || []).map(String);
var ids = Array.from(new Set((side.players || []).concat(starters).map(String))).filter(function (id) { return id !== '0' && excluded.indexOf(id) < 0; });
var points = side.players_points, actual = 0;
var missingScores=ids.filter(function(id){return !num(points[id]);}),missingMeta=ids.filter(function(id){return !meta[id];});
if (missingScores.length || missingMeta.length) return bad('Missing weekly scores for player IDs: '+(missingScores.join(', ') || 'none')+'. Missing position metadata for player IDs: '+(missingMeta.join(', ') || 'none')+'.');
if (new Set(starters.filter(function (id) { return id !== '0'; })).size !== starters.filter(function (id) { return id !== '0'; }).length) return bad('Duplicate starter IDs.');
if (starters.some(function (id) { return id !== '0' && ids.indexOf(id) < 0; })) return bad('Starter eligibility could not be resolved.');
starters.forEach(function (id) { if (id !== '0') actual += Number(points[id]); });
var players = ids.map(function (id) { return { id:id, score:Number(points[id]), positions:meta[id].fantasy_positions || [meta[id].position] }; });
starters.forEach(function (id, i) { if (id === '0') players.push({id:'empty-'+i,score:0,positions:[],empty:i}); });
var size = 1 << slots.length, dp = new Array(size); dp[0] = {score:0, same:0, lineup:[]};
players.forEach(function (p) {
var next = dp.slice();
for (var mask=0; mask<size; mask++) {
var prev=dp[mask]; if (!prev) continue;
slots.forEach(function (slot,i) {
if (mask & (1 << i)) return;
var fits = p.empty !== undefined ? p.empty === i : starters[i] === p.id || p.positions.some(function (pos) { return POS[slot].indexOf(pos) >= 0; });
if (!fits) return;
var nm=mask | (1 << i), score=prev.score+p.score, same=prev.same+(starters[i]===p.id?1:0), old=next[nm];
if (!old || score>old.score+1e-8 || (Math.abs(score-old.score)<1e-8 && same>old.same)) {
var lineup=prev.lineup.slice(); lineup[i]=p.id;
next[nm]={score:score,same:same,lineup:lineup};
}
});
}
dp=next;
});
var best=dp[size-1]; if (!best) return bad('A complete slot-compatible lineup could not be constructed.');
return { actual:rnd(actual), optimal:rnd(best.score), left:rnd(Math.max(0,best.score-actual)), efficiency:best.score>0 && actual>=0 ? actual/best.score*100:null, perfect:Math.abs(best.score-actual)<0.011, slots:slots, starters:starters, lineup:best.lineup, points:points };
}
function summarize(weeks) {
var good=weeks.filter(function (w) { return !w.result.error; }), actual=0,optimal=0,perfect=0;
if (!good.length) return {weeks:0,unavailable:weeks.length,actual:null,optimal:null,left:null,perfect:null,efficiency:null};
good.forEach(function (w) { actual+=w.result.actual; optimal+=w.result.optimal; if(w.result.perfect)perfect++; });
return { weeks:good.length, unavailable:weeks.length-good.length, actual:rnd(actual),optimal:rnd(optimal),left:rnd(optimal-actual),perfect:perfect,efficiency:optimal>0 && actual>=0 ? actual/optimal*100:null };
}
function completedThrough(year,state,max) {
if (!state || !num(state.season)) throw new Error('NFL season state unavailable.');
if (year<Number(state.season)) return max;
if (year>Number(state.season) || state.season_type==='pre') return 0;
if (state.season_type==='post' || state.season_type==='off') return max;
if (state.season_type!=='regular' || !num(state.week)) throw new Error('Week completion cannot be determined.');
return Math.max(0,Math.min(max,Number(state.week)-1));
}
function esc(v) { return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmt(v) { return v==null?'Unavailable':Number(v).toFixed(2); }
var cache={}, request=0, view='weekly', chosen=null;
function load(year) {
if(cache[year])return cache[year];
var id=A.SLEEPER_SEASONS[year];
cache[year]=Promise.all([A.getLeague(id),A.getUsers(id),A.getRosters(id),A.getPlayersMap(),A.getNFLState()]).then(async function (r) {
var league=r[0],meta=r[3],last=completedThrough(year,r[4],A.MAX_SLEEPER_WEEK || 17), map=A.buildRosterMap(r[1],r[2]), results={},failed=[];
for(var w=1;w<=last;w++) {
try {
var entries=await A.getMatchups(id,w);
(entries || []).forEach(function (side) {
if(!results[side.roster_id])results[side.roster_id]=[];
results[side.roster_id].push({week:w,result:analyze(side,league.roster_positions || [],meta)});
});
} catch(e) { failed.push(w); }
}
return {map:map,meta:meta,results:results,last:last,failed:failed};
}).catch(function(e){delete cache[year];throw e;});
return cache[year];
}
function init() {
if(!A)return;
var panel=document.getElementById('tab-rosters'),table=document.getElementById('roster-table'),yearSel=document.getElementById('season-select'),teamSel=document.getElementById('roster-team-select'),weekSel=document.getElementById('roster-week-select');
if(!panel || !table || !yearSel || !teamSel || !weekSel)return;
var root=document.createElement('section');root.id='lineup-analysis';panel.insertBefore(root,document.getElementById('roster-total') || table);
function name(d,id) { var p=d.meta[id];return id==='0' || String(id).indexOf('empty-')===0?'Empty slot':p ? p.full_name || [p.first_name,p.last_name].filter(Boolean).join(' ') || id : id; }
function renderData(d) {
var ids=Object.keys(d.map), rid=chosen || teamSel.value;
if(ids.indexOf(String(rid))<0) { root.innerHTML='<p class="status-text">Select a team to view lineup analysis.</p>';return; }
var notes='<details class="status-text"><summary>Method and data coverage</summary><p>Hindsight analysis, not a pregame decision grade. Uses each season\'s lineup slots and Sleeper weekly player scores; team-score overrides are not included. Current player-position metadata is used, with submitted starter slots preserved. Historical position changes and IR/taxi eligibility cannot be independently verified unless supplied in the weekly data. Optimal means slot-compatible from the recorded weekly player pool; empty slots are retained as options only where the submitted lineup was empty. No projections are used. Season totals include all recorded completed weekly lineups, including byes and postseason/placement weeks; they do not change W-L records. Only weeks before the current NFL week are included; the latest completed week may wait until NFL state advances. Missing scores are never replaced with zero.</p></details>';
var header='<h3 class="playoff-heading">Lineup Analysis &middot; Sleeper</h3><div class="week-picker"><button class="btn '+(view==='weekly'?'btn-primary':'')+'" data-la-view="weekly">Weekly Analysis</button><button class="btn '+(view==='season'?'btn-primary':'')+'" data-la-view="season">Season Summary</button></div>';
if(d.failed.length)header+='<p class="status-text">Could not load weeks '+d.failed.join(', ')+'. Totals below have incomplete coverage. <button class="btn" data-la-retry="1">Retry</button></p>';
var weeks=d.results[rid] || [], selected=weeks.find(function(w){return w.week===Number(weekSel.value);});
var rejected=weeks.filter(function(w){return w.result.error;});
if(rejected.length)header+='<details class="status-text"><summary>Unavailable lineup diagnostics for '+esc(d.map[rid].teamName)+' ('+rejected.length+' weeks)</summary><ul>'+rejected.map(function(w){return '<li>Week '+w.week+': '+esc(w.result.error)+'</li>';}).join('')+'</ul></details>';
if(view==='weekly') {
if(!selected || selected.result.error) { root.innerHTML=header+'<p class="status-text">'+esc(selected?selected.result.error:Number(weekSel.value)>d.last?'This week is not yet eligible as completed.':'Weekly roster data unavailable.')+'</p>'+notes;return; }
var x=selected.result;
var cards=[['Actual Starter Points',fmt(x.actual)],['Optimal Lineup Points',fmt(x.optimal)],['Lineup Efficiency',x.efficiency==null?'Unavailable':fmt(x.efficiency)+'%'],['Points Left on Bench',fmt(x.left)]];
root.innerHTML=header+'<div class="records-grid">'+cards.map(function(c){return '<div class="record-card"><h4>'+c[0]+'</h4><div class="record-value">'+c[1]+'</div></div>';}).join('')+'</div><details><summary>Actual vs. Optimal Lineup</summary><table class="data-table"><thead><tr><th>Slot</th><th>Started</th><th>Points</th><th>Optimal Selection</th><th>Points</th><th>Difference</th></tr></thead><tbody>'+x.slots.map(function(slot,i){var a=x.starters[i],b=x.lineup[i],ap=a==='0'?0:Number(x.points[a]),bp=b.indexOf('empty-')===0?0:Number(x.points[b]);return '<tr><td>'+esc(slotLabel(slot))+'</td><td>'+esc(name(d,a))+'</td><td>'+fmt(ap)+'</td><td>'+esc(name(d,b))+'</td><td>'+fmt(bp)+'</td><td>'+fmt(bp-ap)+'</td></tr>';}).join('')+'</tbody></table></details>'+notes;
} else {
var rows=ids.map(function(id){return {id:id,team:d.map[id],s:summarize(d.results[id] || [])};}).sort(function(a,b){return (b.s.efficiency==null?-Infinity:b.s.efficiency)-(a.s.efficiency==null?-Infinity:a.s.efficiency);});
root.innerHTML=header+'<p class="status-text">Select a team for weekly results. Efficiency = total actual / total optimal points. Coverage varies where data is unavailable. Unavailable means no usable weeks, not zero points.</p><table class="data-table"><thead><tr><th>Team / Owner</th><th>Efficiency</th><th>Actual</th><th>Optimal</th><th>Left on Bench</th><th>Perfect Weeks</th><th>Weeks Analyzed</th><th>Unavailable Weeks*</th></tr></thead><tbody>'+rows.map(function(row){var s=row.s;return '<tr><td><button class="btn" data-la-team="'+esc(row.id)+'">'+esc(row.team.teamName)+' / '+esc(row.team.displayName)+'</button></td><td>'+(s.efficiency==null?'Unavailable':fmt(s.efficiency)+'%')+'</td><td>'+fmt(s.actual)+'</td><td>'+fmt(s.optimal)+'</td><td>'+fmt(s.left)+'</td><td>'+(s.perfect==null?'Unavailable':s.perfect)+'</td><td>'+s.weeks+'</td><td>'+Math.max(0,d.last-s.weeks)+'</td></tr>';}).join('')+'</tbody></table><p class="status-text">*Includes missing/unusable roster data and failed requests through week '+d.last+'.</p><h4>'+esc(d.map[rid].teamName)+' &mdash; Weekly Results</h4><table class="data-table"><thead><tr><th>Week</th><th>Actual</th><th>Optimal</th><th>Efficiency</th><th>Left on Bench</th></tr></thead><tbody>'+weeks.map(function(w){var s=w.result;return s.error?'<tr><td>'+w.week+'</td><td colspan="4">'+esc(s.error)+'</td></tr>':'<tr><td>'+w.week+'</td><td>'+fmt(s.actual)+'</td><td>'+fmt(s.optimal)+'</td><td>'+(s.efficiency==null?'Unavailable':fmt(s.efficiency)+'%')+'</td><td>'+fmt(s.left)+'</td></tr>';}).join('')+'</tbody></table>'+notes;
}
}
function refresh() {
var n=++request,year=Number(yearSel.value),id=A.SLEEPER_SEASONS[year];
root.hidden=!id;if(!id)return;
root.innerHTML='<p class="status-text" role="status">Loading Sleeper lineup analysis...</p>';
load(year).then(function(d){if(n===request)renderData(d);}).catch(function(e){if(n===request)root.innerHTML='<p class="status-text">Lineup analysis unavailable. <button class="btn" data-la-retry="1">Retry</button></p>';console.error('Lineup analysis',e);});
}
root.addEventListener('click',function(e){var t=e.target.closest('button');if(!t)return;if(t.dataset.laView)view=t.dataset.laView;if(t.dataset.laTeam)chosen=t.dataset.laTeam;if(t.dataset.laRetry)delete cache[Number(yearSel.value)];if(t.dataset.laView || t.dataset.laTeam || t.dataset.laRetry)refresh();});
teamSel.addEventListener('change',function(){chosen=null;refresh();});weekSel.addEventListener('change',refresh);yearSel.addEventListener('change',function(){chosen=null;setTimeout(refresh,0);});
new MutationObserver(function(){chosen=null;refresh();}).observe(teamSel,{childList:true});
var tab=document.querySelector('[data-tab="rosters"]');if(tab)tab.addEventListener('click',refresh);
if(panel.classList.contains('active'))refresh();
}
window.SleeperLineupAnalysis={analyze:analyze,summarize:summarize,completedThrough:completedThrough};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
