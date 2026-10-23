import type { Vec3 } from '../types.js';

export interface SampledStateOptions {
  /** Strictly increasing finite sample times, at most 20,000. */
  times: readonly number[];
  /** 1–64 components, <=20,000 total component slots. Null breaks a trajectory. */
  values: readonly (readonly number[] | null)[];
  /** Explicit linear projection, exactly three rows of N finite coefficients. */
  projection: readonly (readonly number[])[];
}
export interface SampledState {
  /** Contiguous nonmissing runs; a one-sample run has count 2 for drawable topology. */
  readonly segments: readonly {readonly start:number;readonly end:number;readonly count:number}[];
  /** Linear interpolation, or null outside the domain / within a missing interval. */
  at(time:number): {values:number[];position:Vec3} | null;
  /** Fixed-count prefix, future vertices repeated at current endpoint; clamped to this run. */
  prefix(segment:number,time:number): Vec3[];
}
