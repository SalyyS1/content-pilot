/**
 * Behavior Simulator — Generate human-like patterns to avoid detection
 * 
 * Features: jitter, session simulation, human-time validation
 */

export class BehaviorSimulator {
  /**
   * Add random jitter to a base delay (±15-45 minutes)
   */
  addJitter(baseDelayMs) {
    const jitterMinutes = 15 + Math.random() * 30; // 15-45 min
    const jitterMs = jitterMinutes * 60 * 1000;
    const sign = Math.random() > 0.5 ? 1 : -1;
    return Math.max(60000, baseDelayMs + sign * jitterMs); // Min 1 minute
  }

  /**
   * Simulate post-upload human behavior delays
   * Humans do things after uploading: edit thumbnail, fix description, reply to comments
   */
  simulateSession() {
    return {
      thumbnailDelay: this._randomMs(5, 10),    // 5-10 min after upload
      descriptionEditDelay: this._randomMs(3, 7), // 3-7 min
      commentReplyDelay: this._randomMs(10, 30),  // 10-30 min
      nextVideoBrowseDelay: this._randomMs(15, 45), // 15-45 min
    };
  }

  /**
   * Check if current time looks like a human would be active
   */
  isHumanLikeTime(timezone = 'UTC') {
    const now = new Date();
    // Convert to target timezone
    const options = { timeZone: timezone, hour: 'numeric', hour12: false };
    let hour;
    try {
      hour = parseInt(new Intl.DateTimeFormat('en-US', options).format(now));
    } catch {
      hour = now.getUTCHours();
    }
    // Humans are active 6 AM - 11 PM
    return hour >= 6 && hour <= 23;
  }

  /**
   * Get a random upload delay that feels human
   * Humans don't upload at exact intervals
   */
  humanUploadDelay(baseMinutes = 180) {
    const variance = baseMinutes * 0.3; // ±30% of base
    const jitter = (Math.random() - 0.5) * 2 * variance;
    return Math.max(30, Math.round(baseMinutes + jitter)) * 60 * 1000;
  }

  /**
   * Random milliseconds between min and max minutes
   */
  _randomMs(minMinutes, maxMinutes) {
    const minutes = minMinutes + Math.random() * (maxMinutes - minMinutes);
    return Math.round(minutes * 60 * 1000);
  }
}

export default BehaviorSimulator;
