/* Site orchestration: inline SVGs, build the NPC gallery and author bios,
   render math, and wire navigation, scroll-spy, scroll-reveal, collapsibles,
   pending links, and BibTeX copy. Runs after the deferred module scripts so
   their init functions are available. */
(function () {
  "use strict";

  // ---- inline SVG includes -------------------------------------------------
  function inlineSVGs() {
    var hosts = Array.prototype.slice.call(document.querySelectorAll("[data-include-svg]"));
    return Promise.all(hosts.map(function (host) {
      var url = host.getAttribute("data-include-svg");
      return fetch(url).then(function (r) { return r.ok ? r.text() : ""; })
        .then(function (txt) {
          if (!txt) { host.innerHTML = '<img src="' + url + '" alt="">'; return; }
          host.innerHTML = txt;
          var svg = host.querySelector("svg");
          if (svg) {
            svg.removeAttribute("width");
            svg.removeAttribute("height");
            svg.style.width = "100%";
            svg.style.height = "auto";
            svg.style.display = "block";
          }
        })
        .catch(function () { host.innerHTML = '<img src="' + url + '" alt="">'; });
    }));
  }

  // ---- math ----------------------------------------------------------------
  function renderMath() {
    if (typeof window.renderMathInElement !== "function") return;
    window.renderMathInElement(document.body, {
      delimiters: [
        { left: "\\[", right: "\\]", display: true },
        { left: "\\(", right: "\\)", display: false }
      ],
      throwOnError: false
    });
  }

  // ---- navigation ----------------------------------------------------------
  function initNav() {
    // the floating pill header stays fully visible at all scroll positions
    var toggle = document.querySelector(".nav-toggle");
    var nav = document.getElementById("nav");
    if (toggle && nav) {
      var setMenu = function (open) {
        nav.classList.toggle("open", open);
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
        toggle.setAttribute("aria-label", open ? "Close navigation" : "Toggle navigation");
        document.body.classList.toggle("nav-open", open);
      };
      toggle.addEventListener("click", function () {
        setMenu(!nav.classList.contains("open"));
      });
      nav.querySelectorAll("a").forEach(function (a) {
        a.addEventListener("click", function () { setMenu(false); });
      });
      // close the full-screen menu on Escape
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && nav.classList.contains("open")) setMenu(false);
      });
    }

    // scroll-spy
    var links = Array.prototype.slice.call(document.querySelectorAll("#nav a"));
    var map = {};
    links.forEach(function (a) {
      var id = a.getAttribute("href").slice(1);
      var sec = document.getElementById(id);
      if (sec) map[id] = a;
    });
    var sections = Object.keys(map).map(function (id) { return document.getElementById(id); });
    if (!("IntersectionObserver" in window) || !sections.length) return;
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          links.forEach(function (l) { l.classList.remove("active"); });
          var a = map[e.target.id];
          if (a) a.classList.add("active");
        }
      });
    }, { rootMargin: "-45% 0px -50% 0px", threshold: 0 });
    sections.forEach(function (s) { obs.observe(s); });
  }

  // ---- scroll reveal -------------------------------------------------------
  function initReveal() {
    var items = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) {
      items.forEach(function (i) { i.classList.add("in"); });
      return;
    }
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); obs.unobserve(e.target); }
      });
    }, { rootMargin: "0px 0px -10% 0px", threshold: 0.05 });
    items.forEach(function (i) { obs.observe(i); });
  }

  // ---- scenario video gallery ----------------------------------------------
  // Manifest-driven gallery: a left rail of pill selectors (one group per
  // dimension + clip ordinal) picks a clip that autoplays on the right.
  // Switching the View dimension keeps playback in sync (same scenario, other
  // camera); every other change restarts from the top. Options that would lead
  // to a combination with no clip are cross-filtered out (disabled).
  function initDemoGallery() {
    var root = document.getElementById("demo-gallery");
    if (!root) return;
    var url = root.getAttribute("data-manifest");

    fetch(url).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) { if (m) buildGallery(root, m); })
      .catch(function () { /* leave the gallery hidden if the manifest fails */ });
  }

  function buildGallery(root, m) {
    var rail = root.querySelector(".gallery-rail");
    var video = root.querySelector(".gallery-video");
    var caption = root.querySelector(".gallery-caption");
    var legend = root.querySelector(".gallery-legend");
    var base = m.base || "";
    var clips = m.clips || [];

    var regions = m.regions || {};
    var drive = m.drive || {};
    var viewOptions = m.views || [];

    // ordered categorical facets. control + npc apply only in "full" mode;
    // the noisy robustness branch and the heterogeneous policy collapse the
    // selector to a flat clip picker (see collapsed()).
    var CATS = [
      { key: "policy", label: "Agent types", options: m.policies || [] },
      { key: "robustness", label: "Robustness", options: m.robustness || [] },
      { key: "control", label: "Traffic condition", options: m.controls || [], fullOnly: true },
      { key: "npc", label: "Road users", options: m.npcs || [], fullOnly: true }
    ];

    // selection: { policy, robustness, control, npc, view, clip }
    var sel = {};

    function collapsed() {
      return sel.policy === "hetero" || sel.robustness === "noisy";
    }
    function activeCats() {
      return CATS.filter(function (c) { return !c.fullOnly || !collapsed(); });
    }

    // clips matching the current selection on the given categorical keys
    function matching(keys) {
      return clips.filter(function (c) {
        for (var i = 0; i < keys.length; i++) {
          if (c[keys[i]] !== sel[keys[i]]) return false;
        }
        return true;
      });
    }
    // the instance pool for the fully-fixed categorical selection
    function pool() {
      return matching(activeCats().map(function (c) { return c.key; }));
    }
    // distinct values reachable at active-category index `idx`, holding the
    // categories above it fixed (drives the strict top-down filtering)
    function optionsAt(idx) {
      var cats = activeCats();
      var keys = cats.slice(0, idx).map(function (c) { return c.key; });
      var set = {};
      matching(keys).forEach(function (c) { set[c[cats[idx].key]] = true; });
      return set;
    }

    function instance() {
      var p = pool();
      if (!p.length) return null;
      return p[Math.min(sel.clip || 0, p.length - 1)];
    }
    // which camera views this clip actually ships
    function viewsOf(inst) {
      return viewOptions.filter(function (v) { return inst && inst[v[0]]; });
    }
    function srcFor(inst) {
      if (!inst) return base + (m.placeholder || "");
      var path = inst[sel.view] || inst.agent || inst.aerial;
      return /^(https?:)?\/\/|^data:/.test(path) ? path : base + path;
    }

    // starting selection: first policy, robustness None, first reachable rest
    function firstValid() {
      sel = {
        policy: (m.policies[0] || [])[0],
        robustness: "none",
        control: (m.controls[0] || [])[0],
        npc: (m.npcs[0] || [])[0],
        view: (viewOptions[0] || [])[0],
        clip: 0
      };
      repairFrom(0);
    }

    // after a change at active-category index `from`, snap any now-unavailable
    // lower category to its first available option; then clamp the clip index
    // and ensure the chosen view exists on the resulting instance.
    function repairFrom(from) {
      var cats = activeCats();
      for (var i = Math.max(from, 0); i < cats.length; i++) {
        var opts = optionsAt(i);
        if (!opts[sel[cats[i].key]]) {
          var list = cats[i].options;
          for (var j = 0; j < list.length; j++) {
            if (opts[list[j][0]]) { sel[cats[i].key] = list[j][0]; break; }
          }
        }
      }
      var p = pool();
      if (sel.clip == null || sel.clip > p.length - 1) sel.clip = 0;
      var vs = viewsOf(p[sel.clip] || null).map(function (v) { return v[0]; });
      if (vs.indexOf(sel.view) < 0) sel.view = vs[0];
    }

    function choose(key, val) {
      var isView = key === "view";
      var prevTime = video.currentTime;
      var wasPaused = video.paused;

      if (key === "clip") {
        sel.clip = val;
      } else if (isView) {
        sel.view = val;
      } else {
        sel[key] = val;
        sel.clip = 0; // changing a facet resets the clip counter to 1
        var cats = activeCats(), idx = 0;
        for (var i = 0; i < cats.length; i++) if (cats[i].key === key) idx = i;
        repairFrom(idx + 1); // changing a facet may invalidate lower ones
      }
      render();
      loadVideo(isView, prevTime, wasPaused);
    }

    function loadVideo(isView, prevTime, wasPaused) {
      var next = srcFor(instance());
      if (next === video.getAttribute("src")) return; // same file → keep playing
      if (isView) {
        // same scenario, other camera: resume at the same point + play state
        var resume = function () {
          video.removeEventListener("loadedmetadata", resume);
          var t = isFinite(video.duration) ? Math.min(prevTime, video.duration) : prevTime;
          try { video.currentTime = t; } catch (e) { /* ignore */ }
          if (!wasPaused) { var pl = video.play(); if (pl && pl.catch) pl.catch(function () {}); }
        };
        video.addEventListener("loadedmetadata", resume);
      }
      video.setAttribute("src", next);
      video.load(); // autoplay+loop restart from 0 for non-view changes
    }

    // (re)build the rail: a pill group per active category, then View (only
    // when the clip ships more than one camera) and Clip (only when >1 clip).
    function render() {
      rail.innerHTML = "";
      var forced = []; // facets with a single choice → moved to the info bar

      activeCats().forEach(function (c, idx) {
        var opts = optionsAt(idx);
        // only render options that are actually available given the choices
        // above — unavailable values are hidden, not greyed out
        var avail = c.options.filter(function (opt) { return opts[opt[0]]; });
        if (avail.length > 1) {
          addGroup(c.label, avail.map(function (opt) {
            return { value: opt[0], text: opt[1] };
          }), sel[c.key], function (v) { choose(c.key, v); });
        } else if (avail.length === 1) {
          // one choice: drop the selector and surface it in the info bar,
          // but skip robustness when it's the trivial "None"
          if (!(c.key === "robustness" && avail[0][0] === "none")) {
            forced.push({ label: c.label, value: avail[0][1] });
          }
        }
      });

      var inst = instance();
      var vs = viewsOf(inst);
      if (vs.length > 1) {
        addGroup("Viewpoint", vs.map(function (v) {
          return { value: v[0], text: v[1] };
        }), sel.view, function (v) { choose("view", v); });
      } else if (vs.length === 1) {
        forced.push({ label: "View", value: vs[0][1] });
      }

      var p = pool();
      if (p.length > 1) {
        var clipOpts = [];
        for (var i = 0; i < p.length; i++) clipOpts.push({ value: i, text: String(i + 1) });
        addGroup("Clip", clipOpts, sel.clip, function (v) { choose("clip", v); });
      }
      renderCaption(inst, forced);
      renderLegend();
    }

    function addGroup(label, opts, activeVal, onPick) {
      var group = document.createElement("div");
      group.className = "opt-group";
      var lab = document.createElement("div");
      lab.className = "opt-label";
      lab.textContent = label;
      var wrap = document.createElement("div");
      wrap.className = "opt-pills";
      group.appendChild(lab);
      group.appendChild(wrap);
      opts.forEach(function (o) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "opt-pill";
        btn.textContent = o.text;
        if (o.value === activeVal) btn.classList.add("is-active");
        btn.addEventListener("click", function () { onPick(o.value); });
        wrap.appendChild(btn);
      });
      rail.appendChild(group);
    }

    // caption strip: any single-choice facets (no clip number), then location
    // + drive side. Drive is never shown without a location.
    function renderCaption(inst, forced) {
      function seg(label, value) {
        return '<span class="cap-seg"><span class="cap-dim">' + label +
          '</span><span class="cap-val">' + value + '</span></span>';
      }
      var html = "";
      (forced || []).forEach(function (f) { html += seg(f.label, f.value); });
      if (inst) {
        var loc = regions[inst.region] || inst.region || "";
        var side = loc ? (drive[inst.region] || drive._default || "") : "";
        if (loc) html += seg("Location", loc);
        if (side) html += seg("Drive", side);
      }
      caption.innerHTML = html;
    }

    // scene legend, alongside the location/drive caption. It uses the real
    // render-output icons (assets/legend/*.svg, transparent on a dark tile). The
    // set is fixed — every entity that can appear in a clip is listed — except
    // the ego icon, which follows the selected policy (car vs truck).
    var LEGEND_DIR = "assets/legend/";
    function legIcon(file, label) {
      return '<span class="leg-item"><span class="leg-swatch">' +
        '<img src="' + LEGEND_DIR + file + '" alt="" aria-hidden="true"></span>' +
        '<span class="leg-label">' + label + "</span></span>";
    }

    function renderLegend() {
      if (!legend) return;
      // two rows: physical actors/hazards, then static HD-map elements. Only the
      // ego entry is adaptive (car vs truck by policy); everything else is fixed.
      var objects = [
        sel.policy === "truck"
          ? { file: "ego_truck.svg", label: "Ego" }
          : { file: "ego_car.svg", label: "Ego" },
        { file: "npc_vehicle.svg", label: "Sim agents" },
        { file: "static_vehicle.svg", label: "Stationary vehicle" },
        { file: "pedestrian.svg", label: "Pedestrians" },
        { file: "cyclist.svg", label: "Cyclists" },
        { file: "cone.svg", label: "Cones" }
      ];
      var mapElements = [
        { file: "lane_line.svg", label: "Lane lines" },
        { file: "lane_center.svg", label: "Lane center" },
        { file: "road_edge.svg", label: "Road edge" },
        { file: "crosswalk.svg", label: "Crosswalk" },
        { file: "sidewalk.svg", label: "Sidewalk" },
        { file: "stop_sign.svg", label: "Stop sign" },
        { file: "tl_red.svg", label: "Traffic light" }
      ];
      function row(title, items) {
        var h = '<div class="leg-row"><span class="leg-title">' + title +
          '</span><span class="leg-items">';
        items.forEach(function (it) { h += legIcon(it.file, it.label); });
        return h + "</span></div>";
      }
      legend.innerHTML = row("Objects", objects) + row("Map elements", mapElements);
    }

    firstValid();
    render();
    loadVideo(false);
    root.hidden = false;
  }

  // ---- foldable demo strips (InterPlan / val14 / WOSAC) --------------------
  // Each `.ipg[data-manifest]` is a collapsed toggle that expands to a
  // horizontally scrollable row of looping video tiles. Clips are read from a
  // JSON manifest ({ base, note, clips:[{src,label}] }). Videos lazy-load and
  // play only while scrolled into the strip's viewport, and pause when the
  // strip is collapsed.
  function initDemoStrips() {
    var roots = Array.prototype.slice.call(document.querySelectorAll(".ipg[data-manifest]"));
    roots.forEach(function (root) {
      var url = root.getAttribute("data-manifest");
      fetch(url).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (m) { if (m && m.clips && m.clips.length) buildStrip(root, m); })
        .catch(function () { /* leave hidden if the manifest fails */ });
    });
  }

  function buildStrip(root, m) {
    var toggle = root.querySelector(".ipg-toggle");
    var panel = root.querySelector(".ipg-panel");
    var strip = root.querySelector(".ipg-strip");
    var count = root.querySelector(".ipg-count");
    var noteEl = root.querySelector(".ipg-note");
    var base = m.base || "";
    var clips = m.clips || [];

    if (m.aspect) strip.style.setProperty("--frame-ar", m.aspect);
    if (count) count.textContent = "(" + clips.length + ")";
    if (noteEl) {
      if (m.note) { noteEl.textContent = m.note; noteEl.hidden = false; }
      else { noteEl.hidden = true; }
    }

    clips.forEach(function (c) {
      var src = /^(https?:)?\/\/|^data:/.test(c.src) ? c.src : base + c.src;
      var tile = document.createElement("figure");
      tile.className = "ipg-tile";
      var frame = document.createElement("div");
      frame.className = "ipg-frame";
      var v = document.createElement("video");
      v.muted = true; v.loop = true; v.playsInline = true;
      v.setAttribute("muted", ""); v.setAttribute("playsinline", "");
      v.preload = "none";
      v.setAttribute("controlslist", "nodownload");
      v.setAttribute("data-src", src);
      frame.appendChild(v);
      tile.appendChild(frame);
      if (c.label) {
        var cap = document.createElement("figcaption");
        cap.textContent = c.label;
        tile.appendChild(cap);
      }
      strip.appendChild(tile);
    });

    var videos = Array.prototype.slice.call(strip.querySelectorAll("video"));
    var io = null;
    // lazy-load + play only tiles scrolled into the strip; pause the rest
    function ensureObserver() {
      if (io || !("IntersectionObserver" in window)) return;
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          var v = e.target;
          if (e.isIntersecting) {
            if (!v.getAttribute("src")) { v.setAttribute("src", v.getAttribute("data-src")); v.load(); }
            var p = v.play(); if (p && p.catch) p.catch(function () {});
          } else {
            v.pause();
          }
        });
      }, { root: strip, rootMargin: "0px 240px 0px 240px", threshold: 0.25 });
      videos.forEach(function (v) { io.observe(v); });
    }

    function setOpen(open) {
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      panel.hidden = !open;
      if (open) {
        ensureObserver();
        if (!io) { // no IntersectionObserver: load + play everything
          videos.forEach(function (v) {
            if (!v.getAttribute("src")) { v.setAttribute("src", v.getAttribute("data-src")); v.load(); }
            var p = v.play(); if (p && p.catch) p.catch(function () {});
          });
        }
      } else {
        videos.forEach(function (v) { v.pause(); });
      }
    }

    toggle.addEventListener("click", function () {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });
    setOpen(false);
    root.hidden = false;
  }

  // ---- BibTeX reveal + copy ------------------------------------------------
  function initBibtex() {
    var toggle = document.getElementById("bibtex-toggle");
    var block = document.getElementById("bibtex-block");
    if (!toggle || !block) return;
    toggle.addEventListener("click", function () {
      var opening = block.hasAttribute("hidden");
      if (opening) block.removeAttribute("hidden"); else block.setAttribute("hidden", "");
      toggle.setAttribute("aria-expanded", opening ? "true" : "false");
    });
    var copy = block.querySelector(".copy-btn");
    var code = block.querySelector("code");
    if (!copy || !code) return;
    function fallback(text) {
      var ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch (e) { /* ignore */ }
      document.body.removeChild(ta);
    }
    copy.addEventListener("click", function () {
      var text = code.textContent;
      var flash = function () {
        copy.textContent = "Copied!";
        setTimeout(function () { copy.textContent = "Copy"; }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(flash, function () { fallback(text); flash(); });
      } else { fallback(text); flash(); }
    });
  }

  // ---- integrations showcase -----------------------------------------------
  // A flat tablist: clicking a tab activates it, reveals its panel, hides the
  // others, and pauses the off-screen videos so only the visible one plays.
  // Left/right arrows move focus and selection between tabs.
  function initIntegrations() {
    var root = document.getElementById("integrations-widget");
    if (!root) return;
    var tabs = Array.prototype.slice.call(root.querySelectorAll(".intg-tab"));
    if (!tabs.length) return;
    var slider = root.querySelector(".intg-slider");
    var current = 0;
    // videos hold off until the widget is scrolled into view (no autoplay attr)
    var inView = false;

    // slide the thumb behind the active tab, matching its size and position
    function moveSlider(idx) {
      if (!slider) return;
      var tab = tabs[idx];
      slider.style.width = tab.offsetWidth + "px";
      slider.style.height = tab.offsetHeight + "px";
      slider.style.transform = "translate(" + tab.offsetLeft + "px," + tab.offsetTop + "px)";
    }

    // a panel may hold several videos (e.g. the SPACeR 3-up comparison); play
    // only the active panel's videos, and only while the widget is on screen.
    function syncVideos() {
      tabs.forEach(function (tab, i) {
        var panel = document.getElementById(tab.getAttribute("aria-controls"));
        if (!panel) return;
        panel.querySelectorAll("video").forEach(function (video) {
          if (i === current && inView) {
            var p = video.play(); if (p && p.catch) p.catch(function () {});
          } else {
            video.pause();
          }
        });
      });
    }

    function select(idx) {
      current = idx;
      tabs.forEach(function (tab, i) {
        var active = i === idx;
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-selected", active ? "true" : "false");
        tab.tabIndex = active ? 0 : -1;
        var panel = document.getElementById(tab.getAttribute("aria-controls"));
        if (panel) panel.hidden = !active;
      });
      syncVideos();
      moveSlider(idx);
    }

    tabs.forEach(function (tab, i) {
      tab.addEventListener("click", function () { select(i); });
      tab.addEventListener("keydown", function (e) {
        var dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!dir) return;
        e.preventDefault();
        var next = (i + dir + tabs.length) % tabs.length;
        tabs[next].focus();
        select(next);
      });
    });

    // honor the markup's initial active tab (default to the first)
    var start = tabs.findIndex(function (t) { return t.classList.contains("is-active"); });
    start = start < 0 ? 0 : start;
    // place the thumb without animating in from the corner on first paint
    if (slider) slider.style.transition = "none";
    select(start);
    if (slider) {
      // force reflow, then restore the animated transition for later clicks
      void slider.offsetWidth;
      slider.style.transition = "";
    }
    // keep the thumb aligned if the layout reflows (resize, font load)
    window.addEventListener("resize", function () { moveSlider(current); });

    // gate playback on visibility: start the active video when the widget
    // scrolls into view, pause everything when it leaves
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { inView = e.isIntersecting; });
        syncVideos();
      }, { threshold: 0.2 });
      io.observe(root);
    } else {
      inView = true;
      syncVideos();
    }
  }

  // ---- boot ----------------------------------------------------------------
  function boot() {
    initNav();
    initReveal();
    initDemoGallery();
    initDemoStrips();
    initBibtex();
    initIntegrations();
    if (window.TZtables) window.TZtables.init();
    if (window.TZcharts) window.TZcharts.init();
    if (window.TZcompare) window.TZcompare.init();
    inlineSVGs().then(function () {
      renderMath();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
