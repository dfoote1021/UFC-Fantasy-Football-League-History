/* Sleeper roster details: display only; no scoring or lineup-efficiency changes. */
(function(){
'use strict';
var A=window.SleeperAPI;if(!A)return;
var leagues={},snapshots={},pairs=null,statCache={},byeCache={},busy=false,queued=false,timer=null,nflState=null,statePromise=null,stateTime=0;
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
return fields.filter(function(f){return s&&number(s[f[0]])&&Number(s[f[0]])>0;}).map(function(f){return f[1]+': '+Number(s[f[0]]);}).join(' | ');
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
function teamCode(t){var code=String(t||'').toUpperCase();return {JAC:'JAX',WSH:'WAS',LA:'LAR'}[code]||code;}
function byeSchedule(year){
if(!byeCache[year])byeCache[year]=fetch('https://fantasy.espn.com/apis/v3/games/ffl/seasons/'+year+'?view=proTeamSchedules_wl').then(function(r){if(!r.ok)throw new Error('Bye schedule HTTP '+r.status);return r.json();}).then(function(d){
if(d.seasonId&&Number(d.seasonId)!==Number(year))throw new Error('Bye schedule season mismatch');
var teams=d.settings&&d.settings.proTeams||d.proTeams||[],map={};
teams.forEach(function(t){var code=teamCode(t.abbrev||t.abbreviation);if(code&&number(t.byeWeek)&&Number(t.byeWeek)>=1&&Number(t.byeWeek)<=18)map[code]=Number(t.byeWeek);});
if(Object.keys(map).length<30)throw new Error('Incomplete bye schedule');return map;
}).catch(function(e){delete byeCache[year];console.warn('Bye verification unavailable',e);return {};});return byeCache[year];
}
function currentState(){if(statePromise&&Date.now()-stateTime<300000)return statePromise;stateTime=Date.now();statePromise=A.getNFLState().then(function(s){nflState=s;return s;}).catch(function(){nflState=null;return null;});return statePromise;}
function activity(s){
if(!s)return false;
return ['pass_att','rush_att','rec','rec_tgt','pass_yd','rush_yd','rec_yd','pass_td','rush_td','rec_td','pass_int','fum_lost','fga','fgm','xpa','xpm','sack','int','fum_rec','def_td','def_st_td','def_snap','rush_fd','rec_fd','pass_cmp_40p','rush_40p','rec_40p'].some(function(k){return number(s[k])&&Number(s[k])!==0;})||number(s.pts_allow);
}
function fullStats(s,pos){var base=s&&window.RosterStats?window.RosterStats.formatStats(s,pos):'';var extra=extraStats(s,pos);return [base,extra].filter(Boolean).join(' | ');}
function statText(data,id,pos,year,week,meta,byes){
if(data===null)return 'Stats could not be loaded';
var row=data&&data[id],s=row&&row.stats,team=row&&row.team;
if(!team&&nflState&&String(nflState.season)===String(year)&&Number(nflState.week)===Number(week))team=(meta[id]||{}).team;
if(team&&byes[teamCode(team)]===Number(week))return 'On bye';
return activity(s)?fullStats(s,pos)||'No stats':'No stats';
}
function ordered(side,league,meta){
var rows=A.resolveMatchupRoster(side,meta),layout=window.WeeklyRosterLayout;
return layout?layout.layout(rows,side,league.roster_positions||[],meta):rows;
}
function renderColumn(side,league,meta,statMap,snapshot,year,week,byes){
var slots=(league.roster_positions||[]).filter(function(s){return ['BN','IR','TAXI','RESERVE'].indexOf(s)<0;});
if(!side.starters||slots.length!==side.starters.length)return '<p class="status-text">Assigned lineup slots unavailable.</p>';
var rows=ordered(side,league,meta);
if(rows.some(function(r){return !r.slot;}))return '<p class="status-text">Roster ordering could not be resolved.</p>';
return '<h5>'+esc(side.teamName||side.displayName||'Team')+'</h5><ul>'+rows.map(function(p){var id=p.playerId;return '<li class="'+(p.isStarter?'':'bench-player')+'"><div><span>'+esc(label(p.slot))+' &middot; '+esc(p.name||p.playerName)+'</span><div class="status-text">'+esc(statText(statMap,id,p.position,year,week,meta,byes))+'</div></div><span>'+ (number(p.points)?Number(p.points).toFixed(2):'Unavailable')+'</span></li>';}).join('')+'</ul>'+irHTML(side,snapshot,side.rosterId,meta);
}
function put(element,html){var template=document.createElement('template');template.innerHTML=html;var canonical=template.innerHTML;if(element.innerHTML!==canonical)element.innerHTML=canonical;}
function enhanceBench(card,pair,meta,data,year,week,byes){
var pool=new Set();[pair.teamA,pair.teamB].filter(Boolean).forEach(function(side){var starters=new Set((side.starters||[]).map(String));(side.players||[]).map(String).forEach(function(id){if(!starters.has(id))pool.add(id);});});
card.querySelectorAll('li.bench-player').forEach(function(li){
var text=li.textContent,found=Array.from(pool).filter(function(id){return meta[id]&&text.indexOf(name(meta,id))>=0;});if(found.length!==1)return;
var id=found[0],line=statText(data,id,meta[id].position,year,week,meta,byes);
var cell=li.querySelector('.srd-bench-stats')||li.querySelector('div .status-text');
if(!cell){cell=document.createElement('div');cell.className='status-text srd-bench-stats';li.appendChild(cell);}
if(cell.textContent!==line)cell.textContent=line;
});
}
function renderIRTable(table,snapshot,rid,meta,week){
var old=document.getElementById('roster-ir-details');if(old)old.hidden=true;
var body=table.querySelector('tbody[data-srd-ir]');if(!body){body=document.createElement('tbody');body.setAttribute('data-srd-ir','true');table.appendChild(body);}
body.hidden=false;var count=table.querySelectorAll('thead th').length||6,entry=snapshot&&(snapshot.rows||[]).find(function(r){return String(r.roster_id)===String(rid);}),ids=entry&&Array.isArray(entry.reserve)?entry.reserve:null;
var html='<tr><td colspan="'+count+'">Latest available roster IR &mdash; '+esc(snapshot?'retrieved '+snapshot.time:'snapshot not loaded')+'. These are not verified historical Week '+esc(week)+' assignments; no weekly scores are assigned to these snapshot rows.</td></tr>';
if(ids===null)html+='<tr><td colspan="'+count+'">IR roster snapshot could not be loaded.</td></tr>';
else if(!ids.length)html+='<tr><td colspan="'+count+'">No players in the latest available roster IR list.</td></tr>';
else ids.forEach(function(id){var p=meta[id]||{};html+='<tr><td>IR (snapshot)</td><td>'+esc(name(meta,String(id)))+'</td><td>'+esc(p.position||'')+'</td><td>'+esc(p.team||'')+'</td><td>&mdash;</td>'+(count>5?'<td>Snapshot only &mdash; not a selected-week stat line</td>':'')+'</tr>';});
put(body,html);
}
async function updateWeekly(year,id,meta){
var week=value('roster-week-select'),rid=value('roster-team-select');if(!week||!rid)return;
var loaded=await Promise.all([stats(year,week),byeSchedule(year),currentState()]),data=loaded[0],byes=loaded[1];if(value('season-select')!==year||value('roster-week-select')!==week||value('roster-team-select')!==rid)return;
var panel=document.getElementById('tab-rosters'),table=document.getElementById('roster-table');if(!panel||!table)return;
renderIRTable(table,snapshots[id],rid,meta,week);
var byName={};Object.keys(meta).forEach(function(pid){var n=name(meta,pid);if(byName[n]===undefined)byName[n]=pid;else byName[n]=null;});
var main=table.querySelector('tbody:not([data-srd-ir])');if(!main)return;
main.querySelectorAll('tr').forEach(function(tr){var cells=tr.querySelectorAll('td');if(cells.length<5)return;var pid=byName[cells[1].textContent.trim()];if(!pid)return;var text=statText(data,pid,cells[2].textContent.trim(),year,week,meta,byes),cell=tr.querySelector('.roster-stats-cell');if(cell&&cell.textContent!==text)cell.textContent=text;});
}
async function updateMatchups(year,id,meta){
var context=pairs,week=value('week-select');if(!context||context.year!==year||context.week!==week||!leagues[id])return;
var loaded=await Promise.all([stats(year,week),byeSchedule(year),currentState()]),data=loaded[0],byes=loaded[1];if(pairs!==context||value('season-select')!==year||value('week-select')!==week)return;
var list=document.getElementById('matchups-list');if(!list)return;
list.querySelectorAll('.matchup-card').forEach(function(card){
var headers=card.querySelectorAll('.matchup-row'),cols=card.querySelectorAll('.matchup-roster-col');if(!headers.length)return;
var pair=context.rows.find(function(p){return headers[0].textContent.indexOf(p.teamA.teamName) >=0 && (!p.teamB||(headers[1]&&headers[1].textContent.indexOf(p.teamB.teamName)>=0));});if(!pair)return;
if(cols[0])put(cols[0],renderColumn(pair.teamA,leagues[id],meta,data,snapshots[id],year,week,byes));
if(cols[1]&&pair.teamB)put(cols[1],renderColumn(pair.teamB,leagues[id],meta,data,snapshots[id],year,week,byes));
enhanceBench(card,pair,meta,data,year,week,byes);
});
}
async function refresh(){
if(busy){queued=true;return;}var year=value('season-select'),id=A.SLEEPER_SEASONS[year];
var box=document.getElementById('roster-ir-details'),irBody=document.querySelector('#roster-table tbody[data-srd-ir]');if(!id){if(box)box.hidden=true;if(irBody)irBody.hidden=true;return;}
busy=true;try{var meta=await A.getPlayersMap();if(value('season-select')!==year)return;
if(!snapshots[id]){try{await A.getRosters(id);}catch(e){console.warn('IR snapshot unavailable',e);}}
if(!leagues[id])await A.getLeague(id);
await Promise.all([updateWeekly(year,id,meta),updateMatchups(year,id,meta)]);
}catch(e){console.error('Sleeper roster details',e);}finally{busy=false;if(queued||value('season-select')!==year){queued=false;schedule();}}
}
function schedule(){clearTimeout(timer);timer=setTimeout(refresh,100);}
function init(){
if(!document.getElementById('matchup-layout-style')){
var style=document.createElement('style');style.id='matchup-layout-style';
style.textContent='#matchups-list{grid-template-columns:repeat(3,minmax(0,1fr));align-items:start}'+
'#matchups-list .matchup-card,#matchups-list .matchup-roster-col{min-width:0}'+
'#matchups-list .matchup-rosters.expanded{grid-template-columns:repeat(2,minmax(0,1fr))}'+
'#matchups-list .matchup-roster-col li{gap:8px;align-items:flex-start}'+
'#matchups-list .matchup-roster-col li>div{min-width:0;flex:1;overflow-wrap:anywhere}'+
'#matchups-list .matchup-roster-col li>span{flex-shrink:0;white-space:nowrap}'+
'#matchups-list li.bench-player{flex-wrap:wrap}#matchups-list .srd-bench-stats{flex-basis:100%;width:100%}'+
'#matchups-list .matchup-row>span:first-child{min-width:0;overflow-wrap:anywhere}'+
'@media(max-width:1099px){#matchups-list{grid-template-columns:repeat(2,minmax(0,1fr))}}'+
'@media(max-width:780px){#matchups-list{grid-template-columns:1fr}}'+
'@media(max-width:600px){#matchups-list .matchup-rosters.expanded{grid-template-columns:1fr}}';
document.head.appendChild(style);
}
['season-select','roster-week-select','roster-team-select','week-select'].forEach(function(id){var e=document.getElementById(id);if(e)e.addEventListener('change',schedule);});
['roster-table','matchups-list'].forEach(function(id){var e=document.getElementById(id);if(e)new MutationObserver(schedule).observe(e,{childList:true,subtree:true,characterData:true});});
var panel=document.getElementById('tab-matchups');if(panel)panel.addEventListener('click',schedule);
schedule();
}
window.SleeperRosterDetails={extraStats:extraStats,irHTML:irHTML,ordered:ordered,statText:statText,activity:activity};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
