'use strict';

const state = { data: null, scenario: 'medium', selectedDate: '2027-02-12' };
const byId = id => document.getElementById(id);
const weekdayShort = day => ({Monday:'Mon',Tuesday:'Tue',Wednesday:'Wed',Thursday:'Thu',Friday:'Fri',Saturday:'Sat',Sunday:'Sun'}[day] || day.slice(0,3));
const compactDate = iso => { const [y,m,d] = iso.split('-').map(Number); return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m-1]} ${d}`; };
const round = n => Math.round(n).toLocaleString('en-US');
const formatPct = n => `${Number(n).toFixed(1)}%`;
const escapeHtml = x => String(x).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function setText(id, value) { byId(id).textContent = value; }

function makeDailyChart(days) {
  const width=720, height=268, left=35, right=14, top=15, bottom=36;
  const w=width-left-right, h=height-top-bottom;
  const maxVal=Math.max(10,...days.flatMap(d=>[d.baseline_arrivals,d.predicted_arrivals]));
  const topValue=Math.ceil(maxVal/10)*10;
  const stepY=h/topValue;
  const groupW=w/days.length, barW=Math.min(28,groupW*.28);
  const grid=[];
  for(let tick=0;tick<=4;tick++) {
    const num=topValue*tick/4;
    const y=top+h-num*stepY;
    grid.push(`<line x1="${left}" y1="${y}" x2="${width-right}" y2="${y}" stroke="#e8edf5" stroke-dasharray="3 5"/><text x="${left-10}" y="${y+4}" text-anchor="end" fill="#9aa8bb" font-size="11">${num.toFixed(num%1?1:0)}</text>`);
  }
  const columns=days.map((d,i)=>{
    const cx=left+groupW*(i+.5);
    const h0=d.baseline_arrivals*stepY, h1=d.predicted_arrivals*stepY;
    const x0=cx-barW-3, x1=cx+3;
    const lab=`${weekdayShort(d.day_of_week)} ${Number(d.date.slice(-2))}`;
    return `<g><rect x="${x0}" y="${top+h-h0}" width="${barW}" height="${h0}" rx="4" fill="#cbd9ed"><title>${escapeHtml(lab)} normal baseline: ${d.baseline_arrivals.toFixed(2)} aircraft</title></rect><rect x="${x1}" y="${top+h-h1}" width="${barW}" height="${h1}" rx="4" fill="#467fda"><title>${escapeHtml(lab)} event forecast: ${d.predicted_arrivals} aircraft</title></rect><text x="${cx}" y="${top+h+23}" text-anchor="middle" fill="#8797ac" font-size="12" font-weight="600">${escapeHtml(weekdayShort(d.day_of_week))}</text></g>`;
  }).join('');
  byId('dailyChart').innerHTML=`<title>Baseline compared with event-week predicted arrivals</title>${grid.join('')}${columns}`;
}

function makeDateTabs(days){
  byId('dateTabs').innerHTML=days.map(d=>`<button type="button" class="${d.date===state.selectedDate?'selected':''}" data-date="${d.date}" aria-pressed="${d.date===state.selectedDate}"><span>${escapeHtml(weekdayShort(d.day_of_week))}</span><strong>${Number(d.date.slice(-2))}</strong></button>`).join('');
}

function renderHourly(scenario){
  const selected=scenario.daily.find(d=>d.date===state.selectedDate) || scenario.daily[0];
  state.selectedDate=selected.date;
  setText('selectedDateTitle', `${selected.day_of_week}, ${compactDate(selected.date)}`);
  const interval=scenario.intervals.filter(d=>d.date===selected.date);
  const top=Math.max(12,...interval.map(d=>d.predicted_arrivals));
  byId('hourlyChart').innerHTML=interval.map(row=>{
    const high=row.uncovered_before>0;
    const barHeight=Math.max(row.predicted_arrivals>0?4:2, row.predicted_arrivals/top*128);
    return `<div class="hour-column" title="${escapeHtml(row.time_label)}: ${row.predicted_arrivals} predicted arrivals; ${row.recommended_extra_teams} additional service teams"><span class="hour-value">${row.predicted_arrivals}</span><span class="hour-bar ${high?'over':''}" style="height:${barHeight}px"></span><span class="hour-tick">${String(row.start_hour).padStart(2,'0')}</span></div>`;
  }).join('');
}

function renderScenario(){
  if(!state.data) return;
  const scenario=state.data.scenarios[state.scenario];
  const s=scenario.summary;
  const dailyPeak=scenario.daily.reduce((a,b)=>a.predicted_arrivals>=b.predicted_arrivals?a:b);
  const peakWindow=scenario.intervals.find(row=>row.date===s.peak_date&&row.time_label===s.peak_time) || scenario.intervals.reduce((a,b)=>a.predicted_arrivals>=b.predicted_arrivals?a:b);
  const uplift=(s.predicted_weekly_arrivals/s.baseline_weekly_arrivals-1)*100;
  setText('kpiTotal',round(s.predicted_weekly_arrivals));
  setText('kpiIncrease',`+${uplift.toFixed(1)}%`);
  setText('kpiPeakDay',weekdayShort(dailyPeak.day_of_week));
  setText('kpiPeakDayDetail',`${compactDate(dailyPeak.date)}  /  ${dailyPeak.predicted_arrivals} arrivals`);
  setText('kpiPeakCount',s.peak_arrivals);
  setText('kpiPeakDetail',`${weekdayShort(peakWindow.day_of_week)} ${compactDate(s.peak_date)} / ${s.peak_time}`);
  setText('kpiCoverage',formatPct(s.coverage_after_pct));
  setText('kpiCoverageDiff',`+${(s.coverage_after_pct-s.coverage_before_pct).toFixed(1)} pts`);
  setText('scenarioLegend',state.scenario[0].toUpperCase()+state.scenario.slice(1));
  setText('peakDateText',`${peakWindow.day_of_week}, ${compactDate(s.peak_date)}`);
  setText('peakTimeText',s.peak_time.replace('-', ' - '));
  setText('peakWindowCount',`${s.peak_arrivals} aircraft`);
  setText('regularCapacityText',`${peakWindow.capacity_before} aircraft`);
  setText('plannedCapacityText',`${peakWindow.capacity_after} aircraft`);
  byId('capacityBeforeBar').style.width=`${Math.min(100,peakWindow.capacity_before/Math.max(1,s.peak_arrivals)*100)}%`;
  byId('capacityAfterBar').style.width=`${Math.min(100,peakWindow.capacity_after/Math.max(1,s.peak_arrivals)*100)}%`;
  const n=peakWindow.recommended_extra_teams;
  setText('recommendationText',n>0?`Consider adding ${n} ground-service ${n===1?'team':'teams'} during the peak window. This would raise modeled service capacity from ${peakWindow.capacity_before} to ${peakWindow.capacity_after} aircraft per two hours.`:'Regular staffing is sufficient for this peak window under the selected scenario. Confirm arrivals and resource availability before operations.');
  setText('coverageAfterNumber',formatPct(s.coverage_after_pct));
  setText('coverageBeforeLabel',formatPct(s.coverage_before_pct));
  setText('coverageAfterLabel',formatPct(s.coverage_after_pct));
  byId('coverageBeforeBar').style.width=`${s.coverage_before_pct}%`;
  byId('coverageAfterBar').style.width=`${s.coverage_after_pct}%`;
  setText('shortageBefore',s.intervals_with_shortage_before);
  setText('shortageAfter',s.intervals_with_shortage_after);
  document.querySelectorAll('[data-scenario]').forEach(b=>{const chosen=b.dataset.scenario===state.scenario;b.classList.toggle('selected',chosen);b.setAttribute('aria-pressed',String(chosen));});
  makeDailyChart(scenario.daily);
  makeDateTabs(scenario.daily);
  renderHourly(scenario);
}

async function initialize(){
  try{
    const response=await fetch('dashboard_data.json',{cache:'no-cache'});
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    const data=await response.json();
    if(!data.scenarios || !data.scenarios.medium || !data.baseline_analysis) throw new Error('Unrecognized dashboard_data.json format');
    state.data=data;
    const a=data.assumptions;
    setText('assumptionDaily',`${data.baseline_analysis.average_daily_arrivals.toFixed(2)} aircraft / day`);
    setText('assumptionTeams',`${a.regular_service_teams}`);
    setText('assumptionCapacity',`${a.aircraft_per_team_per_2h} aircraft`);
    setText('assumptionExtra',`${a.maximum_extra_teams}`);
    setText('assumptionParking',`${Math.round(a.short_stay_share*100)}% at ${a.short_stay_mean_hours}h / ${Math.round(a.long_stay_share*100)}% at ${a.long_stay_mean_hours}h`);
    setText('assumptionFuel',`${Math.round(a.fuel_purchase_share*100)}% buy ~${a.fuel_gallons_per_purchasing_aircraft} gallons`);
    renderScenario();
    document.querySelectorAll('[data-scenario]').forEach(b=>b.addEventListener('click',()=>{state.scenario=b.dataset.scenario;renderScenario();}));
    byId('dateTabs').addEventListener('click',e=>{const b=e.target.closest('[data-date]');if(b){state.selectedDate=b.dataset.date;renderScenario();}});
  }catch(error){
    console.error('ArrivalIQ data loading failed',error);
    byId('dashboardContent').hidden=true;
    byId('loadError').hidden=false;
  }
}

initialize();
