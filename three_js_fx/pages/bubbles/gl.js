// Bubbles' layer order, on top of shared/gl-layers.js.
export { compileLayers, CURSOR_SDF_GLSL, cursorAtlas, InstanceLayer, layerMesh, premultipliedMaterial, quadGeometry, setFrame } from '../../shared/gl-layers.js';

// Draw order, back to front.
export const ORDER = { drops: 0, bubbles: 1, accents: 2, gel: 3 };
