import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnectedWaterGeometry } from './connected-water.mjs';

test('an L-shaped pond has one level surface and no transparent faces between neighboring cells', () => {
  const cells = [[0, 0], [1, 0], [1, 1]];
  const occupied = new Set(cells.map(([x, z]) => `${x}:${z}`));
  const geometry = createConnectedWaterGeometry(cells);
  const positions = geometry.attributes.position;
  const normals = geometry.attributes.normal;
  let topArea = 0;
  for (let index = 0; index < positions.count; index += 3) {
    const vertices = [0, 1, 2].map(offset => [positions.getX(index + offset), positions.getY(index + offset), positions.getZ(index + offset)]);
    const [nx, ny, nz] = [normals.getX(index), normals.getY(index), normals.getZ(index)];
    if (ny === 1) {
      assert.ok(vertices.every(vertex => vertex[1] === -.125));
      const [a, b, c] = vertices;
      topArea += Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2])) / 2;
    } else {
      const x = vertices.reduce((sum, vertex) => sum + vertex[0], 0) / 3;
      const z = vertices.reduce((sum, vertex) => sum + vertex[2], 0) / 3;
      const outside = `${Math.floor(x + nx * .01)}:${Math.floor(z + nz * .01)}`;
      const inside = `${Math.floor(x - nx * .01)}:${Math.floor(z - nz * .01)}`;
      assert.equal(occupied.has(outside), false, 'internal water walls must be culled');
      assert.equal(occupied.has(inside), true);
    }
  }
  assert.equal(topArea, cells.length, 'surface must cover every water cell without gaps or overlaps');
  geometry.dispose();
});

test('solid neighboring cells occlude water walls without receiving liquid top faces', () => {
  const geometry = createConnectedWaterGeometry([[1, 1]], -.125, -.875, [[1, 2]]);
  const normals = geometry.attributes.normal;
  const positions = geometry.attributes.position;
  assert.equal(positions.count, 24);
  for (let index = 0; index < normals.count; index++) {
    assert.notEqual(normals.getZ(index), 1, 'the water wall bordering solid ice is absent');
    assert.ok(positions.getZ(index) <= 2, 'occluding cells do not gain a water surface');
  }
  geometry.dispose();
});
