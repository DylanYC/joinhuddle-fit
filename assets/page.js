// Shared layout helpers for Risers subpages (privacy / terms / contact).
// Handles the theme toggle (persisted via localStorage) and the floating-nav
// scroll effect. The nav/footer logos are plain <img> tags in each page's
// markup, pointing at the Risers SVGs in assets/.

// Storage key is shared with index.html's own inline toggle; renaming it here
// would split the two and reset everyone's saved theme.
const THEME_KEY = 'huddle-theme';
const site = document.getElementById('site');
const ticon = document.getElementById('ticon');
const tlbl = document.getElementById('tlbl');

function applyTheme(light) {
  site.classList.toggle('light', light);
  if (ticon) ticon.textContent = light ? '☀️' : '🌙';
  if (tlbl) tlbl.textContent = light ? 'Light' : 'Dark';
}

// A #dark / #light hash (e.g. risers.fit/contact.html#dark) forces a theme on
// load and persists it, matching the home page's shareable-link behaviour.
const hash = location.hash.toLowerCase();
if (hash === '#dark' || hash === '#light') {
  localStorage.setItem(THEME_KEY, hash.slice(1));
}

const stored = localStorage.getItem(THEME_KEY);
if (stored === 'dark') applyTheme(false);

window.toggleMode = function () {
  const nowLight = !site.classList.contains('light');
  applyTheme(nowLight);
  localStorage.setItem(THEME_KEY, nowLight ? 'light' : 'dark');
};

const nav = document.querySelector('.nav');
if (nav) {
  // Hysteresis: add 'scrolled' past ENTER, remove only below EXIT. The dead
  // zone between the two thresholds stops the class from oscillating (and
  // restarting the transition) when scroll jitter hovers near the boundary.
  const ENTER = 40;
  const EXIT = 10;
  let scrolled = false;
  let ticking = false;
  const apply = () => {
    ticking = false;
    const y = window.scrollY;
    if (!scrolled && y > ENTER) {
      scrolled = true;
      nav.classList.add('scrolled');
    } else if (scrolled && y < EXIT) {
      scrolled = false;
      nav.classList.remove('scrolled');
    }
  };
  const onScroll = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(apply);
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  apply();
}
