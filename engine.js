/* Pure simulation shared by the Android game and deterministic tests. */
(function (root) {
  'use strict';
  const LANES = [108, 210, 312];
  class Race {
    constructor(random) { this.random = random || Math.random; this.reset(820); }
    reset(height) {
      this.height = height; this.playerY = height - 192;
      this.lane = 1; this.x = LANES[1]; this.tilt = 0;
      this.time = 0; this.distance = 0; this.bonus = 0; this.coins = 0;
      this.energy = 100; this.boost = false; this.boostLocked = false;
      this.speed = 300; this.scroll = 0; this.spawnIn = 1;
      this.traffic = []; this.pickups = []; this.events = [];
      this.alive = true; this.overtakes = 0;
    }
    move(direction) { if (this.alive) this.lane = Math.max(0, Math.min(2, this.lane + direction)); }
    get score() { return Math.floor(this.distance / 12) + this.bonus; }
    wave() {
      const safe = Math.floor(this.random() * 3);
      const occupied = [0, 1, 2].filter(lane => lane !== safe);
      if (this.time < 14 || this.random() < 0.42) occupied.splice(Math.floor(this.random() * 2), 1);
      occupied.forEach(lane => this.traffic.push({lane, x: LANES[lane], y: -100,
        color: Math.floor(this.random() * 4), passed: false}));
      this.pickups.push({x: LANES[safe], y: -100, spin: this.random() * 6.28});
    }
    tick(dt, holdingBoost) {
      this.events = [];
      if (!this.alive) return;
      dt = Math.max(0, Math.min(0.04, dt));
      this.time += dt;
      if (!holdingBoost) this.boostLocked = false;
      this.boost = holdingBoost && !this.boostLocked && this.energy > 0;
      this.energy = Math.max(0, Math.min(100, this.energy + (this.boost ? -32 : 12) * dt));
      if (this.energy === 0) this.boostLocked = true;
      this.speed = Math.min(470, 300 + this.time * 2.1) * (this.boost ? 1.48 : 1);
      this.distance += this.speed * dt; this.scroll += this.speed * dt;
      const previousX = this.x;
      this.x += (LANES[this.lane] - this.x) * Math.min(1, dt * 14);
      this.tilt = (this.x - previousX) * 0.016;
      this.spawnIn -= dt;
      if (this.spawnIn <= 0) { this.wave(); this.spawnIn = Math.max(1.03, 1.55 - this.time * 0.003); }
      for (const car of this.traffic) {
        car.y += this.speed * dt;
        if (Math.abs(car.x - this.x) < 43 && Math.abs(car.y - this.playerY) < 76) {
          this.alive = false; this.boost = false; this.events.push({type:'crash', x:this.x, y:this.playerY});
          return;
        }
        if (!car.passed && car.y > this.playerY + 80) {
          car.passed = true; this.overtakes++;
          if (Math.abs(car.x - this.x) < 112) { this.bonus += 15; this.events.push({type:'near', x:this.x, y:this.playerY - 70}); }
        }
      }
      for (const coin of this.pickups) {
        coin.y += this.speed * dt;
        if (!coin.collected && Math.abs(coin.x - this.x) < 40 && Math.abs(coin.y - this.playerY) < 55) {
          coin.collected = true; this.coins++; this.bonus += 50;
          this.energy = Math.min(100, this.energy + 7);
          this.events.push({type:'coin', x:coin.x, y:coin.y});
        }
      }
      this.traffic = this.traffic.filter(car => car.y < this.height + 110);
      this.pickups = this.pickups.filter(coin => !coin.collected && coin.y < this.height + 30);
    }
  }
  root.TanmayEngine = {Race, LANES};
  if (typeof module !== 'undefined') module.exports = root.TanmayEngine;
})(typeof window !== 'undefined' ? window : globalThis);
