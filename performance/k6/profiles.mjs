export const PROFILE_NAMES = Object.freeze([
  'smoke',
  'release',
  'load',
  'stress',
  'spike',
  'soak',
]);

const DEFINITIONS = Object.freeze({
  smoke: Object.freeze({
    executor: 'shared-iterations',
    vus: 1,
    iterations: 1,
    maxDuration: '2m',
  }),
  release: Object.freeze({
    executor: 'ramping-vus',
    peakVus: 25,
    steadyStageIndex: 2,
    stages: Object.freeze([
      Object.freeze({ duration: '1m', ratio: 0.2 }),
      Object.freeze({ duration: '2m', ratio: 0.4 }),
      Object.freeze({ duration: '5m', ratio: 1 }),
      Object.freeze({ duration: '2m', ratio: 0 }),
    ]),
  }),
  load: Object.freeze({
    executor: 'ramping-vus',
    peakVus: 100,
    steadyStageIndex: 2,
    stages: Object.freeze([
      Object.freeze({ duration: '5m', ratio: 0.25 }),
      Object.freeze({ duration: '5m', ratio: 0.5 }),
      Object.freeze({ duration: '25m', ratio: 1 }),
      Object.freeze({ duration: '5m', ratio: 0 }),
    ]),
  }),
  stress: Object.freeze({
    executor: 'ramping-vus',
    peakVus: 300,
    steadyStageIndex: 3,
    stages: Object.freeze([
      Object.freeze({ duration: '3m', ratio: 0.1 }),
      Object.freeze({ duration: '3m', ratio: 0.25 }),
      Object.freeze({ duration: '3m', ratio: 0.5 }),
      Object.freeze({ duration: '3m', ratio: 1 }),
      Object.freeze({ duration: '5m', ratio: 0 }),
    ]),
  }),
  // A spike is not a smaller stress test. `stress` climbs in three-minute steps to find
  // where the system degrades; `spike` slams from a tenth of peak to full peak in ten
  // seconds to find whether it survives a surge at all — and, in the stage after, whether
  // it comes back. Production signals that motivated this work show roughly 10,000 socket
  // retries per second, which arrives as a surge rather than a ramp, so a stepped profile
  // would never reproduce it.
  //
  // `steadyStageIndex` points at the recovery hold, not the surge: lengthening a run
  // should buy more time watching queues drain, because a surge held for ten minutes is
  // by definition no longer a spike.
  spike: Object.freeze({
    executor: 'ramping-vus',
    peakVus: 300,
    steadyStageIndex: 4,
    stages: Object.freeze([
      Object.freeze({ duration: '1m', ratio: 0.1 }),   // baseline
      Object.freeze({ duration: '10s', ratio: 1 }),    // the surge
      Object.freeze({ duration: '1m', ratio: 1 }),     // hold at peak
      Object.freeze({ duration: '10s', ratio: 0.1 }),  // drop back
      Object.freeze({ duration: '3m', ratio: 0.1 }),   // recovery window
      Object.freeze({ duration: '1m', ratio: 0 }),     // wind down
    ]),
  }),
  soak: Object.freeze({
    executor: 'ramping-vus',
    peakVus: 25,
    steadyStageIndex: 1,
    stages: Object.freeze([
      Object.freeze({ duration: '5m', ratio: 1 }),
      Object.freeze({ duration: '4h', ratio: 1 }),
      Object.freeze({ duration: '5m', ratio: 0 }),
    ]),
  }),
});

export function buildExecutionProfile(name, overrides = {}) {
  const definition = DEFINITIONS[name];
  if (!definition) throw new Error(`Unknown profile: ${name}`);

  if (name === 'smoke') {
    const vus = overrides.vus ?? definition.vus;
    return {
      executor: definition.executor,
      vus,
      iterations: vus,
      maxDuration: overrides.duration ?? definition.maxDuration,
    };
  }

  const peakVus = overrides.vus ?? definition.peakVus;
  return {
    executor: definition.executor,
    gracefulRampDown: '30s',
    stages: definition.stages.map((stage, index) => ({
      duration: index === definition.steadyStageIndex && overrides.duration
        ? overrides.duration
        : stage.duration,
      target: Math.ceil(peakVus * stage.ratio),
    })),
  };
}

/**
 * The highest concurrent virtual-user count a built profile reaches.
 *
 * Read from the built profile rather than the definition so a VU override is
 * reflected, which is what the rate-limit fixture guard needs to size against.
 */
export function peakVus(executionProfile) {
  if (typeof executionProfile.vus === 'number') return executionProfile.vus;
  return Math.max(...executionProfile.stages.map(({ target }) => target));
}
