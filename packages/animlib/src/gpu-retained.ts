/// <reference types="@webgpu/types" />
import { IDENTITY_INSTANCE, INSTANCE_FLOATS, MAX_INSTANCES } from './retained-geometry.js';
import type { RetainedMesh } from './retained-geometry.js';
import type { RenderCommand } from './composition.js';

/** Device-owned resources. No handle survives device loss/replacement. */
export class GPURetained {
  private meshes = new Map<RetainedMesh, { vertices: GPUBuffer; indices: GPUBuffer }>();
  private used = new Set<RetainedMesh>();
  private objects: { buffer: GPUBuffer; groups: Map<GPURenderPipeline, GPUBindGroup> }[] = [];
  private cursor = 0;
  constructor(private device: GPUDevice) {}
  beginFrame(): void { this.used.clear(); this.cursor = 0; }
  draw(pass: GPURenderPassEncoder, pipeline: GPURenderPipeline, command: Extract<RenderCommand, { first: number }>, legacy: GPUBuffer | undefined): void {
    const { device } = this;
    let object = this.objects[this.cursor++];
    if (!object) {
      object = { buffer: device.createBuffer({ size: MAX_INSTANCES * INSTANCE_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }), groups: new Map() };
      this.objects.push(object);
    }
    let group = object.groups.get(pipeline);
    if (!group) {
      group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(1), entries: [{ binding: 0, resource: { buffer: object.buffer } }] });
      object.groups.set(pipeline, group);
    }
    const instances = command.instances ?? [IDENTITY_INSTANCE];
    const data = new Float32Array(instances.length * INSTANCE_FLOATS);
    instances.forEach((instance, i) => data.set(instance, i * INSTANCE_FLOATS));
    device.queue.writeBuffer(object.buffer, 0, data);
    pass.setBindGroup(1, group);
    if (command.mesh) {
      const mesh = command.mesh;
      this.used.add(mesh);
      let resource = this.meshes.get(mesh);
      if (!resource) {
        resource = {
          vertices: device.createBuffer({ size: Math.max(4, mesh.vertices.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }),
          indices: device.createBuffer({ size: Math.max(4, mesh.indices.byteLength), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST }),
        };
        this.meshes.set(mesh, resource);
        if (mesh.vertices.length) device.queue.writeBuffer(resource.vertices, 0, mesh.vertices);
        if (mesh.indices.length) device.queue.writeBuffer(resource.indices, 0, mesh.indices);
      }
      pass.setVertexBuffer(0, resource.vertices);
      pass.setIndexBuffer(resource.indices, 'uint32');
      pass.drawIndexed(mesh.indices.length, instances.length);
    } else if (command.count) {
      pass.setVertexBuffer(0, legacy!);
      pass.draw(command.count, 1, command.first);
    }
  }
  endFrame(): void {
    for (const [mesh, resource] of this.meshes) if (!this.used.has(mesh)) {
      resource.vertices.destroy(); resource.indices.destroy(); this.meshes.delete(mesh);
    }
    for (const object of this.objects.splice(this.cursor)) object.buffer.destroy();
  }
  dispose(): void {
    for (const resource of this.meshes.values()) { resource.vertices.destroy(); resource.indices.destroy(); }
    for (const object of this.objects) object.buffer.destroy();
    this.meshes.clear(); this.objects = [];
  }
}
