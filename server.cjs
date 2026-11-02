'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {randomBytes,randomInt} = require('node:crypto');
const {WebSocketServer,WebSocket} = require('ws');
const {Race} = require('./engine');
const ASSETS = __dirname;
const allowed = new Set(['index.html','style.css','engine.js','game.js','online.js','voice.js','voice-worklet.js']);
function seeded(seed) { return () => { seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; }; }
function send(ws,message) {
  if(ws.readyState!==WebSocket.OPEN)return;
  if(message.type==='state' && ws.bufferedAmount>64*1024)return;
  if(ws.bufferedAmount>1024*1024){ws.close(1013,'Connection too slow');return;}
  // Final results and room events must survive a brief backlog of state snapshots.
  ws.send(JSON.stringify(message));
}
function cleanName(value) { return typeof value==='string' ? value.replace(/[\u0000-\u001f\u007f<>]/g,'').trim().slice(0,18) || 'Racer' : 'Racer'; }
function createGameServer(options={}) {
  const rooms=new Map(), clients=new Set(), admission=new Map();
  const now=options.now || Date.now;
  const server=http.createServer((req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Permissions-Policy','camera=(), microphone=(self)');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' wss: ws://127.0.0.1:* ws://localhost:*; worker-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    if(req.method!=='GET'){res.writeHead(405);return res.end();}
    let route;try{route=new URL(req.url,'http://local').pathname;}catch(_){res.writeHead(400);return res.end();}
    if(route==='/health'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({ok:true,game:'Tanmay Race',version:2}));}
    const file=route==='/'?'index.html':route.slice(1);
    if(!allowed.has(file)){res.writeHead(404);return res.end('Not found');}
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');
    fs.createReadStream(path.join(ASSETS,file)).on('error',()=>res.destroy()).pipe(res);
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:8192,perMessageDeflate:false});
  server.on('upgrade',(req,socket,head)=>{
    const origin=req.headers.origin;
    const permitted = !origin || origin==='https://appassets.androidplatform.net' || origin==='https://'+req.headers.host ||
      (process.env.NODE_ENV!=='production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) ||
      (process.env.ALLOWED_ORIGINS || '').split(',').includes(origin);
    const ip=(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const at=now(), gate=admission.get(ip) || {at,count:0};
    if(at-gate.at>60000){gate.at=at;gate.count=0;}gate.count++;admission.set(ip,gate);
    if(req.url!=='/ws' || !permitted || clients.size>=200 || gate.count>40){socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');return socket.destroy();}
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
  });
  const broadcast=(room,msg)=>room.players.forEach(p=>send(p.ws,msg));
  function lobby(room) {
    broadcast(room,{type:'room',code:room.code,status:room.status,players:room.players.map(p=>({id:p.id,name:p.name,ready:p.ready,mic:p.mic}))});
  }
  function result(room,reason,winnerOverride) {
    if(room.status==='finished')return;
    room.status='finished';room.last=now();
    const players=room.players.map(p=>({id:p.id,name:p.name,score:p.race.score,coins:p.race.coins,distance:Math.floor(p.race.distance/15)}));
    const sorted=[...players].sort((a,b)=>b.score-a.score);
    const winner=winnerOverride || (sorted.length===2 && sorted[0].score!==sorted[1].score ? sorted[0].id : null);
    room.players.forEach(p=>{p.ready=false;p.boost=false;});
    broadcast(room,{type:'result',reason,winner,players});
  }
  function leave(player) {
    const room=player.room;player.room=null;player.mic=false;
    if(!room)return;
    if(['running','countdown'].includes(room.status)) {
      const other=room.players.find(p=>p!==player);result(room,'friend-left',other && other.id);
    }
    room.players=room.players.filter(p=>p!==player);
    if(!room.players.length)rooms.delete(room.code);
    else {room.status='lobby';room.players.forEach(p=>p.ready=false);lobby(room);}
  }
  function start(room) {
    const seed=randomInt(1,0xffffffff);
    room.status='countdown';room.startAt=now()+3000;room.elapsed=0;room.accumulator=0;room.last=now();room.sent=0;
    room.players.forEach(p=>{p.race=new Race(seeded(seed));p.race.reset(820);p.boost=false;p.lastMove=0;});
    broadcast(room,{type:'begin',countdownMs:3000,duration:60});
    snapshot(room);
  }
  function snapshot(room) {
    room.players.forEach(p=>{
      const g=p.race;
      send(p.ws,{type:'state',status:room.status,countdown:Math.max(0,room.startAt-now()),remaining:Math.max(0,60-room.elapsed),
        you:{x:g.x,lane:g.lane,tilt:g.tilt,scroll:g.scroll,speed:g.speed,energy:g.energy,boost:g.boost,boostLocked:g.boostLocked,
          alive:g.alive,score:g.score,coins:g.coins,distance:g.distance,traffic:g.traffic,pickups:g.pickups},
        players:room.players.map(q=>({id:q.id,name:q.name,score:q.race.score,distance:q.race.distance,x:q.race.x,alive:q.race.alive,mic:q.mic}))});
    });
  }
  wss.on('connection',ws=>{
    const p={id:randomBytes(12).toString('hex'),ws,room:null,name:'Racer',ready:false,mic:false,boost:false,race:new Race(),lastInput:now(),lastSeen:now(),alive:true,rateAt:now(),messages:0,audio:0};
    clients.add(p);send(ws,{type:'hello',id:p.id,version:2});
    ws.on('error',()=>{});
    ws.on('pong',()=>{p.alive=true;});
    ws.on('message',(data,binary)=>{
      const at=now();p.lastSeen=at;
      if(at-p.rateAt>=1000){p.rateAt=at;p.messages=0;p.audio=0;}
      if(binary){
        if(++p.audio>35 || data.length!==1280 || !p.room || !p.mic)return;
        for(const other of p.room.players)if(other!==p && other.ws.readyState===WebSocket.OPEN && other.ws.bufferedAmount<32768)other.ws.send(data,{binary:true});
        return;
      }
      if(++p.messages>45){ws.close(1008,'Too many messages');return;}
      let msg;try{msg=JSON.parse(data);}catch(_){return send(ws,{type:'error',message:'Invalid message.'});}
      if(!msg || typeof msg!=='object')return;
      if(msg.type==='ping'){p.lastInput=at;return send(ws,{type:'pong'});}
      if(msg.type==='leave'){leave(p);return send(ws,{type:'left'});}
      if(msg.type==='create' || msg.type==='join'){
        if(p.room)return send(ws,{type:'error',message:'Leave your current room first.'});
        p.name=cleanName(msg.name);let room;
        if(msg.type==='create'){
          if(rooms.size>=100)return send(ws,{type:'error',message:'Server is busy. Try again shortly.'});
          let code;do{code=randomBytes(5).toString('hex').slice(0,8).toUpperCase();}while(rooms.has(code));
          room={code,players:[],status:'lobby',last:at};rooms.set(code,room);
        }else{
          const code=typeof msg.code==='string'?msg.code.toUpperCase().trim():'';room=rooms.get(code);
          if(!room)return send(ws,{type:'error',message:'Room not found. Check the code and use the same server.'});
          if(room.players.length>=2)return send(ws,{type:'error',message:'This room already has two racers.'});
          if(room.status!=='lobby')return send(ws,{type:'error',message:'This race is already in progress.'});
        }
        p.room=room;p.ready=false;p.race=new Race();room.players.push(p);room.last=at;lobby(room);return;
      }
      const room=p.room;if(!room)return;
      if(msg.type==='mic'){p.mic=msg.enabled===true;lobby(room);return;}
      if(msg.type==='ready' && ['lobby','finished'].includes(room.status)){
        p.ready=true;room.last=at;lobby(room);if(room.players.length===2 && room.players.every(q=>q.ready))start(room);return;
      }
      if(msg.type==='input' && room.status==='running'){
        p.lastInput=at;p.boost=msg.boost===true;
        if((msg.move===1 || msg.move===-1) && at-p.lastMove>=70){p.race.move(msg.move);p.lastMove=at;}
      }
    });
    ws.on('close',()=>{leave(p);clients.delete(p);});
  });
  function tick() {
    const at=now();
    for(const room of rooms.values()){
      if(!['running','countdown'].includes(room.status)){
        if(at-room.last>30*60*1000){for(const p of [...room.players]){send(p.ws,{type:'expired'});leave(p);}}continue;
      }
      if(room.status==='countdown' && at>=room.startAt){room.status='running';room.last=at;}
      const dt=Math.max(0,Math.min(.1,(at-room.last)/1000));room.last=at;
      if(room.status==='running'){
        room.accumulator+=dt;
        while(room.accumulator>=.02){
          room.accumulator-=.02;room.elapsed+=.02;
          for(const p of room.players){if(at-p.lastInput>1500)p.boost=false;p.race.tick(.02,p.boost);}
        }
        if(room.elapsed>=60 || room.players.every(p=>!p.race.alive)){
          snapshot(room);result(room,room.elapsed>=60?'time':'crashes');continue;
        }
      }
      if(at-room.sent>=80){snapshot(room);room.sent=at;}
    }
  }
  const timer=options.manualTick?null:setInterval(tick,20);
  const heartbeat=setInterval(()=>{
    for(const p of clients){if(!p.alive || now()-p.lastSeen>20000){p.ws.terminate();continue;}p.alive=false;p.ws.ping();}
    for(const [ip,g] of admission)if(now()-g.at>120000)admission.delete(ip);
  },10000);heartbeat.unref();
  async function close(){clearInterval(timer);clearInterval(heartbeat);for(const p of clients)p.ws.terminate();await new Promise(resolve=>wss.close(resolve));await new Promise(resolve=>server.close(resolve));}
  return {server,wss,rooms,clients,tick,close};
}
if(require.main===module){
  const app=createGameServer();app.server.listen(Number(process.env.PORT)||8787,'0.0.0.0',()=>console.log('Tanmay Race server listening on port '+app.server.address().port));
  process.on('SIGTERM',()=>app.close().then(()=>process.exit(0)));
}
module.exports={createGameServer};
