import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createGeneratedItemGeometry } from './generated-item-geometry.mjs';

function asymmetricSprite() {
  const width = 4, height = 4;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (const [x, y] of [[0, 0], [0, 1], [0, 2], [1, 2]]) pixels[(y * width + x) * 4 + 3] = 255;
  return { pixels, width, height };
}

test('front and back sample the same asymmetric silhouette at every pixel', () => {
  const { pixels, width, height } = asymmetricSprite();
  const geometry = createGeneratedItemGeometry(pixels, width, height);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const ray = new THREE.Raycaster();
  mesh.updateMatrixWorld();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const wx = (x + .5) / width - .5, wy = .5 - (y + .5) / height;
    const sampledPixels = [1, -1].map(side => {
      ray.set(new THREE.Vector3(wx, wy, side), new THREE.Vector3(0, 0, -side));
      const [hit] = ray.intersectObject(mesh);
      assert.ok(hit, `missing face at ${x}, ${y}, ${side}`);
      const tx = Math.floor(hit.uv.x * width), ty = Math.floor((1 - hit.uv.y) * height);
      assert.deepEqual([tx, ty], [x, y]);
      return pixels[(ty * width + tx) * 4 + 3];
    });
    assert.deepEqual(sampledPixels, [pixels[(y * width + x) * 4 + 3], pixels[(y * width + x) * 4 + 3]]);
  }
  mesh.material.dispose(); geometry.dispose();
});

test('extruded sides follow opaque pixel boundaries, face outward and sample their solid pixel', () => {
  const { pixels, width, height } = asymmetricSprite();
  const geometry = createGeneratedItemGeometry(pixels, width, height);
  const positions = geometry.attributes.position, uvs = geometry.attributes.uv;
  const normal = geometry.attributes.normal;
  const expectedEdges = 10;
  assert.equal((positions.count - 8) / 4, expectedEdges);
  assert.equal(geometry.index.count, (expectedEdges + 2) * 6);
  for (let start = 8; start < positions.count; start += 4) {
    const x = Math.floor(uvs.getX(start) * width), y = Math.floor((1 - uvs.getY(start)) * height);
    assert.equal(pixels[(y * width + x) * 4 + 3], 255);
    const center = new THREE.Vector3();
    for (let i = start; i < start + 4; i++) center.add(new THREE.Vector3().fromBufferAttribute(positions, i));
    center.multiplyScalar(.25);
    const nx = normal.getX(start), ny = normal.getY(start);
    const outsideX = Math.floor((center.x + nx * .01 + .5) * width);
    const outsideY = Math.floor((.5 - center.y - ny * .01) * height);
    const outsideAlpha = outsideX < 0 || outsideX >= width || outsideY < 0 || outsideY >= height
      ? 0 : pixels[(outsideY * width + outsideX) * 4 + 3];
    assert.equal(outsideAlpha, 0, 'side normals point into transparent space');
    assert.deepEqual([positions.getZ(start), positions.getZ(start + 2)], [1 / 32, -1 / 32]);
  }
  geometry.dispose();
});
