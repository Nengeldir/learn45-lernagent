import { describe, expect, it } from 'vitest';
import { WEBGL_VERTEX_ATTRIBUTES } from '../../packages/animlib/src/webgl.ts';
import { VERTEX_FLOATS } from '../../packages/animlib/src/texture-shader.ts';

describe('Safari-compatible WebGL vertex layout', () => {
  it('leaves attribute headroom for the driver and consumes every shared vertex field once', () => {
    expect(WEBGL_VERTEX_ATTRIBUTES.length).toBeLessThan(16);
    const fields=WEBGL_VERTEX_ATTRIBUTES.flatMap(([location,size,offset])=>{
      expect(location).toBeLessThan(15);
      expect(size).toBeLessThanOrEqual(4);
      expect(offset%4).toBe(0);
      return Array.from({length:size},(_,i)=>offset/4+i);
    });
    expect(fields).toEqual(Array.from({length:VERTEX_FLOATS},(_,i)=>i));
    expect(new Set(WEBGL_VERTEX_ATTRIBUTES.map(([location])=>location)).size).toBe(WEBGL_VERTEX_ATTRIBUTES.length);
  });
});
