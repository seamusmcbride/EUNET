import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger);
const lenis = new Lenis({ lerp: 0.09 });
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add((t) => lenis.raf(t * 1000));
gsap.ticker.lagSmoothing(0);
let hTween;

// Split headings into lines of characters; <br> starts a new line
function splitChars(el) {
  const lines = el.innerHTML.split(/<br\s*\/?>/i);
  el.innerHTML = lines.map((line) => {
    const tmp = document.createElement('div');
    tmp.innerHTML = line;
    const chars = [...tmp.childNodes].map((node) => {
      const text = node.textContent;
      const wrap = (c) => (c === ' ' ? ' ' : `<span class="ch">${c}</span>`);
      const inner = [...text].map(wrap).join('');
      return node.nodeType === 1 ? `<${node.tagName.toLowerCase()}>${inner}</${node.tagName.toLowerCase()}>` : inner;
    });
    return `<span class="line">${chars.join('')}</span>`;
  }).join('');
}
document.querySelectorAll('.split').forEach(splitChars);
document.querySelectorAll('.split-words').forEach((el) => {
  el.innerHTML = el.textContent.split(' ').map((w) => `<span class="w">${w}</span>`).join(' ');
});

// Hero headline rises letter by letter
gsap.from('.hero .ch', { yPercent: 110, rotate: 8, duration: 1.4, stagger: 0.025, ease: 'expo.out', delay: 0.2 });
gsap.from('.hero-note', { opacity: 0, y: 20, duration: 1, delay: 1 });

// Images open from a clipped strip, then drift slowly
document.querySelectorAll('.reveal').forEach((box) => {
  gsap.fromTo(box, { clipPath: 'inset(100% 0 0 0)' }, {
    clipPath: 'inset(0% 0 0 0)', duration: 1.6, ease: 'expo.inOut',
    scrollTrigger: box.closest('.h-track')
      ? { trigger: box, start: 'left 95%', containerAnimation: hScroll() }
      : { trigger: box, start: 'top 85%' },
  });
});

// Words light up one by one as the paragraph scrolls past
document.querySelectorAll('.split-words').forEach((el) => {
  gsap.to(el.querySelectorAll('.w'), {
    opacity: 1, stagger: 0.1, ease: 'none',
    scrollTrigger: { trigger: el, start: 'top 80%', end: 'bottom 45%', scrub: true },
  });
});

// Pinned horizontal gallery
function hScroll() {
  if (hTween) return hTween;
  const track = document.querySelector('.h-track');
  hTween = gsap.to(track, {
    x: () => -(track.scrollWidth - innerWidth),
    ease: 'none',
    scrollTrigger: { trigger: '.horizontal', pin: true, scrub: 1, end: () => '+=' + track.scrollWidth, invalidateOnRefresh: true },
  });
  return hTween;
}
hScroll();
document.querySelectorAll('.panel img').forEach((img) => {
  gsap.to(img, { xPercent: -12, ease: 'none',
    scrollTrigger: { trigger: img.closest('.panel'), containerAnimation: hTween, start: 'left right', end: 'right left', scrub: true } });
});

// Ticker that speeds up and reverses with scroll direction
const ticker = gsap.to('.t-track', { xPercent: -50, duration: 18, ease: 'none', repeat: -1 });
lenis.on('scroll', ({ velocity }) => {
  gsap.to(ticker, { timeScale: gsap.utils.clamp(-6, 6, 1 + velocity * 0.3), duration: 0.3, overwrite: true });
});

// Footer headline
gsap.from('footer .ch', { yPercent: 110, duration: 1.2, stagger: 0.04, ease: 'expo.out',
  scrollTrigger: { trigger: 'footer', start: 'top 60%' } });

// Magnetic buttons pull toward the cursor
document.querySelectorAll('.magnetic').forEach((btn) => {
  btn.addEventListener('pointermove', (e) => {
    const r = btn.getBoundingClientRect();
    gsap.to(btn, { x: (e.clientX - r.left - r.width / 2) * 0.35, y: (e.clientY - r.top - r.height / 2) * 0.35, duration: 0.4 });
  });
  btn.addEventListener('pointerleave', () => gsap.to(btn, { x: 0, y: 0, duration: 0.8, ease: 'elastic.out(1, .4)' }));
});
