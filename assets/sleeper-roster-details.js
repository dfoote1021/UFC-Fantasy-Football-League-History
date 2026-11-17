/* Sleeper roster details: display only; no scoring or lineup-efficiency changes. */
(function(){
'use strict';
var A=window.SleeperAPI;if(!A)return;
var leagues={},snapshots={},pairs=null,statCache={},busy=false,timer=null;
var getLeague=A.getLeague,getRosters=A.getRosters,pairMatchups=A.pairMatchups;
function value(id){var e=document.getElementById(id);return e?e.value:'';}
A.getLeague=function(id){return getLeague.apply(this,arguments).then(function(d){leagues[id]=d;return d;});};
A.getRosters=function(id){return getRosters.apply(this,arguments).then(function(d){snapshots[id]={rows:d,time:new Date().toISOString()};schedule();return d;});};
A.pairMatchups=function(){var out=pairMatchups.apply(this,arguments);pairs={year:value('season-select'),week:value('week-select'),rows:out};schedule();return out;};
function esc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function number(v){return v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));}
function extraStats(s,pos){
if(['K','DEF','DST'].indexOf(pos)>=0)return '';
var fields=[['rush_fd','Rush 1D'],['rec_fd','Rec 1D'],['rush_40p','40+ rush'],['rec_40p','40+ rec']];
if(pos==='QB')fields=[['rush_fd','Rush 1D'],['pass_cmp_40p','40+ pass cmp'],['rush_40p','40+ rush']];
return fields.map(function(f){return f[1]+': '+(s&&number(s[f[0]])?Number(s[f[0]]):'Unavailable');}).join(' | ');
}
function label(s){return s==='WRRB_FLEX'||s==='RB_WR_FLEX'?'WR/RB':s==='REC_FLEX'||s==='WR_TE_FLEX'?'WR/TE':s;}
function name(meta,id){var p=meta[id]||{};return p.full_name||[p.first_name,p.last_name].filter(Boolean).join(' ')||id;}
function irHTML(weekly,snapshot,rid,meta){
var exact=weekly&&Array.isArray(weekly.reserve),entry=snapshot&&(snapshot.rows||[]).find(function(r){return String(r.roster_id)===String(rid);});
var ids=exact?weekly.reserve:entry&&Array.isArray(entry.reserve)?entry.reserve:null;
var title=exact?'Selected-week IR':'Latest available roster IR';
var note=exact?'Assignments supplied with this week.':snapshot?'Snapshot retrieved '+snapshot.time+'. Not a historical assignment for the selected week.':'Roster snapshot unavailable.';
return '<div class="status-text"><h4>'+title+'</h4><p>'+esc(note)+'</p>'+(ids===null?'<p>IR assignments unavailable.</p>':!ids.length?'<p>No players in this '+(exact?'week reserve list.':'roster snapshot IR list.')+'</p>':'<ul>'+ids.map(function(id){return '<li>IR &mdash; '+esc(name(meta,String(id)))+' ('+esc((meta[id]||{}).position||'position unavailable')+')</li>';}).join('')+'</ul>')+'</div>';
}
function parse(d){if(window.RosterStats)return window.RosterStats.parseWeekStats(d);return {};}
function stats(year,week){var k=year+'|'+week;if(!statCache[k])statCache[k]=fetch('https://api.sleeper.com/stats/nfl/'+year+'/'+week+'?season_type=regular').then(function(r){if(!r.ok)throw new Error('Weekly stats HTTP '+r.status);return r.json();}).then(parse).catch(function(e){delete statCache[k];console.warn('Roster detail stats',e);return null;});return statCache[k];}
function fullStats(s,pos){var base=s&&window.RosterStats?window.RosterStats.formatStats(s,pos):'';var extra=extraStats(s,pos);return [base,extra].filter(Boolean).join(' | ')||'Unavailable';}
function ordered(side,league,meta){
var rows=A.resolveMatchupRoster(side,meta),layout=window.WeeklyRosterLayout;
return layout?layout.layout(rows,side,league.roster_positions||[],meta):rows;
}
function renderColumn(side,league,meta,statMap,snapshot){
var slots=(league.roster_positions||[]).filter(function(s){return ['BN','IR','TAXI','RESERVE'].indexOf(s)<0;});
if(!side.starters||slots.length!==side.starters.length)return '<p class="status-text">Assigned lineup slots unavailable.</p>';
var rows=ordered(side,league,meta);
if(rows.some(function(r){return !r.slot;}))return '<p class="status-text">Roster ordering could not be resolved.</p>';
return '<h5>'+esc(side.teamName||side.displayName||'Team')+'</h5><ul>'+rows.map(function(p){var id=p.playerId,st=statMap&&statMap[id];return '<li class="'+(p.isStarter?'':'bench-player')+'"><div><span>'+esc(label(p.slot))+' &middot; '+esc(p.name||p.playerName)+'</span><div class="status-text">'+esc(fullStats(st&&st.stats,p.position))+'</div></div><span>'+ (number(p.points)?Number(p.points).toFixed(2):'Unavailable')+'</span></li>';}).join('')+'</ul>'+irHTML(side,snapshot,side.rosterId,meta);
}
function put(element,html){if(element.innerHTML!==html)element.innerHTML=html;}
async function updateWeekly(year,id,meta){
var week=value('roster-week-select'),rid=value('roster-team-select');if(!week||!rid)return;
var data=await stats(year,week);if(value('season-select')!==year||value('roster-week-select')!==week||value('roster-team-select')!==rid)return;
var panel=document.getElementById('tab-rosters'),table=document.getElementById('roster-table');if(!panel||!table)return;
var box=document.getElementById('roster-ir-details');if(!box){box=document.createElement('section');box.id='roster-ir-details';panel.appendChild(box);}
box.hidden=false;put(box,irHTML(null,snapshots[id],rid,meta));
var byName={};Object.keys(meta).forEach(function(pid){var n=name(meta,pid);if(byName[n]===undefined)byName[n]=pid;else byName[n]=null;});
var rows=table.querySelectorAll('tbody tr');rows.forEach(function(tr){var cells=tr.querySelectorAll('td');if(cells.length<5)return;var pid=byName[cells[1].textContent.trim()];if(!pid)return;var s=data&&data[pid],text=fullStats(s&&s.stats,cells[2].textContent.trim());var cell=tr.querySelector('.roster-stats-cell');if(cell&&cell.textContent!==text)cell.textContent=text;});
}
async function updateMatchups(year,id,meta){
var context=pairs,week=value('week-select');if(!context||context.year!==year||context.week!==week||!leagues[id])return;
var data=await stats(year,week);if(pairs!==context||value('season-select')!==year||value('week-select')!==week)return;
var list=document.getElementById('matchups-list');if(!list)return;
list.querySelectorAll('.matchup-card').forEach(function(card){
var headers=card.querySelectorAll('.matchup-row'),cols=card.querySelectorAll('.matchup-roster-col');if(!headers.length||!cols.length)return;
var pair=context.rows.find(function(p){return headers[0].textContent.indexOf(p.teamA.teamName) >=0 && (!p.teamB||(headers[1]&&headers[1].textContent.indexOf(p.teamB.teamName)>=0));});if(!pair)return;
if(cols[0])put(cols[0],renderColumn(pair.teamA,leagues[id],meta,data,snapshots[id]));
if(cols[1]&&pair.teamB)put(cols[1],renderColumn(pair.teamB,leagues[id],meta,data,snapshots[id]));
});
}
async function refresh(){
if(busy)return;var year=value('season-select'),id=A.SLEEPER_SEASONS[year];
var box=document.getElementById('roster-ir-details');if(!id){if(box)box.hidden=true;return;}
busy=true;try{var meta=await A.getPlayersMap();if(value('season-select')!==year)return;
if(!snapshots[id]){try{await A.getRosters(id);}catch(e){console.warn('IR snapshot unavailable',e);}}
if(!leagues[id])await A.getLeague(id);
await Promise.all([updateWeekly(year,id,meta),updateMatchups(year,id,meta)]);
}catch(e){console.error('Sleeper roster details',e);}finally{busy=false;if(value('season-select')!==year)schedule();}
}
function schedule(){clearTimeout(timer);timer=setTimeout(refresh,100);}
function init(){
['season-select','roster-week-select','roster-team-select','week-select'].forEach(function(id){var e=document.getElementById(id);if(e)e.addEventListener('change',schedule);});
['roster-table','matchups-list'].forEach(function(id){var e=document.getElementById(id);if(e)new MutationObserver(schedule).observe(e,{childList:true,subtree:true,characterData:true});});
var panel=document.getElementById('tab-matchups');if(panel)panel.addEventListener('click',schedule);
schedule();
}
window.SleeperRosterDetails={extraStats:extraStats,irHTML:irHTML,ordered:ordered};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
