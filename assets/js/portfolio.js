/* =========================================================================
   Prasad Chopade — Printed Portfolio
   Behaviour layer for Portfolio.dc.html.

   Ported from the design file's logic component. Five behaviours share
   one rAF loop so the page never runs more than a single animation frame
   callback:

     1. plate rules  — hairlines that draw in as a plate enters view
     2. dust field   — three parallax particle layers + an accent glow
     3. project rail — auto-advancing marquee with momentum drag
     4. folio        — split-flap plate indicator
     5. plate nav    — left rail marker, keyboard paging

   Everything degrades: with JS off the content is fully readable, the rail
   is a native horizontal scroller, and all project panels render open.
   Under `prefers-reduced-motion` the rAF loop never starts.
   ========================================================================= */

(function () {
  'use strict';

  var root = document.documentElement;
  root.classList.add('js');

  var STILL = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  var IDS   = ['cover', 'profile', 'projects', 'writing', 'stack', 'contact'];
  var NAMES = ['COVER', 'PROFILE', 'PROJECTS', 'PUBLICATIONS', 'SKILLS', 'CONTACT'];

  var clamp01 = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };
  var smooth  = function (t) { return t * t * (3 - 2 * t); };

  /* Scroll offset and viewport, sampled once at the top of each frame and
     shared by everything below. Reading them mid-frame, after styles have
     already been written, forces a synchronous layout every time. */
  var Frame = { sx: 0, sy: 0, vw: 1200, vh: 800 };

  function sampleFrame() {
    Frame.sx = window.scrollX;
    Frame.sy = window.scrollY;
    Frame.vw = window.innerWidth || 1200;
    Frame.vh = window.innerHeight || 800;
  }

  /* ---------------------------------------------------------------------
     Plate navigation — left rail marker, folio flip, keyboard paging
     --------------------------------------------------------------------- */

  var Nav = {
    active: 0,
    flapT: null,

    init: function () {
      this.marker  = document.querySelector('[data-marker]');
      this.buttons = Array.prototype.slice.call(document.querySelectorAll('[data-jump]'));
      this.num     = document.getElementById('folio-num');
      this.name    = document.getElementById('folio-name');

      var self = this;

      this.buttons.forEach(function (btn) {
        btn.addEventListener('click', function () {
          self.jump(parseInt(btn.getAttribute('data-jump'), 10));
        });
      });

      this.onScroll = function () { self.sync(); };
      window.addEventListener('scroll', this.onScroll, { passive: true });

      this.onKey = function (e) {
        if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
        var t = e.target;
        if (t && (/^(input|textarea|select)$/i.test(t.tagName) || t.isContentEditable)) return;
        var n = parseInt(e.key, 10);
        if (!isNaN(n) && n >= 0 && n < IDS.length) {
          e.preventDefault();
          self.jump(n);
        }
      };
      document.addEventListener('keydown', this.onKey);

      this.sync();
    },

    jump: function (i) {
      var el = document.getElementById(IDS[i]);
      if (!el) return;
      var y = el.getBoundingClientRect().top + window.scrollY - 6;
      window.scrollTo({
        top: Math.max(0, y),
        behavior: STILL ? 'auto' : 'smooth'
      });
    },

    /* Which plate is under the reading line, and paint the indicators. */
    sync: function () {
      var probe = window.scrollY + 140;
      var next = 0;

      IDS.forEach(function (id, i) {
        var el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top + window.scrollY <= probe) next = i;
      });

      // Snap to the last plate once the page bottoms out, so a short final
      // section still registers as current.
      if (window.scrollY + window.innerHeight >= root.scrollHeight - 2) {
        next = IDS.length - 1;
      }

      this.setMarker(next);
      if (next !== this.active) {
        this.active = next;
        this.flap(next);
      }
    },

    setMarker: function (i) {
      if (this.marker) this.marker.style.transform = 'translateY(' + (i * 34 + 17) + 'px)';
      this.buttons.forEach(function (btn, j) {
        btn.setAttribute('aria-current', j === i ? 'true' : 'false');
      });
    },

    /* Split-flap: fold the number away, swap the text, drop it back. */
    flap: function (i) {
      if (!this.num || !this.name) return;

      var num = this.num;
      var name = this.name;
      var label = ('0' + i).slice(-2);

      if (STILL) {
        num.textContent = label;
        name.textContent = NAMES[i];
        return;
      }

      num.style.transition = 'transform 0.13s ease-in';
      num.style.transform = 'perspective(360px) rotateX(-88deg)';

      clearTimeout(this.flapT);
      this.flapT = setTimeout(function () {
        num.textContent = label;
        name.textContent = NAMES[i];
        num.style.transition = 'transform 0.26s cubic-bezier(0.16, 1.3, 0.3, 1)';
        num.style.transform = 'perspective(360px) rotateX(0deg)';
      }, 140);
    }
  };

  /* ---------------------------------------------------------------------
     Plate rules — hairline wipes in from the left as the plate arrives
     --------------------------------------------------------------------- */

  var Rules = {
    scan: 0,
    els: [],

    tick: function () {
      // Re-query occasionally rather than every frame; the DOM is static
      // apart from project panels opening and closing.
      this.scan++;
      if (!this.els.length || this.scan % 45 === 0) {
        this.els = Array.prototype.slice.call(document.querySelectorAll('[data-rule]'));
        this.els.forEach(function (el) { el.style.transition = 'none'; });
      }

      var band = Frame.vh * 0.86;
      var n = this.els.length;
      var tops = this.tops || (this.tops = []);

      for (var i = 0; i < n; i++) tops[i] = this.els[i].getBoundingClientRect().top;

      for (var j = 0; j < n; j++) {
        var e = smooth(clamp01(1 - tops[j] / band));
        var st = this.els[j].style;
        st.transform = 'scaleX(' + (0.05 + 0.95 * e).toFixed(4) + ')';
        st.opacity = (0.3 + 0.7 * e).toFixed(3);
      }
    }
  };

  /* ---------------------------------------------------------------------
     Dust — three particle layers drifting against scroll and pointer,
     plus a duplicate set tinted with the accent and revealed through a
     radial mask that follows the cursor.
     --------------------------------------------------------------------- */

  var Dust = {
    // [count, base size, size jitter] per layer, front to back
    SPEC:  [[19, 1.6, 1.3], [21, 1.1, 0.9], [25, 0.7, 0.6]],
    RATES: [0.34, 0.2, 0.1],

    px: 0.5, py: 0.5,   // smoothed pointer position, 0..1
    tx: 0.5, ty: 0.5,   // pointer target
    k: 0,  kt: 0,       // glow radius factor, smoothed / target
    docH: 1,
    n: 0,

    init: function () {
      this.layers = Array.prototype.slice.call(document.querySelectorAll('[data-dust-layer]'));
      this.lit = document.querySelector('[data-lit]');
      this.clones = [];

      if (!this.layers.length || this.layers[0].childElementCount) return;

      var self = this;

      this.layers.forEach(function (layer, li) {
        var spec = self.SPEC[li];
        var frag = document.createDocumentFragment();

        for (var i = 0; i < spec[0]; i++) {
          var dot = document.createElement('span');
          var sz = (spec[1] + Math.random() * spec[2]).toFixed(2);

          // Seeded past 100% vertically so the layer still has particles to
          // spare once scroll parallax pulls it upward.
          dot.style.cssText =
            'position:absolute;border-radius:50%;background:currentColor;' +
            'width:' + sz + 'px;height:' + sz + 'px;' +
            'left:' + (Math.random() * 99).toFixed(2) + '%;' +
            'top:' + (Math.random() * 146).toFixed(2) + '%;' +
            'opacity:' + (0.34 + Math.random() * 0.52).toFixed(2) + ';' +
            (STILL ? '' : 'animation:om-tw ' + (3.2 + Math.random() * 5).toFixed(2) +
              's ease-in-out ' + (Math.random() * 5).toFixed(2) + 's infinite alternate;');

          frag.appendChild(dot);
        }
        layer.appendChild(frag);
      });

      if (this.lit && !STILL) {
        this.layers.forEach(function (layer) {
          var c = layer.cloneNode(true);
          self.lit.appendChild(c);
          self.clones.push(c);
        });
      }
    },

    tick: function () {
      if (!this.layers || !this.layers.length) return;

      var vh = Frame.vh;
      var vw = Frame.vw;

      // scrollHeight is a layout read; sample it every 40th frame only.
      this.n++;
      if (this.n % 40 === 1) this.docH = Math.max(1, (root.scrollHeight || vh) - vh);

      var g = clamp01(Frame.sy / this.docH);

      this.px += (this.tx - this.px) * 0.075;
      this.py += (this.ty - this.py) * 0.075;
      this.k  += (this.kt - this.k)  * 0.06;

      var ox = this.px - 0.5;
      var oy = this.py - 0.5;

      for (var i = 0; i < this.layers.length; i++) {
        var dep = this.RATES[i];
        var tr = 'translate3d(' +
          (-ox * dep * 58).toFixed(1) + 'px,' +
          (-g * vh * dep - oy * dep * 44).toFixed(1) + 'px,0)';
        this.layers[i].style.transform = tr;
        if (this.clones[i]) this.clones[i].style.transform = tr;
      }

      if (this.lit && !STILL) {
        var r = Math.max(150, Math.min(280, vw * 0.19)) * this.k;
        var m = 'radial-gradient(circle ' + r.toFixed(0) + 'px at ' +
          (this.px * vw).toFixed(0) + 'px ' + (this.py * vh).toFixed(0) + 'px, ' +
          '#000 0%, rgba(0,0,0,0.55) 46%, transparent 74%)';
        this.lit.style.webkitMaskImage = m;
        this.lit.style.maskImage = m;
      }
    },

    aim: function (x, y) {
      this.tx = x / (window.innerWidth || 1);
      this.ty = y / (window.innerHeight || 1);
      this.kt = 1;
    },

    rest: function () {
      this.kt = 0;
      this.tx = 0.5;
      this.ty = 0.5;
    }
  };

  /* ---------------------------------------------------------------------
     Project rail — a looping marquee you can grab and fling
     --------------------------------------------------------------------- */

  var Rail = {
    GAP: 24,
    SPEED: 0.0525,      // px per ms at rest

    offset: 0,
    vel: 0.0525,
    held: false,        // pointer is over the rail
    dragging: false,
    moved: 0,           // px travelled this drag, gates the click
    open: null,
    last: 0,

    init: function () {
      this.el = document.querySelector('[data-rail]');
      if (!this.el) return;

      this.track = this.el.querySelector('[data-rail-track]');
      if (!this.track) return;

      // Only take over layout if we can actually animate. Otherwise the
      // CSS leaves the track as a native horizontal scroller.
      if (STILL) return;

      this.el.classList.add('is-marquee');

      var self = this;
      this.el.addEventListener('mouseenter', function () { self.held = true; });
      this.el.addEventListener('mouseleave', function () { self.held = false; });
      this.el.addEventListener('pointerdown', function (e) { self.dragStart(e); });

      // Hold while a card has keyboard focus, so tabbing through the rail
      // does not chase a moving target.
      this.el.addEventListener('focusin', function () { self.held = true; });
      this.el.addEventListener('focusout', function () { self.held = false; });

      // The cards become absolutely positioned the moment that class lands,
      // so place them now. Without this they stack at x=0 until the first
      // frame runs — which never happens at all if the page opened in a
      // background tab, where rAF is suspended.
      this.layout();
      document.addEventListener('visibilitychange', function () {
        self.last = 0;
        if (!document.hidden) self.layout();
      });
      window.addEventListener('resize', function () {
        self.stepW = 0;          // card width is fluid, re-read after a resize
        self.layout();
      });
    },

    /* Position every card from the current offset. Pure paint, no physics. */
    layout: function () {
      if (!this.track || !this.el.classList.contains('is-marquee')) return;

      var cards = this.track.children;
      var n = cards.length;
      if (!n) return;

      if (!this.stepW) this.stepW = cards[0].offsetWidth + this.GAP;
      var step = this.stepW;
      var total = step * n;
      this.offset = ((this.offset % total) + total) % total;

      for (var i = 0; i < n; i++) {
        var x = (i * step - this.offset) % total;
        if (x < -step) x += total;   // wrap the card that ran off the left
        cards[i].style.transform = 'translate3d(' + x + 'px, 0, 0)';
        cards[i].style.opacity = (this.open === null || this.open === i) ? '1' : '0.34';
      }
    },

    dragStart: function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      this.dragging = true;
      this.moved = 0;
      this.lastX = e.clientX;
      this.lastT = performance.now();
      this.vel = 0;
    },

    dragMove: function (e) {
      if (!this.dragging) return;
      var now = performance.now();
      var dx = e.clientX - this.lastX;
      var dt = Math.max(8, now - this.lastT);
      this.lastX = e.clientX;
      this.lastT = now;
      this.moved += Math.abs(dx);
      this.offset -= dx;
      // Blend instantaneous velocity into the running value so a flick
      // carries but jitter does not.
      var inst = Math.max(-4, Math.min(4, -dx / dt));
      this.vel = this.vel * 0.28 + inst * 0.72;
    },

    dragEnd: function () {
      if (!this.dragging) return;
      this.dragging = false;
      // A pointer that was held still before release should not fling.
      if (performance.now() - this.lastT > 90) this.vel = 0;
    },

    tick: function (now) {
      if (!this.track || !this.el.classList.contains('is-marquee')) return;
      if (!this.track.children.length) return;

      var dt = Math.min(64, this.last ? now - this.last : 16);
      this.last = now;

      if (!this.dragging) {
        // Ease toward a standstill while hovered or while a panel is open,
        // otherwise back up to cruising speed.
        var base = (this.held || this.open !== null) ? 0 : this.SPEED;
        this.vel += (base - this.vel) * (1 - Math.pow(0.965, dt / 16.67));
        this.offset += this.vel * dt;
      }

      this.layout();
    }
  };

  /* ---------------------------------------------------------------------
     Project panels — one open at a time, below the rail
     --------------------------------------------------------------------- */

  var Panels = {
    init: function () {
      var self = this;
      this.cards  = Array.prototype.slice.call(document.querySelectorAll('[data-open]'));
      this.panels = Array.prototype.slice.call(document.querySelectorAll('[data-panel]'));

      this.cards.forEach(function (card) {
        card.addEventListener('click', function () {
          self.toggle(parseInt(card.getAttribute('data-open'), 10));
        });
      });

      document.querySelectorAll('[data-close]').forEach(function (btn) {
        btn.addEventListener('click', function () { self.set(null); });
      });

      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && Rail.open !== null) self.set(null);
      });

      this.set(null);
    },

    toggle: function (i) {
      // Swallow the click that ends a drag.
      if (Rail.moved > 6) { Rail.moved = 0; return; }
      this.set(Rail.open === i ? null : i);
    },

    set: function (i) {
      Rail.open = i;

      this.panels.forEach(function (panel, j) {
        panel.hidden = (j !== i);
      });

      this.cards.forEach(function (card, j) {
        card.setAttribute('aria-expanded', j === i ? 'true' : 'false');
      });

      // Dim the unselected cards straight away rather than on the next frame.
      Rail.layout();
    }
  };

  /* ---------------------------------------------------------------------
     Boot
     --------------------------------------------------------------------- */

  function start() {
    Nav.init();
    Dust.init();
    Rail.init();
    Panels.init();

    window.addEventListener('pointermove', function (e) {
      Rail.dragMove(e);
      Dust.aim(e.clientX, e.clientY);
    }, { passive: true });

    document.addEventListener('pointerleave', function () { Dust.rest(); });
    window.addEventListener('pointerup', function () { Rail.dragEnd(); });
    window.addEventListener('pointercancel', function () { Rail.dragEnd(); });

    // Reduced motion: the static layout is already correct, so no loop.
    if (STILL) return;

    var frame = function (now) {
      sampleFrame();
      Rules.tick();
      Dust.tick();
      Rail.tick(now);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
