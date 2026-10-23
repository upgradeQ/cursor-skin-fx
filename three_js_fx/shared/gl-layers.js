// three.js plumbing for pages whose layers are drawn entirely in their own
// shaders: premultiplied materials, frame uniforms every layer reads, meshes
// drawn in a fixed order, geometry streamed from the CPU each frame, and the
// cursor silhouette atlas (shared/cursor-sdf.js) as a texture.
//
// Layers place their vertices in page pixels (origin top-left, y down) with
// clipFromPage(), so any camera will do for the renderer.
import * as THREE from 'three';
import { buildCursorAtlas, TILE_COUNT, TILE_ORIGIN, TILE_PX } from './cursor-sdf.js';

export const TIME_WRAP = 2048;   // s; shader time wraps here so floats keep their precision

// Frame uniforms: page size (page px), device px per page px, time (s, wrapped).
// One object, so a single write updates every material.
export const frame = {
	uRes: { value: new THREE.Vector2(1, 1) },
	uPr: { value: 1 },
	uTime: { value: 0 },
};

export function setFrame(width, height, pixelRatio, time) {
	frame.uRes.value.set(width, height);
	frame.uPr.value = pixelRatio;
	frame.uTime.value = time % TIME_WRAP;
}

const HEADER = /* glsl */ `
precision highp float;
precision highp int;

uniform vec2 uRes;   // page px
uniform float uPr;   // device px per page px
uniform float uTime; // s, wrapped

vec4 clipFromPage(vec2 p) {
	return vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
}

// Light (premultiplied, mostly additive) vanishes over a white page, where
// only colour with less light than coverage shows. This turns the soft parts
// of c toward a deeper, saturated tint and gives them the coverage to carry
// it, by amount; white-hot cores stay as they are. Over dark content the
// light only gets a little richer in colour.
vec4 underInk(vec4 c, vec3 tint, float amount) {
	vec3 hue = tint / max(max(tint.r, tint.g), max(tint.b, 1e-3));
	vec3 ink = clamp(mix(vec3(dot(hue, vec3(0.3333))), hue, 1.8), 0.0, 1.0) * 0.72;
	float L = clamp(max(c.r, max(c.g, c.b)), 0.0, 1.0);
	float k = amount * (1.0 - smoothstep(0.75, 1.0, max(c.r, max(c.g, c.b)) - 0.25));
	return vec4(mix(c.rgb, ink * L, k * 0.6), max(c.a, L * k));
}
`;

// A material writing premultiplied colour over the canvas. `common` goes in
// front of both stages (uniforms, constants, helpers).
export function premultipliedMaterial({ common = '', vertex, fragment, uniforms = {} }) {
	return new THREE.RawShaderMaterial({
		glslVersion: THREE.GLSL3,
		vertexShader: HEADER + common + vertex,
		fragmentShader: HEADER + common + fragment,
		uniforms: { ...frame, ...uniforms },
		transparent: true,
		// Quads are laid out in y-down page pixels, which flips their winding.
		side: THREE.DoubleSide,
		depthTest: false,
		depthWrite: false,
		blending: THREE.CustomBlending,
		blendEquation: THREE.AddEquation,
		blendSrc: THREE.OneFactor,
		blendDst: THREE.OneMinusSrcAlphaFactor,
		blendSrcAlpha: THREE.OneFactor,
		blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
	});
}

// Positions are placed in the shaders; an endless bounding sphere keeps
// three.js from measuring the 2D geometry when it sorts transparent objects.
const EVERYWHERE = new THREE.Sphere(new THREE.Vector3(), Infinity);

// Two-triangle quad with corners in -1..1, optionally instanced.
export function quadGeometry({ instanced = false } = {}) {
	const geo = instanced ? new THREE.InstancedBufferGeometry() : new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
	geo.setIndex([0, 1, 2, 0, 2, 3]);
	if (instanced) geo.instanceCount = 0;
	geo.boundingSphere = EVERYWHERE;
	return geo;
}

// Geometry fed from one interleaved Float32Array the caller rewrites each
// frame. attrs: [name, size] in order. Without instanced the first attribute
// should be the position; with it, the attributes step per instance over a quad.
export function streamGeometry(array, stride, attrs, { instanced = false } = {}) {
	const geo = instanced ? quadGeometry({ instanced: true }) : new THREE.BufferGeometry();
	const buffer = instanced
		? new THREE.InstancedInterleavedBuffer(array, stride)
		: new THREE.InterleavedBuffer(array, stride);
	buffer.setUsage(THREE.DynamicDrawUsage);
	let offset = 0;
	for (const [name, size] of attrs) {
		geo.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, size, offset));
		offset += size;
	}
	geo.boundingSphere = EVERYWHERE;
	return { geo, buffer };
}

// Uploads the first `floats` of an interleaved buffer.
export function uploadPrefix(buffer, floats) {
	if (floats <= 0) return;
	buffer.clearUpdateRanges();
	buffer.addUpdateRange(0, floats);
	buffer.needsUpdate = true;
}

// An instanced quad layer fed from `capacity` records of `stride` floats,
// exposed to the shader as vec4 attributes named by `names`.
export class InstanceLayer {
	constructor(scene, material, order, capacity, names) {
		this.stride = names.length * 4;
		this.data = new Float32Array(capacity * this.stride);
		this.capacity = capacity;
		const { geo, buffer } = streamGeometry(this.data, this.stride, names.map((n) => [n, 4]), { instanced: true });
		this.geo = geo;
		this.buffer = buffer;
		this.mesh = layerMesh(scene, geo, material, order);
		this.count = 0;
	}

	// Shows the first count records and uploads them.
	commit(count) {
		this.count = count;
		this.geo.instanceCount = count;
		this.mesh.visible = count > 0;
		uploadPrefix(this.buffer, count * this.stride);
	}
}

export function layerMesh(scene, geo, material, order) {
	const mesh = new THREE.Mesh(geo, material);
	mesh.frustumCulled = false;
	mesh.renderOrder = order;
	mesh.visible = false;
	scene.add(mesh);
	return mesh;
}

// Compiles every layer's program up front, so the first frames do not stall.
export async function compileLayers(renderer, scene, camera) {
	const shown = scene.children.map((m) => m.visible);
	for (const mesh of scene.children) mesh.visible = true;
	try {
		await renderer.compileAsync(scene, camera);
	} catch (e) {
		console.error(`[three] ${e.message}`);
	}
	scene.children.forEach((m, i) => { m.visible = shown[i]; });
}

// The cursor silhouette atlas as a half-float texture, built once.
let atlas = null;
export function cursorAtlas() {
	if (atlas) return atlas;
	const { data, width, height } = buildCursorAtlas();
	atlas = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
	atlas.minFilter = atlas.magFilter = THREE.LinearFilter;
	atlas.wrapS = atlas.wrapT = THREE.ClampToEdgeWrapping;
	atlas.generateMipmaps = false;
	atlas.flipY = false;
	atlas.needsUpdate = true;
	return atlas;
}

// Samples the atlas bound as uAtlas (pass { uAtlas: { value: cursorAtlas() } });
// p is page px from the hotspot, y down. Returns (distance px, gradient x, gradient y).
export const CURSOR_SDF_GLSL = /* glsl */ `
uniform sampler2D uAtlas;
const float CURSOR_TILE_PX = ${TILE_PX.toFixed(1)};
const float CURSOR_TILE_ORIGIN = ${TILE_ORIGIN.toFixed(1)};
const float CURSOR_TILES = ${TILE_COUNT.toFixed(1)};

vec3 cursorField(float tile, vec2 p) {
	vec2 q = p + CURSOR_TILE_ORIGIN;
	// Half a texel in from the tile edges, so filtering never reads a neighbour.
	float inset = 0.5 * CURSOR_TILE_PX / float(textureSize(uAtlas, 0).y);
	vec2 qc = clamp(q, vec2(inset), vec2(CURSOR_TILE_PX - inset));
	vec2 uv = vec2((tile * CURSOR_TILE_PX + qc.x) / (CURSOR_TILE_PX * CURSOR_TILES), qc.y / CURSOR_TILE_PX);
	vec3 s = textureLod(uAtlas, uv, 0.0).xyz;
	return vec3(s.x + length(q - qc), s.yz);
}

// The same field turned by angle (radians, y down) about the hotspot.
vec3 cursorFieldRotated(float tile, vec2 p, float angle) {
	float c = cos(angle);
	float s = sin(angle);
	vec3 f = cursorField(tile, vec2(c * p.x + s * p.y, -s * p.x + c * p.y));
	return vec3(f.x, c * f.y - s * f.z, s * f.y + c * f.z);
}
`;
