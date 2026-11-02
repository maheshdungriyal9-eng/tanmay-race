(function(){
  'use strict';
  class RoomVoice {
    constructor(send,changed){this.send=send;this.changed=changed;this.context=null;this.stream=null;this.node=null;this.source=null;this.enabled=false;this.pending=false;this.generation=0;this.next=0;this.speakers=true;this.framesReceived=0;}
    async listen(){
      const Audio=window.AudioContext||window.webkitAudioContext;
      if(!Audio)throw Error('Voice is unavailable. Update Android System WebView.');
      if(!this.context || this.context.state==='closed')this.context=new Audio({latencyHint:'interactive'});
      await this.context.resume();
    }
    async toggle(){
      if(this.pending || this.enabled){this.stopMic();return;}
      this.pending=true;const generation=++this.generation;this.changed('ASKING FOR MIC…',false);
      try{
        await this.listen();
        if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)throw Error('Mic needs a secure connection and an updated WebView.');
        const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
        if(generation!==this.generation){stream.getTracks().forEach(t=>t.stop());return;}
        this.stream=stream;
        if(!this.context.audioWorklet)throw Error('Please update Android System WebView for mic support.');
        if(!this.loaded){await this.context.audioWorklet.addModule('voice-worklet.js');this.loaded=true;}
        if(generation!==this.generation){this.stopMic();return;}
        this.source=this.context.createMediaStreamSource(stream);this.node=new AudioWorkletNode(this.context,'tanmay-mic');
        this.node.port.onmessage=e=>{if(this.enabled)this.send(e.data);};
        this.source.connect(this.node);this.node.connect(this.context.destination);
        this.enabled=true;this.pending=false;this.changed('MIC ON',true);
        stream.getAudioTracks()[0].onended=()=>this.stopMic();
      }catch(error){
        if(generation!==this.generation)return;
        this.stopMic();
        const denied=error.name==='NotAllowedError' || error.name==='PermissionDeniedError';
        this.changed(denied?'Mic denied. Allow Microphone in app settings, then tap again.':error.message,false,true);
      }
    }
    stopMic(){
      this.generation++;this.pending=false;this.enabled=false;
      if(this.node){this.node.port.onmessage=null;this.node.disconnect();this.node=null;}
      if(this.source){this.source.disconnect();this.source=null;}
      if(this.stream){this.stream.getTracks().forEach(t=>{t.onended=null;t.stop();});this.stream=null;}
      this.changed('MIC OFF',false);
    }
    receive(data){
      if(!this.speakers || !this.context || this.context.state!=='running' || data.byteLength!==1280)return;
      const pcm=new Int16Array(data),buffer=this.context.createBuffer(1,pcm.length,16000),samples=buffer.getChannelData(0);
      for(let i=0;i<pcm.length;i++)samples[i]=pcm[i]/32768;
      const now=this.context.currentTime;
      if(this.next>now+.25)return; // Discard a backlog rather than playing stale speech.
      this.next=Math.max(now+.05,this.next);
      const source=this.context.createBufferSource();source.buffer=buffer;source.connect(this.context.destination);
      source.start(this.next);source.onended=()=>source.disconnect();this.next+=buffer.duration;this.framesReceived++;
    }
    close(){this.stopMic();if(this.context){this.context.close().catch(()=>{});this.context=null;}this.loaded=false;this.next=0;}
  }
  window.RoomVoice=RoomVoice;
})();
