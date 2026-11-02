(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const canvas = $('road'), ctx = canvas.getContext('2d', {alpha:false});
  const race = new TanmayEngine.Race();
  const W = 420;
  let H = 820, scale = 1, state = 'menu', beforePause = 'running';
  let best = 0, soundEnabled = true;
  try { best = Math.max(0, Number(localStorage.getItem('tanmay.best')) || 0); soundEnabled = localStorage.getItem('tanmay.sound') !== 'off'; } catch (_) {}
  let last = 0, ambient = 0, countdown = 3, lastCount = 0, crashTime = 0;
  let holdingBoost = false, heldDirection = 0, repeatTime = 0, toastTime = 0;
  let steerPointer = null, boostPointer = null;
  let particles = [], newRecord = false;
  let online = false, opponent = null, remoteAt = 0, remoteX = 210;
  const sound = {
    audio:null, engine:null, gain:null,
    init() {
      if (!soundEnabled) return;
      try {
        if (!this.audio) {
          const Audio = window.AudioContext || window.webkitAudioContext;
          if (!Audio) return;
          this.audio = new Audio();
          this.engine = this.audio.createOscillator(); this.engine.type = 'sawtooth';
          const filter = this.audio.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 170;
          this.gain = this.audio.createGain(); this.gain.gain.value = 0;
          this.engine.connect(filter); filter.connect(this.gain); this.gain.connect(this.audio.destination);
          this.engine.start();
        }
        const resume = this.audio.resume(); if (resume && resume.catch) resume.catch(() => {});
      } catch (_) { /* Audio is optional; racing never depends on it. */ }
    },
    tone(hz, duration, volume, shape) {
      if (!soundEnabled || !this.audio || this.audio.state !== 'running') return;
      try {
        const osc = this.audio.createOscillator(), gain = this.audio.createGain(), t = this.audio.currentTime;
        osc.type = shape || 'sine'; osc.frequency.setValueAtTime(hz, t);
        osc.frequency.exponentialRampToValueAtTime(Math.max(30, hz * 0.65), t + duration);
        gain.gain.setValueAtTime(volume || 0.06, t); gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
        osc.connect(gain); gain.connect(this.audio.destination); osc.start(); osc.stop(t + duration);
        osc.onended = () => { osc.disconnect(); gain.disconnect(); };
      } catch (_) {}
    },
    update() {
      if (!this.audio || !this.gain) return;
      const active = soundEnabled && state === 'running' && race.alive;
      this.gain.gain.setTargetAtTime(active ? 0.025 : 0, this.audio.currentTime, 0.08);
      this.engine.frequency.setTargetAtTime(38 + race.speed / 11, this.audio.currentTime, 0.1);
    }
  };
  function save() { try { localStorage.setItem('tanmay.best', String(best)); localStorage.setItem('tanmay.sound', soundEnabled ? 'on' : 'off'); } catch (_) {} }
  function updateSound() { $('soundMenu').textContent = $('soundPause').textContent = soundEnabled ? 'SOUND ON' : 'SOUND OFF'; }
  function toggleSound() { soundEnabled = !soundEnabled; sound.init(); sound.update(); updateSound(); save(); }
  function resize() {
    const bounds = $('game').getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const oldH = H;
    scale = bounds.width / W; H = bounds.height / scale;
    canvas.width = Math.round(bounds.width * dpr); canvas.height = Math.round(bounds.height * dpr);
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    if (!online && Math.abs(H - oldH) > 3 && (state === 'running' || state === 'countdown')) pause();
    // Keep traffic at the same relative distance during a screen-size change.
    const shift = H - race.height;
    race.traffic.forEach(car => car.y += shift); race.pickups.forEach(coin => coin.y += shift);
    race.height = H; race.playerY = H - 192;
  }
  window.addEventListener('resize', resize);
  function show(id, visible) { $(id).hidden = !visible; }
  function resetInputs() { holdingBoost = false; heldDirection = 0; steerPointer = boostPointer = null; $('nitro').classList.remove('active'); }
  function menu() {
    online = false; opponent = null;
    ['left','right','nitro'].forEach(id => $(id).disabled = false);
    state = 'menu'; resetInputs(); particles = [];
    ['pauseScreen','overScreen','hud','controls','speedometer','countdown'].forEach(id => show(id,false));
    show('menu',true); $('menuBest').textContent = best.toLocaleString('en-US');
    $('toast').style.opacity = 0; sound.update();
  }
  function start() {
    sound.init(); resetInputs(); race.reset(H); particles = []; newRecord = false;
    state = 'countdown'; countdown = 3; lastCount = 3;
    ['menu','overScreen','pauseScreen'].forEach(id => show(id,false));
    ['hud','controls','speedometer','countdown'].forEach(id => show(id,true));
    $('countdown').querySelector('strong').textContent = '3';
    $('countdown').querySelector('span').textContent = 'GET READY';
    $('toast').style.opacity = 0; toastTime = 0;
    sound.tone(440,0.12); updateHud();
  }
  function pause() {
    if (online) { if(window.raceOnline)window.raceOnline.requestLeave(); return; }
    if (state !== 'running' && state !== 'countdown') return;
    beforePause = state; state = 'paused'; resetInputs();
    show('countdown',false); show('pauseScreen',true); sound.update();
  }
  function resume() {
    if (state !== 'paused') return;
    sound.init(); state = beforePause; show('pauseScreen',false);
    if (state === 'countdown') show('countdown',true);
    last = performance.now();
  }
  function crash() {
    state = 'crashing'; crashTime = 0; resetInputs();
    newRecord = race.score > best; best = Math.max(best, race.score); save();
    burst(race.x, race.playerY, '#ffbc68', 40); sound.tone(75,0.45,0.18,'sawtooth'); sound.update();
  }
  function finish() {
    state = 'over'; show('controls',false); show('speedometer',false);
    $('resultBadge').textContent = newRecord ? 'NEW PERSONAL BEST!' : 'THE NIGHT ISN’T OVER';
    $('finalScore').textContent = race.score.toLocaleString('en-US');
    $('finalCoins').textContent = race.coins;
    $('finalDistance').textContent = Math.floor(race.distance / 15) + ' m';
    $('finalBest').textContent = best.toLocaleString('en-US'); show('overScreen',true);
  }
  function updateHud() {
    $('score').textContent = String(race.score).padStart(4,'0');
    $('coins').textContent = race.coins; $('bestHud').textContent = 'BEST ' + best;
    $('speed').textContent = Math.round(race.speed * 0.36);
    $('energy').style.width = race.energy + '%';
    $('nitro').classList.toggle('active', state === 'running' && race.boost);
    $('nitroHint').textContent = race.boostLocked ? 'RELEASE TO RECHARGE' : 'HOLD TO BOOST';
  }
  function notify(text) { $('toast').textContent = text; $('toast').style.opacity = 1; toastTime = 1.1; }
  function burst(x,y,color,count) {
    for (let i=0;i<count;i++) particles.push({x,y,vx:(Math.random()-.5)*240,vy:(Math.random()-.5)*260,life:.45+Math.random()*.45,max:1,color,size:2+Math.random()*4});
  }
  function move(dir) { if (state === 'running') { if(online){if(window.raceOnline)window.raceOnline.move(dir);}else race.move(dir); } }
  ['left','right'].forEach((id,i) => {
    $(id).addEventListener('pointerdown', e => { e.preventDefault(); steerPointer = e.pointerId; heldDirection = i ? 1 : -1; repeatTime = .24; move(heldDirection); });
    $(id).addEventListener('contextmenu', e => e.preventDefault());
  });
  $('nitro').addEventListener('pointerdown', e => { e.preventDefault(); if (state === 'running') { holdingBoost = true; boostPointer = e.pointerId; } });
  function releasePointer(e) {
    if (e.pointerId === steerPointer) { heldDirection = 0; steerPointer = null; }
    if (e.pointerId === boostPointer) { holdingBoost = false; boostPointer = null; }
  }
  window.addEventListener('pointerup', releasePointer);
  window.addEventListener('pointercancel', releasePointer);
  let swipeX = null;
  canvas.addEventListener('pointerdown', e => { swipeX = e.clientX; });
  canvas.addEventListener('pointermove', e => {
    if (swipeX === null || state !== 'running') return;
    if (Math.abs(e.clientX - swipeX) > 35 * scale) { move(e.clientX > swipeX ? 1 : -1); swipeX = e.clientX; }
  });
  window.addEventListener('pointerup', () => { swipeX = null; });
  window.addEventListener('pointercancel', () => { swipeX = null; });
  window.addEventListener('keydown', e => {
    if (['ArrowLeft','ArrowRight','ArrowUp',' ','Escape','p','P'].includes(e.key)) e.preventDefault();
    if (e.key === 'ArrowLeft' && !e.repeat) move(-1);
    if (e.key === 'ArrowRight' && !e.repeat) move(1);
    if (e.key === ' ' || e.key === 'ArrowUp') holdingBoost = state === 'running';
    if ((e.key === 'Escape' || e.key.toLowerCase() === 'p') && !e.repeat) state === 'paused' ? resume() : pause();
  });
  window.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'ArrowUp') holdingBoost = false; });
  window.addEventListener('blur', () => { if(!online)pause(); });
  function background() { if(window.raceOnline && window.raceOnline.connected())window.raceOnline.background();else pause(); }
  document.addEventListener('visibilitychange', () => { if (document.hidden) background(); });
  $('start').onclick = $('restart').onclick = start;
  $('pause').onclick = pause; $('resume').onclick = resume;
  $('quit').onclick = $('home').onclick = menu;
  $('soundMenu').onclick = $('soundPause').onclick = toggleSound;
  window.tanmayRace = {pause, background, back() {
    if(window.raceOnline && window.raceOnline.isOpen()){window.raceOnline.back();return true;}
    if (state === 'running' || state === 'countdown') { pause(); return true; }
    if (state === 'paused' || state === 'over') { menu(); return true; }
    return state === 'crashing';
  }};
  window.raceView = {
    menu,
    beginOnline(){
      online=true;opponent=null;race.reset(H);particles=[];resetInputs();sound.init();state='countdown';
      ['menu','overScreen','pauseScreen'].forEach(id=>show(id,false));
      ['hud','controls','speedometer','countdown'].forEach(id=>show(id,true));
      $('countdown').querySelector('strong').textContent='3';$('countdown').querySelector('span').textContent='FRIEND RACE';
      $('toast').style.opacity=0;updateHud();
    },
    applyOnline(snapshot,id){
      if(!online)return;
      const data=snapshot.you,wasAlive=race.alive,oldCoins=race.coins,oldX=race.x,offset=H-820;
      Object.keys(data).forEach(key=>{if(!['score','traffic','pickups','x'].includes(key))race[key]=data[key];});
      race.bonus=data.score-Math.floor(data.distance/12);remoteX=data.x;race.x=oldX;
      race.traffic=data.traffic.map(c=>Object.assign({},c,{y:c.y+offset}));
      race.pickups=data.pickups.map(c=>Object.assign({},c,{y:c.y+offset}));
      opponent=snapshot.players.find(p=>p.id!==id);remoteAt=performance.now();
      state=snapshot.status==='countdown'?'countdown':'running';
      show('countdown',state==='countdown');
      if(state==='countdown')$('countdown').querySelector('strong').textContent=Math.max(1,Math.ceil(snapshot.countdown/1000));
      if(wasAlive && !race.alive){burst(race.x,race.playerY,'#ffbc68',35);sound.tone(75,.4,.1,'sawtooth');notify('CRASHED · WAIT FOR YOUR FRIEND');}
      if(race.coins>oldCoins){burst(race.x,race.playerY,'#ffdb74',10);sound.tone(980,.13,.04);}
      ['left','right','nitro'].forEach(key=>$(key).disabled=!race.alive);
      updateHud();$('bestHud').textContent=race.alive?'FRIEND RACE':'CRASHED · RACE CONTINUES';
    },
    endOnline(){state='over';resetInputs();['controls','speedometer','countdown'].forEach(id=>show(id,false));sound.update();},
    boost(){return online && state==='running' && race.alive && holdingBoost;}
  };

  function rounded(x,y,w,h,r,color) {
    ctx.fillStyle=color; ctx.beginPath(); ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y);
    ctx.quadraticCurveTo(x+w,y,x+w,y+r); ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r); ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.fill();
  }
  function poly(points,color) { ctx.fillStyle=color; ctx.beginPath(); ctx.moveTo(points[0],points[1]); for(let i=2;i<points.length;i+=2)ctx.lineTo(points[i],points[i+1]); ctx.closePath(); ctx.fill(); }
  function drawRoad(scroll) {
    ctx.fillStyle='#080e1c';ctx.fillRect(0,0,W,H);
    for (let y=(scroll*.36)%170-170;y<H;y+=170) {
      rounded(-12,y,52,120,7,'#101b2b');rounded(380,y+65,52,110,6,'#12202e');
      ctx.fillStyle='#1d3446';for(let z=0;z<4;z++){ctx.fillRect(7,y+17+z*23,16,3);ctx.fillRect(398,y+80+z*20,15,3);}
      ctx.fillStyle='#47dacc';ctx.fillRect(39,y+42,4,24);ctx.fillStyle='#e85c88';ctx.fillRect(377,y+126,4,24);
    }
    ctx.fillStyle='#172231';ctx.fillRect(52,0,316,H);
    ctx.fillStyle='#121d2b';ctx.fillRect(62,0,296,H);
    ctx.fillStyle='#ffffff02';for(let y=(scroll%24)-24;y<H;y+=24)ctx.fillRect(62,y,296,1);
    const glow=ctx.createLinearGradient(52,0,368,0);glow.addColorStop(0,'#48eacb20');glow.addColorStop(.12,'#48eacb00');glow.addColorStop(.88,'#e95d8700');glow.addColorStop(1,'#e95d8720');ctx.fillStyle=glow;ctx.fillRect(48,0,324,H);
    ctx.fillStyle='#5ae8cc';ctx.fillRect(54,0,2,H);ctx.fillStyle='#ec7097';ctx.fillRect(364,0,2,H);
    for(let y=(scroll%92)-92;y<H;y+=92){
      ctx.fillStyle='#455568';ctx.fillRect(158,y,2,40);ctx.fillRect(260,y,2,40);
      ctx.fillStyle='#aac6c64d';ctx.fillRect(58,y+2,3,21);ctx.fillStyle='#c49bb34d';ctx.fillRect(359,y+2,3,21);
    }
    if(state==='running' && race.boost){
      ctx.strokeStyle='#60f5d177';ctx.lineWidth=1;
      for(let i=0;i<12;i++){const x=i<6?12+i*6:375+(i-6)*7;const y=(ambient*900+i*87)%(H+180)-100;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x,y+60+i%3*15);ctx.stroke();}
    }
  }
  function car(x,y,color,player,tilt,size) {
    ctx.save();ctx.translate(x,y);ctx.rotate(tilt||0);ctx.scale(size||1,size||1);
    rounded(-31,-44,65,104,15,'#00000055');
    if(player){
      const beam=ctx.createLinearGradient(0,-135,0,-43);beam.addColorStop(0,'#c6faff00');beam.addColorStop(1,'#c6faff25');
      poly([-20,-43,-40,-140,-6,-140,-13,-43],beam);poly([13,-43,6,-140,40,-140,20,-43],beam);
      if(state==='running' && race.boost){
        const len=28+Math.random()*25;poly([-19,44,-15,44+len,-9,44],'#60f5d1');poly([9,44,15,44+len,19,44],'#60f5d1');
        poly([-17,44,-15,44+len*.65,-11,44],'#d5fff5');poly([11,44,15,44+len*.65,17,44],'#d5fff5');
      }
    }
    rounded(-29,-31,8,22,3,'#060b12');rounded(21,-31,8,22,3,'#060b12');rounded(-29,22,8,22,3,'#060b12');rounded(21,22,8,22,3,'#060b12');
    rounded(-24,-48,48,96,12,color);
    poly([-14,-47,14,-47,20,-31,17,39,-17,39,-20,-31],'#ffffff14');
    rounded(-20,-41,7,6,2,'#e4fbff');rounded(13,-41,7,6,2,'#e4fbff');
    poly([-15,-23,15,-23,19,-7,-19,-7],'#092032');
    poly([-13,-22,12,-22,15,-10,-16,-10],'#416578');
    poly([-12,-22,-5,-22,-13,-10,-16,-10],'#b7e2ed40');
    rounded(-16,-2,32,25,5,'#ffffff13');
    poly([-17,28,17,28,14,38,-14,38],'#163244');
    ctx.fillStyle='#f35e75';ctx.fillRect(-20,41,9,4);ctx.fillRect(11,41,9,4);
    ctx.fillStyle='#00000020';ctx.fillRect(-24,-4,3,29);ctx.fillRect(21,-4,3,29);
    if(player){ctx.fillStyle='#16302e';ctx.fillRect(-3,-39,6,13);ctx.fillRect(-3,2,6,19);rounded(-28,36,56,5,2,'#172333');}
    ctx.restore();
  }
  function drawCoin(coin) {
    ctx.save();ctx.translate(coin.x,coin.y);ctx.scale(.72+Math.abs(Math.sin(ambient*3+coin.spin))*.28,1);
    ctx.shadowColor='#ffcf4c';ctx.shadowBlur=13;ctx.fillStyle='#ffce5c';ctx.beginPath();ctx.arc(0,0,11,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
    ctx.strokeStyle='#aa7128';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(0,0,7.5,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#fff2ba';ctx.fillRect(-1,-5,2,10);ctx.restore();
  }
  const colors=['#eb6d91','#7295e8','#b8c7d9','#c390db'];
  function render() {
    const demo=state==='menu';
    ctx.save();
    if(state==='crashing')ctx.translate((Math.random()-.5)*9*(1-crashTime), (Math.random()-.5)*9*(1-crashTime));
    drawRoad(demo?ambient*95:race.scroll);
    if(demo){
      car(108,H*.47,'#7196e3',false,0,.9);car(312,H*.29,'#df729a',false,0,.9);
      car(210,H*.59+Math.sin(ambient*1.5)*3,'#ffe084',true,0,1.05);
    } else {
      race.pickups.forEach(drawCoin);
      race.traffic.forEach(c=>car(c.x,c.y,colors[c.color],false,0,1));
      if(online && opponent && opponent.alive){
        const y=race.playerY-(opponent.distance-race.distance);
        if(y>175 && y<H-120){ctx.globalAlpha=.4;car(opponent.x,y,'#b49aff',false,0,1);ctx.globalAlpha=1;ctx.fillStyle='#ceb9ff';ctx.font='bold 9px Arial';ctx.textAlign='center';ctx.fillText('FRIEND',opponent.x,y-58);}
      }
      car(race.x,race.playerY,'#ffe084',true,race.tilt,1);
    }
    particles.forEach(p=>{ctx.globalAlpha=Math.max(0,p.life/p.max);ctx.fillStyle=p.color;ctx.fillRect(p.x,p.y,p.size,p.size);});ctx.globalAlpha=1;
    if(state==='crashing' && crashTime<.15){ctx.fillStyle='#ffba8033';ctx.fillRect(0,0,W,H);}
    ctx.restore();
  }
  function frame(now) {
    const dt=last ? Math.min(.04,Math.max(0,(now-last)/1000)) : 0;last=now;
    if(state!=='paused')ambient+=dt;
    if(online){
      if(state==='running'){
        if(heldDirection){repeatTime-=dt;if(repeatTime<=0){move(heldDirection);repeatTime=.22;}}
        if(now-remoteAt<250){race.x+=(remoteX-race.x)*Math.min(1,dt*24);if(race.alive){race.scroll+=race.speed*dt;race.traffic.forEach(c=>c.y+=race.speed*dt);race.pickups.forEach(c=>c.y+=race.speed*dt);}}
      }
    }else if(state==='countdown'){
      countdown-=dt;
      const number=Math.ceil(countdown);
      if(number>0 && number!==lastCount){lastCount=number;$('countdown').querySelector('strong').textContent=number;sound.tone(440,.12);}
      if(countdown<=0){state='running';show('countdown',false);sound.tone(880,.2);notify('GO! MAKE IT YOUR NIGHT');}
    } else if(state==='running'){
      if(heldDirection){repeatTime-=dt;if(repeatTime<=0){move(heldDirection);repeatTime=.22;}}
      race.tick(dt,holdingBoost);
      race.events.forEach(e=>{
        if(e.type==='crash')crash();
        if(e.type==='coin'){burst(e.x,e.y,'#ffdb74',10);notify('+50  COIN');sound.tone(980,.13,.045);}
        if(e.type==='near'){notify('+15  CLOSE PASS');sound.tone(560,.08,.02);}
      });
      updateHud();
    } else if(state==='crashing'){crashTime+=dt;if(crashTime>.7)finish();}
    if(state!=='paused'){
      particles.forEach(p=>{p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=190*dt;p.life-=dt;});particles=particles.filter(p=>p.life>0);
      if(toastTime>0){toastTime-=dt;if(toastTime<=0)$('toast').style.opacity=0;}
    }
    sound.update();render();requestAnimationFrame(frame);
  }
  resize();updateSound();menu();requestAnimationFrame(frame);
})();
