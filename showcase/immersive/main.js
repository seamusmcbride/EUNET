import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger);
const lenis = new Lenis({ lerp: 0.07 });
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add((t) => lenis.raf(t * 1000));
gsap.ticker.lagSmoothing(0);

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('gl'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x02030a, 0.018);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);

// Planet: noise-coloured surface with a soft terminator
const planetMat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uSun: { value: new THREE.Vector3(1, 0.4, 0.6).normalize() } },
  vertexShader: /* glsl */ `
    varying vec3 vN; varying vec3 vP;
    void main(){ vN = normalize(normalMatrix*normal); vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: /* glsl */ `
    uniform float uTime; uniform vec3 uSun; varying vec3 vN; varying vec3 vP;
    float h(vec3 p){ return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453); }
    float n(vec3 p){ vec3 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
      return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
                 mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
    float fbm(vec3 p){ float v=0.,a=.5; for(int i=0;i<5;i++){ v+=a*n(p); p*=2.1; a*=.5; } return v; }
    void main(){
      vec3 p = normalize(vP);
      float land = fbm(p*3. + vec3(uTime*.01,0,0));
      vec3 ocean = vec3(.03,.08,.25), shore = vec3(.1,.45,.6), ground = vec3(.35,.3,.6), peak = vec3(.9,.85,1.);
      vec3 col = mix(ocean, shore, smoothstep(.45,.5,land));
      col = mix(col, ground, smoothstep(.52,.6,land));
      col = mix(col, peak, smoothstep(.68,.75,land));
      float light = clamp(dot(vN, uSun), 0., 1.);
      // city lights on the night side
      float city = step(.8, n(p*80.)) * smoothstep(.52,.6,land) * (1.-smoothstep(0.,.2,light));
      gl_FragColor = vec4(col*(.08+light*1.1) + vec3(1.,.7,.3)*city*1.5, 1.);
    }`,
});
const planet = new THREE.Mesh(new THREE.SphereGeometry(10, 128, 128), planetMat);
scene.add(planet);

// Atmosphere: back-face Fresnel glow
const atmo = new THREE.Mesh(
  new THREE.SphereGeometry(10.9, 64, 64),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    vertexShader: `varying vec3 vN; void main(){ vN = normalize(normalMatrix*normal); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    // Back faces: normal.z runs from -1 at the centre to 0 at the rim, so this glows only at the edge
    fragmentShader: `varying vec3 vN; void main(){ float i = pow(clamp(1. + vN.z, 0., 1.), 4.); gl_FragColor = vec4(.35,.55,1.,1.)*i*1.4; }`,
  })
);
scene.add(atmo);

// Rings: 10k instanced crystals
const COUNT = 10000;
const rings = new THREE.InstancedMesh(
  new THREE.OctahedronGeometry(0.12),
  new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.6, emissive: 0x223366, emissiveIntensity: 0.6 }),
  COUNT
);
const seeds = [];
const dummy = new THREE.Object3D();
const color = new THREE.Color();
for (let i = 0; i < COUNT; i++) {
  const r = 15 + Math.random() * 9 + (Math.random() < 0.3 ? 6 : 0);
  seeds.push({ r, a: Math.random() * Math.PI * 2, y: (Math.random() - 0.5) * 0.6, s: 0.4 + Math.random() * 1.6, v: 0.02 + 0.3 / r });
  rings.setColorAt(i, color.setHSL(0.58 + Math.random() * 0.2, 0.7, 0.55 + Math.random() * 0.3));
}
rings.rotation.x = 0.35;
scene.add(rings);

// Starfield
const sGeo = new THREE.BufferGeometry();
const sp = new Float32Array(9000);
for (let i = 0; i < sp.length; i += 3) {
  const v = new THREE.Vector3().randomDirection().multiplyScalar(150 + Math.random() * 100);
  sp.set([v.x, v.y, v.z], i);
}
sGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
scene.add(new THREE.Points(sGeo, new THREE.PointsMaterial({ size: 0.6, color: 0xc8d4ff, fog: false })));

scene.add(new THREE.AmbientLight(0x404a80, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.position.copy(planetMat.uniforms.uSun.value).multiplyScalar(50);
scene.add(sun);

// Camera flight path, driven by scroll progress
const path = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 18, 70),
  new THREE.Vector3(32, 6, 30),
  new THREE.Vector3(20, -4, -22),
  new THREE.Vector3(-14, 4, -18),
  new THREE.Vector3(-8, 9, 11),
]);
const look = new THREE.Vector3();

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.5, 0.35);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const state = { progress: 0, smooth: 0 };
const bar = document.querySelector('.progress i');
const coord = document.getElementById('coord');
ScrollTrigger.create({
  start: 0, end: 'max',
  onUpdate: (st) => { state.progress = st.progress; },
});

const mouse = new THREE.Vector2();
addEventListener('pointermove', (e) => mouse.set(e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5));

gsap.ticker.add((t) => {
  state.smooth += (state.progress - state.smooth) * 0.06;
  const p = state.smooth;
  camera.position.copy(path.getPointAt(p));
  camera.position.x += mouse.x * 2;
  camera.position.y -= mouse.y * 2;
  look.set(0, 0, 0).lerp(path.getPointAt(Math.min(p + 0.08, 1)), p * 0.35);
  camera.lookAt(look);

  planetMat.uniforms.uTime.value = t;
  planet.rotation.y = t * 0.03;
  for (let i = 0; i < COUNT; i++) {
    const s = seeds[i];
    const a = s.a + t * s.v;
    dummy.position.set(Math.cos(a) * s.r, s.y, Math.sin(a) * s.r);
    dummy.rotation.set(t * s.s, t * s.s * 0.7, 0);
    dummy.scale.setScalar(s.s);
    dummy.updateMatrix();
    rings.setMatrixAt(i, dummy.matrix);
  }
  rings.instanceMatrix.needsUpdate = true;

  bar.style.transform = `scaleX(${p})`;
  coord.textContent = `${(p * 90).toFixed(3).padStart(6, '0')}° N`;
  composer.render();
});

// Chapter text reveals
document.querySelectorAll('.chapter').forEach((ch) => {
  gsap.to(ch.querySelectorAll('div > *'), {
    opacity: 1, y: 0, stagger: 0.12, duration: 1.2, ease: 'expo.out',
    scrollTrigger: { trigger: ch, start: 'top 60%', toggleActions: 'play none none reverse' },
  });
});
