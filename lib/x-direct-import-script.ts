/**
 * Builds the "direct import" script that runs inside x.com (as a bookmarklet
 * or pasted into the console). Instead of scrolling the page and sniffing
 * network traffic, it calls X's own Bookmarks/Likes GraphQL endpoint with the
 * user's session cookies, pages through with cursors, and streams each page
 * of raw tweet objects to a sortX window over postMessage (x.com's Content
 * Security Policy blocks direct requests to other origins, but postMessage is
 * not subject to it). The sortX window is either the opener (the Import page
 * opened x.com) or a window this script opens. If neither is reachable it
 * downloads a JSON file that the Import page accepts.
 *
 * Pure: no DOM or database access here, just string building, so it can be
 * unit-tested and generated on either side.
 */

export interface DirectImportScriptOptions {
  /** sortX origin, e.g. http://localhost:3000 */
  origin: string
  bookmarksQueryId: string
  likesQueryId: string | null
  source: 'bookmark' | 'like'
  /** Tweets per page (X caps at 100) */
  pageSize?: number
  /** Safety cap on pages (100 tweets each) */
  maxPages?: number
}

export const X_BEARER =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'

export function buildDirectImportScript(opts: DirectImportScriptOptions): string {
  const cfg = JSON.stringify({
    origin: opts.origin.replace(/\/$/, ''),
    bookmarksQueryId: opts.bookmarksQueryId,
    likesQueryId: opts.likesQueryId,
    source: opts.source,
    pageSize: opts.pageSize ?? 100,
    maxPages: opts.maxPages ?? 600,
    bearer: X_BEARER,
  })

  // NOTE: keep this plain JS (no TS), it is shipped verbatim to the browser.
  return `(async function(){
var C=${cfg};
if(!/(^|\\.)(x|twitter)\\.com$/.test(location.hostname)){alert('Open x.com (logged in) first, then run this.');return;}
if(window.__sortxImportRunning){alert('sortX import is already running on this page.');return;}
window.__sortxImportRunning=true;
var ct0=(document.cookie.match(/(?:^|; )ct0=([^;]+)/)||[])[1];
if(!ct0){alert('You do not seem to be logged in to X in this tab.');window.__sortxImportRunning=false;return;}
var userId=decodeURIComponent((document.cookie.match(/(?:^|; )twid=([^;]+)/)||[])[1]||'').replace(/^u=/,'');
var isLikes=C.source==='like';
var label=isLikes?'likes':'bookmarks';
var sessionId=Date.now().toString(36)+Math.random().toString(36).slice(2,8);
var features={graphql_timeline_v2_bookmark_timeline:true,responsive_web_graphql_exclude_directive_enabled:true,verified_phone_label_enabled:false,creator_subscriptions_tweet_preview_api_enabled:true,responsive_web_graphql_timeline_navigation_enabled:true,responsive_web_graphql_skip_user_profile_image_extensions_enabled:false,tweetypie_unmention_optimization_enabled:true,responsive_web_edit_tweet_api_enabled:true,graphql_is_translatable_rweb_tweet_is_translatable_enabled:true,view_counts_everywhere_api_enabled:true,longform_notetweets_consumption_enabled:true,responsive_web_twitter_article_tweet_consumption_enabled:true,tweet_awards_web_tipping_enabled:false,freedom_of_speech_not_reach_fetch_enabled:true,standardized_nudges_misinfo:true,tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled:true,longform_notetweets_rich_text_read_enabled:true,longform_notetweets_inline_media_enabled:true,responsive_web_enhance_cards_enabled:false};

/* ---------- overlay ---------- */
var box=document.createElement('div');
box.id='sortx-import';
box.style.cssText='position:fixed;top:14px;right:14px;z-index:2147483647;width:300px;padding:14px 16px;background:#0f0f14;color:#e4e4e7;border:1px solid #3f3f46;border-radius:14px;font:13px/1.45 system-ui,-apple-system,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.6)';
box.innerHTML='<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="width:10px;height:10px;border-radius:50%;background:#6366f1;display:inline-block" id="sx-dot"></span><b style="font-size:14px">sortX import</b><span id="sx-src" style="margin-left:auto;color:#a1a1aa;font-size:11px"></span></div><div id="sx-status" style="color:#a1a1aa">Starting…</div><div style="margin-top:6px;font-size:22px;font-weight:700;letter-spacing:-.02em"><span id="sx-count">0</span> <span style="font-size:12px;font-weight:500;color:#a1a1aa" id="sx-unit"></span></div><div id="sx-sub" style="color:#71717a;font-size:11px;margin-top:2px"></div><div style="display:flex;gap:8px;margin-top:12px"><button id="sx-stop" style="flex:1;padding:8px;border-radius:8px;border:1px solid #52525b;background:#18181b;color:#e4e4e7;cursor:pointer;font-weight:600">Stop</button><a id="sx-open" href="'+C.origin+'/import" target="_blank" style="flex:1;padding:8px;border-radius:8px;background:#4f46e5;color:#fff;text-align:center;text-decoration:none;font-weight:600;display:none">Open sortX</a></div>';
document.body.appendChild(box);
var $=function(id){return document.getElementById(id);};
$('sx-src').textContent=label;$('sx-unit').textContent=label+' fetched';
var stopped=false;$('sx-stop').onclick=function(){stopped=true;$('sx-stop').textContent='Stopping…';};
function status(t,c){$('sx-status').textContent=t;if(c)$('sx-status').style.color=c;}
function setDot(c){$('sx-dot').style.background=c;}

/* ---------- X API ---------- */
function unwrap(t){if(!t)return null;if((t.__typename==='TweetWithVisibilityResults'||t.__typename==='TweetWithVisibilityResult')&&t.tweet)return t.tweet;return t;}
function apiUrl(cursor){
  var vars=isLikes?{userId:userId,count:C.pageSize,includePromotedContent:false,withClientEventToken:false,withBirdwatchNotes:false,withVoice:true,withV2Timeline:true}:{count:C.pageSize,includePromotedContent:false};
  if(cursor)vars.cursor=cursor;
  var qid=isLikes?C.likesQueryId:C.bookmarksQueryId;var op=isLikes?'Likes':'Bookmarks';
  return 'https://x.com/i/api/graphql/'+qid+'/'+op+'?variables='+encodeURIComponent(JSON.stringify(vars))+'&features='+encodeURIComponent(JSON.stringify(features));
}
function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}
async function fetchPage(cursor){
  for(var attempt=0;attempt<6;attempt++){
    var res=await fetch(apiUrl(cursor),{headers:{authorization:'Bearer '+C.bearer,'x-csrf-token':ct0,'x-twitter-auth-type':'OAuth2Session','x-twitter-active-user':'yes','content-type':'application/json'},credentials:'include'});
    var text=await res.text();
    if(res.status===400){var m=text.match(/features cannot be null:\\s*([A-Za-z0-9_,\\s]+)/);if(m){m[1].split(',').forEach(function(f){f=f.trim();if(f)features[f]=true;});continue;}}
    if(res.status===429){status('X rate limit hit — pausing 60s (normal for big libraries)','#fbbf24');$('sx-sub').textContent='Waiting for X…';await sleep(60000);$('sx-sub').textContent='';continue;}
    if(res.status===401||res.status===403){throw new Error('X rejected the request ('+res.status+'). Reload x.com, make sure you are logged in, and try again.');}
    if(!res.ok){if(attempt<5){await sleep(1500*(attempt+1));continue;}throw new Error('X returned '+res.status+': '+text.slice(0,120));}
    try{return JSON.parse(text);}catch(e){throw new Error('X returned something that is not JSON');}
  }
  throw new Error('Gave up after repeated errors from X');
}
function parsePage(d){
  var ins=(d&&d.data&&(d.data.bookmark_timeline_v2||(d.data.user&&d.data.user.result&&d.data.user.result.timeline_v2))||{});
  ins=(ins.timeline&&ins.timeline.instructions)||[];
  var tweets=[],cursor=null;
  ins.forEach(function(i){
    (i.entries||[]).forEach(function(e){
      var c=e.content||{};
      if(c.entryType==='TimelineTimelineItem'){var t=unwrap(c.itemContent&&c.itemContent.tweet_results&&c.itemContent.tweet_results.result);if(t&&t.rest_id)tweets.push(t);}
      else if(c.entryType==='TimelineTimelineModule'){(c.items||[]).forEach(function(it){var t=unwrap(it.item&&it.item.itemContent&&it.item.itemContent.tweet_results&&it.item.itemContent.tweet_results.result);if(t&&t.rest_id)tweets.push(t);});}
      else if(c.entryType==='TimelineTimelineCursor'&&c.cursorType==='Bottom'){cursor=c.value||null;}
    });
    if(i.type==='TimelineReplaceEntry'&&i.entry&&i.entry.content&&i.entry.content.cursorType==='Bottom'){cursor=i.entry.content.value||cursor;}
  });
  return {tweets:tweets,cursor:cursor};
}

/* ---------- send to sortX (postMessage; CSP blocks fetch to other origins) ---------- */
var sortxOk=true,all=[],imported=0,skipped=0,receiver=null,seq=0,ackWaiters={},readyResolve=null;
window.addEventListener('message',function(ev){
  if(ev.origin!==C.origin)return;var d=ev.data||{};if(d.sessionId!==sessionId)return;
  if(d.type==='sortx:ready'&&readyResolve){readyResolve(true);}
  if(d.type==='sortx:ack'&&ackWaiters[d.seq]){ackWaiters[d.seq](d);delete ackWaiters[d.seq];}
});
function findReceiver(){
  try{if(window.opener&&!window.opener.closed)return window.opener;}catch(e){}
  try{return window.open(C.origin+'/import','sortx-receiver');}catch(e){return null;}
}
async function connect(){
  receiver=findReceiver();if(!receiver)return false;
  return await new Promise(function(res){
    var tries=0;var iv=setInterval(function(){
      try{receiver.postMessage({type:'sortx:hello',sessionId:sessionId,source:C.source},C.origin);}catch(e){}
      if(++tries>48){clearInterval(iv);readyResolve=null;res(false);}
    },250);
    readyResolve=function(){clearInterval(iv);readyResolve=null;res(true);};
  });
}
async function send(tweets,done,total){
  if(!sortxOk)return;
  var s=++seq;
  var ack=await new Promise(function(res){
    ackWaiters[s]=res;
    try{receiver.postMessage({type:'sortx:batch',sessionId:sessionId,seq:s,tweets:tweets,source:C.source,done:!!done,total:total},C.origin);}
    catch(e){delete ackWaiters[s];res(null);}
    setTimeout(function(){if(ackWaiters[s]){delete ackWaiters[s];res(null);}},120000);
  });
  if(!ack||ack.error){sortxOk=false;status('Lost contact with sortX — will download a file instead','#fbbf24');return;}
  imported+=ack.imported||0;skipped+=ack.skipped||0;
}
function download(){
  var blob=new Blob([JSON.stringify({tweets:all,source:C.source},null,1)],{type:'application/json'});
  var url=URL.createObjectURL(blob);var a=document.createElement('a');a.href=url;a.download='sortx-'+label+'.json';a.click();setTimeout(function(){URL.revokeObjectURL(url);},2000);
}

/* ---------- main loop (no timers: background tabs throttle setTimeout) ---------- */
var seen={},cursor=null,pages=0,idle=0;
try{
  if(isLikes&&!userId)throw new Error('Could not read your user id from cookies (needed for likes).');
  if(isLikes&&!C.likesQueryId)throw new Error('Likes import is not available right now (query id unknown).');
  status('Connecting to sortX…');
  sortxOk=await connect();
  if(!sortxOk){status('sortX window not reachable — will save a file you can upload','#fbbf24');}
  status('Fetching '+label+' from X…');
  while(!stopped&&pages<C.maxPages){
    var page=await fetchPage(cursor);pages++;
    var parsed=parsePage(page);
    var fresh=parsed.tweets.filter(function(t){if(seen[t.rest_id])return false;seen[t.rest_id]=1;return true;});
    all=all.concat(fresh);
    $('sx-count').textContent=all.length.toLocaleString();
    $('sx-sub').textContent='page '+pages+(sortxOk?' · sent to sortX':' · saving locally');
    if(fresh.length)await send(fresh,false);
    if(!parsed.cursor||parsed.tweets.length===0){break;}
    if(fresh.length===0){idle++;if(idle>=2)break;}else idle=0;
    cursor=parsed.cursor;
  }
  if(sortxOk){await send([],true,all.length);}
  setDot('#22c55e');
  if(sortxOk){status((stopped?'Stopped. ':'Done. ')+all.length.toLocaleString()+' '+label+' sent to sortX ('+imported+' new, '+skipped+' already there).','#86efac');$('sx-open').style.display='block';try{receiver.focus();}catch(e){}}
  else{download();status('Downloaded sortx-'+label+'.json — upload it on the sortX Import page.','#86efac');$('sx-open').style.display='block';}
}catch(err){
  setDot('#ef4444');status('Error: '+(err&&err.message||err),'#fca5a5');
  if(all.length&&!sortxOk)download();
}
$('sx-stop').textContent='Close';$('sx-stop').onclick=function(){box.remove();};
window.__sortxImportRunning=false;
})();`
}

export function toBookmarkletHref(script: string): string {
  return `javascript:${encodeURIComponent(script)}`
}
