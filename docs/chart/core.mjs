// Strict adapters for the observed public SafeTrade v2 payloads. Never coerce null to 0.
export function number(v, positive=false) {
  if (!['number','string'].includes(typeof v) || String(v).trim()==='') throw Error('Missing numeric field');
  const n=Number(v); if(!Number.isFinite(n) || (positive ? n<=0 : n<0)) throw Error('Invalid numeric field'); return n;
}
export function identity(currency, market) {
  if(currency.id!=='qtc' || currency.name.toLowerCase()!=='qubitcoin' || market.id!=='qtcusdt' || market.base_unit!=='qtc' || market.quote_unit!=='usdt') throw Error('Market identity mismatch: expected Qubitcoin QTC/USDT');
}
export function ticker(raw) {
  if(raw.id!=='qtcusdt' || raw.base_unit!=='qtc' || raw.quote_unit!=='usdt') throw Error('Unexpected ticker market');
  return {last:number(raw.last,true),high:number(raw.high,true),low:number(raw.low,true),base:number(raw.amount),quote:number(raw.volume),change:String(raw.price_change_percent)};
}
export function candles(raw,period,now=Date.now()/1000) {
  if(!Array.isArray(raw) || !raw.length) throw Error('No candles returned');
  const rows=raw.map(r=>{if(!Array.isArray(r)||r.length!==6) throw Error('Unexpected OHLCV format'); const [time,open,high,low,close,volume]=r.map((x,i)=>number(x,i>0&&i<5)); if(!Number.isInteger(time)||time<1e9||time>now+120||high<Math.max(open,close)||low>Math.min(open,close)||low>high) throw Error('Invalid candle'); return {time,open,high,low,close,volume};}).sort((a,b)=>a.time-b.time);
  if(rows.some((r,i)=>i && (r.time===rows[i-1].time || (r.time-rows[i-1].time)%(period*60)!==0))) throw Error('Duplicate candles or unexpected interval');
  return rows;
}
export function currentHistory(rows,period,now=Date.now()/1000){return rows.length>0 && now-rows.at(-1).time<=2*period*60+150;}
export function depth(raw) {
  const side=(r,desc)=>{if(!Array.isArray(r)) throw Error('Invalid depth format');return r.map(x=>{if(!Array.isArray(x)||x.length!==2) throw Error('Invalid depth level'); return {price:number(x[0],true),size:number(x[1],true)};}).sort((a,b)=>desc?b.price-a.price:a.price-b.price);};
  const bids=side(raw.bids,true),asks=side(raw.asks,false); if(bids.length&&asks.length&&bids[0].price>=asks[0].price) throw Error('Crossed order book'); return {bids,asks};
}
export function latestTrade(raw,now=Date.now()/1000) {
  if(!Array.isArray(raw)||!raw.length) throw Error('No recent trades available');
  const dates=raw.map(r=>{if(r.market && r.market!=='qtcusdt') throw Error('Wrong trade market');const t=Date.parse(r.created_at)/1000;if(!Number.isFinite(t)||t>now+120) throw Error('Invalid trade timestamp');return t;});return Math.max(...dates);
}
export function ema(v,p) {const out=Array(v.length).fill(null);let sum=0,seed=null;for(let i=0;i<v.length;i++){if(v[i]===null){sum=0;seed=null;continue;} if(seed===null){sum+=v[i];const start=i-p+1;if(start>=0&&v.slice(start,i+1).every(x=>x!==null)){seed=sum/p;out[i]=seed;}}else{seed=v[i]*2/(p+1)+seed*(1-2/(p+1));out[i]=seed;}}return out;}
export const defaultSettings={emaFast:20,emaSlow:50,bbPeriod:20,bbDeviation:2,rsiPeriod:14,macdFast:12,macdSlow:26,macdSignal:9,smaPeriod:50,atrPeriod:14,stochPeriod:14};
export function settings(input={}) {const c={...defaultSettings,...input};for(const [k,v] of Object.entries(c)){if(!Number.isFinite(v)||v<1||v>200||(k!=='bbDeviation'&&!Number.isInteger(v)))throw Error('Indicator periods must be whole numbers from 1 to 200');}if(c.macdFast>=c.macdSlow)throw Error('MACD fast period must be below its slow period');if(c.bbDeviation>5)throw Error('Bollinger deviation must be 1–5');return c;}
export function indicators(rows,period,config={}) {
  const c=settings(config),result={ema20:[],ema50:[],upper:[],middle:[],lower:[],rsi:[],macd:[],signal:[],hist:[],sma:[],vwap:[],atr:[],stochK:[],stochD:[]};
  // Restart each calculation after a missing bar instead of treating unequal time gaps as equal.
  const segments=[];for(const row of rows){if(!segments.length || row.time-segments.at(-1).at(-1).time!==period*60) segments.push([]);segments.at(-1).push(row);}
  for(const s of segments){const v=s.map(r=>r.close),e20=ema(v,c.emaFast),e50=ema(v,c.emaSlow),e12=ema(v,c.macdFast),e26=ema(v,c.macdSlow),m=v.map((_,i)=>e26[i]===null?null:e12[i]-e26[i]),signal=ema(m,c.macdSignal),rs=Array(v.length).fill(null),trueRanges=[];let gain=0,loss=0,atr=null;
    const push=(key,i,value)=>{if(value!==null&&Number.isFinite(value))result[key].push({time:s[i].time,value});};
    for(let i=0;i<s.length;i++){push('ema20',i,e20[i]);push('ema50',i,e50[i]);push('macd',i,m[i]);push('signal',i,signal[i]);if(signal[i]!==null)push('hist',i,m[i]-signal[i]);
      if(i>=c.bbPeriod-1){const w=v.slice(i-c.bbPeriod+1,i+1),avg=w.reduce((a,b)=>a+b,0)/c.bbPeriod,sd=Math.sqrt(w.reduce((a,b)=>a+(b-avg)**2,0)/c.bbPeriod);push('middle',i,avg);push('upper',i,avg+c.bbDeviation*sd);push('lower',i,avg-c.bbDeviation*sd);}
      if(i>=c.smaPeriod-1)push('sma',i,v.slice(i-c.smaPeriod+1,i+1).reduce((a,b)=>a+b,0)/c.smaPeriod);
      if(Number.isFinite(s[i].high)&&Number.isFinite(s[i].low)){const tr=i?Math.max(s[i].high-s[i].low,Math.abs(s[i].high-v[i-1]),Math.abs(s[i].low-v[i-1])):s[i].high-s[i].low;trueRanges.push(tr);if(trueRanges.length===c.atrPeriod)atr=trueRanges.reduce((a,b)=>a+b,0)/c.atrPeriod;else if(trueRanges.length>c.atrPeriod)atr=(atr*(c.atrPeriod-1)+tr)/c.atrPeriod;push('atr',i,atr);}
      if(i>0){const d=v[i]-v[i-1],p=c.rsiPeriod;if(i<=p){gain+=Math.max(d,0)/p;loss+=Math.max(-d,0)/p;}else{gain=(gain*(p-1)+Math.max(d,0))/p;loss=(loss*(p-1)+Math.max(-d,0))/p;}if(i>=p){rs[i]=loss===0?(gain===0?50:100):100-100/(1+gain/loss);push('rsi',i,rs[i]);}}
    }
    const raw=rs.map((r,i)=>{const w=rs.slice(i-c.stochPeriod+1,i+1);if(r===null||i<c.stochPeriod-1||w.some(x=>x===null))return null;const lo=Math.min(...w),hi=Math.max(...w);return hi===lo?50:100*(r-lo)/(hi-lo);});
    const sma=(a,p)=>a.map((_,i)=>i>=p-1&&a.slice(i-p+1,i+1).every(x=>x!==null)?a.slice(i-p+1,i+1).reduce((x,y)=>x+y,0)/p:null),k=sma(raw,3),d=sma(k,3);for(let i=0;i<s.length;i++){push('stochK',i,k[i]);push('stochD',i,d[i]);}
  }
  let day=null,pv=0,volume=0;for(const r of rows){const next=Math.floor(r.time/86400);if(day!==next){day=next;pv=0;volume=0;}if(Number.isFinite(r.volume)&&Number.isFinite(r.high)&&Number.isFinite(r.low)){pv+=(r.high+r.low+r.close)/3*r.volume;volume+=r.volume;if(volume>0)result.vwap.push({time:r.time,value:pv/volume});}}
  return result;
}
export function freshness(feed,now,threshold) {if(feed.error)return feed.at?'Stale · request failed':'Unavailable';if(!feed.at)return 'Connecting';return now-feed.at>threshold?'Stale':'Connected';}
