/** A scene budget error, not a lost/unsupported graphics backend. */
export class VertexBufferLimitError extends Error {
  constructor(bytes: number, limit: number) {
    super(`Scene vertex upload requires ${bytes} bytes, exceeding WebGPU maxBufferSize ${limit}. Reduce mesh density, shadow quality, or view count.`);
    this.name = 'VertexBufferLimitError';
  }
}

/** Retain amortized growth without requesting an invalid buffer on a real device. */
export function vertexBufferCapacity(bytes: number, limit: number): number {
  if (bytes > limit) throw new VertexBufferLimitError(bytes, limit);
  return Math.min(limit, Math.max(256, bytes * 2));
}
