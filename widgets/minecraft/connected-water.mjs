import * as THREE from 'three';

export function createConnectedWaterGeometry(cells, top = -.125, bottom = -.875, occluderCells = []) {
  const occupied = new Set([...cells, ...occluderCells].map(([x, z]) => `${x}:${z}`));
  const positions = [], normals = [], uvs = [], colors = [];
  function quad(vertices, normal, shade) {
    const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const index of [0, 1, 2, 0, 2, 3]) {
      positions.push(...vertices[index]);
      normals.push(...normal);
      uvs.push(...uv[index]);
      colors.push(shade, shade, shade);
    }
  }
  for (const [x, z] of cells) {
    quad([[x, top, z + 1], [x + 1, top, z + 1], [x + 1, top, z], [x, top, z]], [0, 1, 0], 1);
    if (!occupied.has(`${x - 1}:${z}`)) quad([[x, bottom, z], [x, bottom, z + 1], [x, top, z + 1], [x, top, z]], [-1, 0, 0], .6);
    if (!occupied.has(`${x + 1}:${z}`)) quad([[x + 1, bottom, z + 1], [x + 1, bottom, z], [x + 1, top, z], [x + 1, top, z + 1]], [1, 0, 0], .6);
    if (!occupied.has(`${x}:${z - 1}`)) quad([[x + 1, bottom, z], [x, bottom, z], [x, top, z], [x + 1, top, z]], [0, 0, -1], .8);
    if (!occupied.has(`${x}:${z + 1}`)) quad([[x, bottom, z + 1], [x + 1, bottom, z + 1], [x + 1, top, z + 1], [x, top, z + 1]], [0, 0, 1], .8);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}
