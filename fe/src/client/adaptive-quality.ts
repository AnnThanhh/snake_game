type Policy = {
  lowFps: number;
  highFps: number;
  downSeconds: number;
  upSeconds: number;
  cooldownSeconds: number;
  initialLevel: number;
};

// Sustained frame times and a cooldown prevent oscillation after brief stalls.
export class AdaptiveQuality {
  level = 0;
  slow = 0;
  fast = 0;
  cooldown = 0;
  initialized = false;
  update(dt: number, policy: Policy, levels: number) {
    if (!policy || !levels) return this.level;
    if (!this.initialized) {
      this.level = Math.min(levels - 1, policy.initialLevel);
      this.initialized = true;
    }
    this.level = Math.min(levels - 1, this.level);
    if (!Number.isFinite(dt) || dt <= 0 || dt >= 0.25) {
      this.slow = this.fast = 0;
      return this.level;
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.cooldown) return this.level;
    this.slow = dt > 1 / policy.lowFps ? this.slow + dt : 0;
    this.fast = dt < 1 / policy.highFps ? this.fast + dt : 0;
    if (this.slow >= policy.downSeconds && this.level > 0) {
      this.level--;
      this.changed(policy);
    } else if (this.fast >= policy.upSeconds && this.level < levels - 1) {
      this.level++;
      this.changed(policy);
    }
    return this.level;
  }
  changed(policy: Policy) {
    this.slow = this.fast = 0;
    this.cooldown = policy.cooldownSeconds;
  }
}
