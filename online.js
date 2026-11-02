(function(){
  'use strict';
  const $=id=>document.getElementById(id),show=(id,on)=>$(id).hidden=!on;
  const DEFAULT_SERVER = 'https://tanmay-race.onrender.com';
  let ws=null,id='',room=null,ui='closed',connecting=false,attempt=0,heartbeat=null,retry=null,lastPacket=0,peer=null,voiceErrorUntil=0;
  const voice=new RoomVoice(data=>{if(ws && ws.readyState===1 && ws.bufferedAmount<16384 && room)ws.send(data);},(label,on,error)=>{
    document.querySelectorAll('.mic-button').forEach(b=>{b.textContent=error?'MIC OFF':label;b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on));});
    send({type:'mic',enabled:on});
    if(error){voiceErrorUntil=Date.now()+7000;status(label);$('networkStatus').textContent=label;show('networkStatus',ui==='racing');}
  });
  function status(text){$('onlineStatus').textContent=text;}
  function send(value){if(ws && ws.readyState===1)ws.send(JSON.stringify(value));}
  function getServer(){
    let value=$('serverUrl').value.trim();
    if(!value)throw Error('Add your deployed server URL in Server settings first.');
    if(!/^https?:\/\//i.test(value))value='https://'+value;
    const url=new URL(value);
    const local=url.protocol==='http:' && ['localhost','127.0.0.1'].includes(url.hostname) && location.hostname!=='appassets.androidplatform.net';
    if(url.protocol!=='https:' && !local)throw Error('Use an https:// server address.');
    if(url.username || url.password || url.search || url.hash || !['','/'].includes(url.pathname))throw Error('Use the server homepage address without a path or password.');
    return url.origin;
  }
  function buttons(){['createRoom','joinRoom'].forEach(key=>$(key).disabled=connecting);}
  function open(){
    ui='form';show('menu',false);show('onlineScreen',true);show('connectForm',true);show('roomLobby',false);status('');
    try{$('playerName').value=localStorage.getItem('tanmay.name') || ''; $('serverUrl').value=localStorage.getItem('tanmay.server') || (location.hostname!=='appassets.androidplatform.net' && /^https?:$/.test(location.protocol)?location.origin:DEFAULT_SERVER);}catch(_){$('serverUrl').value=DEFAULT_SERVER;}
    $('serverSettings').open=!$('serverUrl').value;
  }
  async function enter(type){
    if(connecting)return;
    let server;try{server=getServer();}catch(error){$('serverSettings').open=true;status(error.message);return;}
    const code=$('roomInput').value.trim().toUpperCase();
    if(type==='join' && !/^[A-F0-9]{8}$/.test(code)){status('Enter the 8-character room code from your friend.');return;}
    const name=$('playerName').value.trim() || 'Racer';
    try{localStorage.setItem('tanmay.server',server);localStorage.setItem('tanmay.name',name);}catch(_){}
    voice.listen().catch(()=>{});
    const action={type,name,code};
    if(ws && ws.readyState===1 && ws.url===server.replace(/^http/,'ws')+'/ws'){send(action);return;}
    if(ws){ws.onclose=null;ws.close();ws=null;clearInterval(heartbeat);}
    connecting=true;buttons();status('Connecting… a sleeping free server may take about a minute.');
    const token=++attempt,deadline=Date.now()+75000;
    function connect(){
      if(token!==attempt)return;
      const socket=new WebSocket(server.replace(/^http/,'ws')+'/ws');ws=socket;socket.binaryType='arraybuffer';
      socket.onopen=()=>{
        if(token!==attempt){socket.close();return;}
        connecting=false;buttons();lastPacket=Date.now();send(action);
        clearInterval(heartbeat);heartbeat=setInterval(()=>{
          if(!ws || ws.readyState!==1)return;
          send({type:'ping'});
          if(ui==='racing'){
            send({type:'input',boost:window.raceView.boost()});
            const slow=Date.now()-lastPacket>3000;
            if(slow){$('networkStatus').textContent='Connection slow… waiting for server';show('networkStatus',true);}
          }
          if(Date.now()-lastPacket>12000)socket.close();
        },500);
      };
      socket.onmessage=event=>{
        if(token!==attempt)return;lastPacket=Date.now();
        if(typeof event.data!=='string'){voice.receive(event.data);return;}
        let message;try{message=JSON.parse(event.data);}catch(_){return;}
        receive(message);
      };
      socket.onerror=()=>{};
      socket.onclose=()=>{
        if(token!==attempt)return;
        clearInterval(heartbeat);
        if(connecting && Date.now()<deadline){retry=setTimeout(connect,2500);return;}
        const wasRoom=!!room;disconnect(false);open();
        status(wasRoom?'Connection lost. Your mic is off. Create or join a new room.':'Could not connect. Check the server URL and internet, then retry.');
      };
    }
    connect();
  }
  function drawPlayers(){
    $('roomCode').textContent=room.code;
    $('roomPlayers').replaceChildren();
    for(const player of room.players){
      const row=document.createElement('div'),name=document.createElement('span'),detail=document.createElement('small');
      name.textContent=player.name+(player.id===id?' (you)':'');detail.textContent=(player.ready?'READY':'WAITING')+(player.mic?' · MIC ON':'');
      row.append(name,detail);$('roomPlayers').append(row);
    }
    if(room.players.length===1){const row=document.createElement('div');row.textContent='Waiting for your friend…';$('roomPlayers').append(row);}
    const me=room.players.find(p=>p.id===id);
    $('readyRace').disabled=!!(me && me.ready);$('readyRace').textContent=me && me.ready?'WAITING FOR FRIEND…':'I’M READY →';
  }
  function receive(message){
    if(message.type==='hello'){id=message.id;return;}
    if(message.type==='error'){connecting=false;buttons();status(message.message);return;}
    if(message.type==='expired'){disconnect(false);open();status('Room expired. Create a fresh room.');return;}
    if(message.type==='room'){
      room=message;drawPlayers();
      if(ui==='form' || ui==='lobby'){
        ui='lobby';show('connectForm',false);show('roomLobby',true);status(room.players.length===2?'Both racers are here. Tap READY.':'Share the room code with your friend.');
      }
      return;
    }
    if(message.type==='begin'){
      ui='racing';show('onlineScreen',false);show('onlineResults',false);show('onlineQuit',false);show('onlineHud',true);show('networkStatus',false);
      window.raceView.beginOnline();return;
    }
    if(message.type==='state'){
      if(ui!=='racing')return;
      peer=message.players.find(p=>p.id!==id);window.raceView.applyOnline(message,id);
      $('opponentLabel').textContent=peer?peer.name+(peer.alive?'':' · CRASHED'):'FRIEND';$('opponentScore').textContent=peer?peer.score:0;
      $('raceTimer').textContent=Math.ceil(message.remaining)+'s';if(Date.now()>voiceErrorUntil)show('networkStatus',false);return;
    }
    if(message.type==='result'){
      ui='results';window.raceView.endOnline();show('onlineHud',false);show('onlineQuit',false);show('onlineResults',true);show('networkStatus',false);
      $('onlineOutcome').textContent=message.winner===id?'YOU WIN!':message.winner?'FRIEND WINS!':'IT’S A TIE!';
      $('onlineScores').replaceChildren();
      for(const player of message.players){
        const row=document.createElement('div'),name=document.createElement('span'),points=document.createElement('b'),detail=document.createElement('small');
        name.textContent=player.name+(player.id===id?' (you)':'');detail.textContent=player.coins+' coins · '+player.distance+' m';name.append(detail);
        points.textContent=player.score;row.append(name,points);$('onlineScores').append(row);
      }
      $('resultReason').textContent=message.reason==='friend-left'?'Your friend left the race.':message.reason==='time'?'60 seconds are up. Highest score wins.':'Both runs have ended. Highest score wins.';
    }
  }
  function disconnect(toMenu=true){
    attempt++;clearTimeout(retry);clearInterval(heartbeat);connecting=false;voice.close();send({type:'leave'});
    const old=ws;ws=null;if(old){old.onclose=null;old.close();}room=null;peer=null;id='';ui='closed';buttons();
    ['onlineScreen','onlineHud','onlineResults','onlineQuit','networkStatus'].forEach(key=>show(key,false));
    window.raceView.menu();
    if(!toMenu)show('menu',false);
  }
  function requestLeave(){if(ui==='racing')show('onlineQuit',true);else disconnect();}
  $('playOnline').onclick=open;$('createRoom').onclick=()=>enter('create');$('joinRoom').onclick=()=>enter('join');
  $('readyRace').onclick=()=>{voice.listen().catch(()=>{});send({type:'ready'});};
  $('leaveRoom').onclick=$('exitOnline').onclick=$('confirmLeave').onclick=()=>disconnect();
  $('keepOnline').onclick=()=>show('onlineQuit',false);
  $('rematch').onclick=()=>{
    ui='lobby';show('onlineResults',false);show('onlineScreen',true);show('connectForm',false);show('roomLobby',true);drawPlayers();
    status(room.players.length===2?'Waiting for your friend to rematch.':'Share the same room code with a friend.');send({type:'ready'});
  };
  document.querySelectorAll('.mic-button').forEach(button=>button.onclick=()=>{if(room)voice.toggle();});
  // Refresh input more often than the keepalive so holding/releasing nitro feels immediate.
  setInterval(()=>{if(ui==='racing')send({type:'input',boost:window.raceView.boost()});},100);
  window.raceOnline={
    move(direction){send({type:'input',move:direction,boost:window.raceView.boost()});},
    connected(){return !!ws || connecting;},isOpen(){return ui!=='closed';},requestLeave,
    back(){if(!$('onlineQuit').hidden)disconnect();else requestLeave();},
    background(){disconnect();},
    // Read-only diagnostics aid testing without exposing controls over the simulation.
    diagnostics(){return {ui,mic:voice.enabled,pending:voice.pending,activeTracks:voice.stream?voice.stream.getTracks().filter(t=>t.readyState==='live').length:0,receivedVoiceFrames:voice.framesReceived};}
  };
})();
