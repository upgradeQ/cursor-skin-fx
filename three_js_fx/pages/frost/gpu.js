// three.js plumbing for the Frost layers: premultiplied materials, instanced
// quads and allocation-free partial uploads.
import * as THREE from 'three';
import { HEADER, COMMON } from './glsl.js';

// Uniforms every layer reads; one object so a single write updates all materials.
export const shared = {
	uRes: { value: new THREE.Vector2(1, 1) },
	uPx: { value: 1 },        // one device pixel in page pixels
	uTime: { value: 0 },
	uCursor: { value: new THREE.Vector2(-1e4, -1e4) },
};

export function premultipliedMaterial(vertexShader, fragmentShader, uniforms = {}) {
	return new THREE.RawShaderMaterial({
		glslVersion: THREE.GLSL3,
		vertexShader: HEADER + COMMON + vertexShader,
		fragmentShader: HEADER + COMMON + fragmentShader,
		uniforms: { ...shared, ...uniforms },
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

// Unit quad for instancing: x 0..1 (or -1..1 when centred), y -1..1.
export function quadGeometry({ centred = true } = {}) {
	const x0 = centred ? -1 : 0;
	const geo = new THREE.InstancedBufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute([x0, -1, 1, -1, 1, 1, x0, 1], 2));
	geo.setIndex([0, 1, 2, 0, 2, 3]);
	geo.instanceCount = 0;
	// Positions are placed in the shader; this only keeps three.js from
	// measuring the 2D quad when it sorts transparent objects.
	geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
	return geo;
}

export function instancedAttribute(geo, name, array, itemSize) {
	const attr = new THREE.InstancedBufferAttribute(array, itemSize);
	attr.setUsage(THREE.DynamicDrawUsage);
	geo.setAttribute(name, attr);
	return attr;
}

export function layerMesh(geo, material, order) {
	const mesh = new THREE.Mesh(geo, material);
	mesh.frustumCulled = false;
	mesh.renderOrder = order;
	mesh.visible = false;
	return mesh;
}

// Queues an upload of `count` floats from `start` without allocating: the
// renderer empties updateRanges after every upload, so range objects are reused.
// A range still pending (its mesh was not drawn yet) grows to cover both.
export function queueUpload(target, range, start, count) {
	if (count <= 0) return;
	if (target.updateRanges.includes(range)) {
		const end = Math.max(range.start + range.count, start + count);
		range.start = Math.min(range.start, start);
		range.count = end - range.start;
	} else {
		range.start = start;
		range.count = count;
		target.updateRanges.push(range);
	}
	target.needsUpdate = true;
}
