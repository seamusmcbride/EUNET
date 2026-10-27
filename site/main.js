import * as THREE from 'three';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger);

// Smooth scrolling, driven by GSAP's ticker so ScrollTrigger stays in sync
const lenis = new Lenis();
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add((t) => lenis.raf(t * 1000));
gsap.ticker.lagSmoothing(0);

// WebGL background: a noise-displaced glowing sphere plus a starfield
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.z = 6;

const uniforms = { uTime: { value: 0 }, uMouse: { value: new THREE.Vector2() }, uScroll: { value: 0 } };
const blob = new THREE.Mesh(
  new THREE.IcosahedronGeometry(1.6, 64),
  new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      uniform float uTime; uniform vec2 uMouse; uniform float uScroll;
      varying float vNoise; varying vec3 vNormal;
      // 3D simplex-ish noise (cheap hash-based value noise)
      float hash(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
      float noise(vec3 p){
        vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
      }
      void main(){
        float n = noise(normal*2.2 + uTime*.4 + vec3(uMouse,0.)) ;
        n += .5*noise(normal*4.5 - uTime*.3);
        vNoise = n; vNormal = normal;
        vec3 p = position + normal * (n*.55 + uScroll*.8);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.);
      }`,
    fragmentShader: /* glsl */ `
      varying float vNoise; varying vec3 vNormal; uniform float uTime;
      void main(){
        vec3 a = vec3(.49,.36,1.), b = vec3(0.,.88,.78), c = vec3(1.,.35,.6);
        vec3 col = mix(a, b, smoothstep(.3,1.2,vNoise));
        col = mix(col, c, smoothstep(.9,1.4,vNoise + sin(uTime)*.1));
        float rim = pow(1. - abs(vNormal.z), 2.);
        gl_FragColor = vec4(col + rim*.6, 1.);
      }`,
  })
);
scene.add(blob);

const starGeo = new THREE.BufferGeometry();
const pos = new Float32Array(3000);
for (let i = 0; i < pos.length; i++) pos[i] = (Math.random() - 0.5) * 30;
starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 0.03, color: 0xffffff, transparent: true, opacity: 0.7 }));
scene.add(stars);

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  blob.position.x = innerWidth > 900 ? 2 : 0;
}
addEventListener('resize', resize);
resize();

const mouse = { x: 0, y: 0 };
const cursor = document.querySelector('.cursor');
addEventListener('pointermove', (e) => {
  mouse.x = e.clientX / innerWidth - 0.5;
  mouse.y = e.clientY / innerHeight - 0.5;
  gsap.to(cursor, { x: e.clientX, y: e.clientY, duration: 0.25, ease: 'power3' });
});

gsap.ticker.add((t) => {
  uniforms.uTime.value = t;
  uniforms.uMouse.value.lerp(new THREE.Vector2(mouse.x, mouse.y), 0.05);
  blob.rotation.y = t * 0.15 + mouse.x * 0.6;
  blob.rotation.x = mouse.y * 0.4;
  stars.rotation.y = t * 0.02;
  renderer.render(scene, camera);
});

// Blob swells and recedes as you scroll past the hero
gsap.to(uniforms.uScroll, { value: 1, scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
gsap.to(blob.scale, { x: 0.4, y: 0.4, z: 0.4, scrollTrigger: { trigger: '.gallery', start: 'top bottom', end: 'top top', scrub: true } });

// Intro
gsap.from('.title span', { yPercent: 110, opacity: 0, duration: 1.2, stagger: 0.12, ease: 'expo.out' });
gsap.from(['.eyebrow', '.lead', '.hero .btn'], { y: 30, opacity: 0, duration: 1, delay: 0.5, stagger: 0.1, ease: 'power3.out' });

// Endless marquee, nudged by scroll
gsap.to('.track', { xPercent: -50, duration: 20, ease: 'none', repeat: -1 });

// Cards: reveal on scroll, parallax image, 3D tilt on hover
document.querySelectorAll('.card').forEach((card, i) => {
  gsap.from(card, { y: 120, opacity: 0, rotate: i % 2 ? 3 : -3, duration: 1.2, ease: 'expo.out',
    scrollTrigger: { trigger: card, start: 'top 90%' } });
  gsap.fromTo(card.querySelector('img'), { yPercent: -10 }, { yPercent: 0, ease: 'none',
    scrollTrigger: { trigger: card, scrub: true } });
  card.addEventListener('pointermove', (e) => {
    const r = card.getBoundingClientRect();
    gsap.to(card, { rotateY: ((e.clientX - r.left) / r.width - 0.5) * 14,
      rotateX: -((e.clientY - r.top) / r.height - 0.5) * 14, transformPerspective: 900, duration: 0.4 });
  });
  card.addEventListener('pointerleave', () => gsap.to(card, { rotateX: 0, rotateY: 0, duration: 0.6 }));
});

// Count-up stats
document.querySelectorAll('.stat b').forEach((el) => {
  const to = parseFloat(el.dataset.to);
  const obj = { v: 0 };
  gsap.to(obj, { v: to, duration: 2, ease: 'power2.out',
    scrollTrigger: { trigger: el, start: 'top 85%' },
    onUpdate: () => (el.textContent = to % 1 ? obj.v.toFixed(2) : Math.round(obj.v)) });
});

gsap.from('.cta h2', { scale: 0.8, opacity: 0, duration: 1.2, ease: 'expo.out', scrollTrigger: { trigger: '.cta', start: 'top 70%' } });
