// Models, matcaps and textures made in Blender (assets/): the jewel cursor
// silhouettes, a sakura blossom, petal, leaf, gem heart, star and butterfly
// wing in bloom.glb, studio-lit matcap spheres and the petal, wing and
// sprite textures.
//
// The models are in page px (cursors) or unit size (everything else), modelled
// with z toward the viewer, so they drop straight into the y-up camera space.
import * as THREE from 'three';
import { GLTFLoader } from './three/loaders/GLTFLoader.js';

const MATCAPS = ['pearl', 'candy', 'gold', 'petal', 'leaf', 'lilac'];

// Shared by every glitter material: seconds since the page started.
export const glitterTime = { value: 0 };

const url = (file) => new URL(`./assets/${file}`, import.meta.url).href;

export async function loadAssets() {
	const textures = new THREE.TextureLoader();
	const texture = async (file, srgb = true) => {
		const t = await textures.loadAsync(url(file));
		if (srgb) t.colorSpace = THREE.SRGBColorSpace;
		return t;
	};
	const [gltf, sprites, petalMap, wingMap, ...caps] = await Promise.all([
		new GLTFLoader().loadAsync(url('bloom.glb')),
		texture('sprites.png', false),
		texture('petal.png'),
		texture('wing.png'),
		...MATCAPS.map((n) => texture(`matcap-${n}.png`)),
	]);

	const geo = {};
	gltf.scene.traverse((o) => {
		if (!o.isMesh) return;
		// The blossom is one node with a primitive per material.
		const key = o.parent?.name === 'blossom' ? `blossom_${o.material.name.replace('bloom_', '')}` : o.name;
		geo[key] = o.geometry;
	});

	return {
		geo,
		matcap: Object.fromEntries(MATCAPS.map((n, i) => [n, caps[i]])),
		sprites,
		petalMap,
		wingMap,
	};
}

// Matcap shading with the view direction fixed for the orthographic camera
// (the stock shader bends it toward the page corners), plus screen-space
// glitter: a sparse field of pixels that flash as the surface turns.
// rim: how far edges turned away from the viewer darken toward deep magenta,
// which keeps pale jewels legible over white pages. shine: a uniform
// {value: Vector3(x, y, offset)} in device px, y up; a diagonal band of light
// sits `offset` px from (x, y) and sweeps as the owner moves it.
export function jewelMaterial(matcap, { map = null, glitter = 0, rim = 0, shine = null, side = THREE.FrontSide } = {}) {
	const m = new THREE.MeshMatcapMaterial({ matcap, map, side });
	m.onBeforeCompile = (shader) => {
		shader.uniforms.uTime = glitterTime;
		shader.uniforms.uGlitter = { value: glitter };
		shader.uniforms.uRim = { value: rim };
		shader.uniforms.uShine = shine ?? { value: new THREE.Vector3(0, 0, 1e5) };
		shader.fragmentShader = shader.fragmentShader
			.replace('void main() {', /* glsl */ `
uniform float uTime;
uniform float uGlitter;
uniform float uRim;
uniform vec3 uShine;
float glitterHash(vec2 p) {
	vec3 q = fract(vec3(p.xyx) * vec3(443.897, 441.423, 437.195));
	q += dot(q, q.yzx + 19.19);
	return fract((q.x + q.y) * q.z);
}
void main() {`)
			.replace('vec3 viewDir = normalize( vViewPosition );', 'vec3 viewDir = vec3( 0.0, 0.0, 1.0 );')
			.replace('vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;', /* glsl */ `
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	outgoingLight = mix( outgoingLight, vec3( 0.45, 0.02, 0.25 ), uRim * ( 1.0 - smoothstep( 0.1, 0.9, abs( normal.z ) ) ) );
	float band = ( gl_FragCoord.x - uShine.x ) - ( gl_FragCoord.y - uShine.y ) - uShine.z;
	outgoingLight += vec3( 1.0, 0.92, 0.97 ) * 0.85 * exp( - band * band / 40.0 ) * smoothstep( 0.2, 0.7, normal.z );
	if ( uGlitter > 0.0 ) {
		vec2 cell = floor( gl_FragCoord.xy / 2.0 );
		float h = glitterHash( cell );
		float facing = dot( normal, vec3( 3.1, 4.7, 2.3 ) );
		float flash = pow( 0.5 + 0.5 * sin( facing * 6.0 + h * 60.0 + uTime * ( 3.0 + 6.0 * h ) ), 12.0 );
		outgoingLight += uGlitter * step( 0.9, h ) * flash * vec3( 1.0, 0.9, 0.97 );
	}`);
	};
	return m;
}
