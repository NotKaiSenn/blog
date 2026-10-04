import * as THREE from 'three';

export function createGeneratedItemGeometry(pixels, width, height, thickness = 1 / 16) {
  const positions = [], uvs = [], colors = [], indices = [];
  const halfDepth = thickness / 2;
  const solid = (x, y) => x >= 0 && y >= 0 && x < width && y < height
    && pixels[(y * width + x) * 4 + 3] > 25;
  const quad = (vertices, coordinates, shade = 1) => {
    const offset = positions.length / 3;
    vertices.forEach((vertex, index) => {
      positions.push(...vertex);
      uvs.push(...coordinates[index]);
      colors.push(shade, shade, shade);
    });
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  };

  quad([
    [-.5, .5, halfDepth], [-.5, -.5, halfDepth], [.5, -.5, halfDepth], [.5, .5, halfDepth],
  ], [[0, 1], [0, 0], [1, 0], [1, 1]]);
  // The same world-space x/y must sample the same texel on both faces.
  quad([
    [.5, .5, -halfDepth], [.5, -.5, -halfDepth], [-.5, -.5, -halfDepth], [-.5, .5, -halfDepth],
  ], [[1, 1], [1, 0], [0, 0], [0, 1]]);

  const edge = (a, b, x, y) => {
    const uv = [(x + .5) / width, 1 - (y + .5) / height];
    quad([
      [...a, halfDepth], [...b, halfDepth], [...b, -halfDepth], [...a, -halfDepth],
    ], [uv, uv, uv, uv], .75);
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (solid(x, y)) {
    const left = x / width - .5, right = (x + 1) / width - .5;
    const top = .5 - y / height, bottom = .5 - (y + 1) / height;
    if (!solid(x - 1, y)) edge([left, bottom], [left, top], x, y);
    if (!solid(x + 1, y)) edge([right, top], [right, bottom], x, y);
    if (!solid(x, y - 1)) edge([left, top], [right, top], x, y);
    if (!solid(x, y + 1)) edge([right, bottom], [left, bottom], x, y);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
