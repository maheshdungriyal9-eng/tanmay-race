/* Downsample microphone audio to 16 kHz mono PCM, in 40 ms packets. */
class TanmayMic extends AudioWorkletProcessor {
  constructor(){super();this.phase=0;this.sum=0;this.count=0;this.buffer=new Int16Array(640);this.index=0;}
  process(inputs){
    const samples=inputs[0] && inputs[0][0];
    if(samples)for(const sample of samples){
      this.sum+=sample;this.count++;this.phase+=16000;
      if(this.phase>=sampleRate){
        this.phase-=sampleRate;
        this.buffer[this.index++]=Math.round(Math.max(-1,Math.min(1,this.sum/this.count))*32767);
        this.sum=0;this.count=0;
        if(this.index===640){this.port.postMessage(this.buffer.buffer,[this.buffer.buffer]);this.buffer=new Int16Array(640);this.index=0;}
      }
    }
    // Outputs are silent: the microphone must never feed the speaker locally.
    return true;
  }
}
registerProcessor('tanmay-mic',TanmayMic);
