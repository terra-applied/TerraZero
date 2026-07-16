/* Interactive method-comparison explorer. For each `.cmp[data-src]` host it
   loads a benchmark JSON (interPlan / val14 / WOSAC) and draws two figures of
   the top contenders: a composite-score bar chart and a radar/hex of the
   component metrics. A single shared colour encodes each method across both
   charts and one legend — TerraZero is the hero in Applied Blue, baselines take
   muted distinct hues — so there's only one symbol set to learn. Hovering any
   element (a bar, its name, a radar polygon, or a legend key) highlights that
   method in BOTH charts at once. The radar is scaled per axis relative to the
   min/max of the methods shown, so close scores still spread. Bars/radar grow
   when first scrolled into view, and honor prefers-reduced-motion. On fetch
   failure the host's <noscript> static table is revealed instead. Exposed as
   window.TZcompare.init(). */
(function () {
  "use strict";

  var SVGNS = "http://www.w3.org/2000/svg";
  var BLUE = "#006CFA";                 // TerraZero — the one earned accent
  var BLUE_FILL = "rgba(0,108,250,0.15)";
  var GRAY = "#767676";
  var LINE = "#e4e4e4";
  var INK = "#1f2937";
  // Colour encodes the TYPE of approach, not the individual method: every
  // baseline family gets one value-stepped grey (no hue), shared across ALL
  // figures, so "Rule-based" reads the same grey on val14 as on WOSAC. TerraZero
  // stays the single blue accent, and a reference/ceiling row stays dashed grey.
  // Same-type methods therefore share a shade and are told apart by their bar
  // label (and by hover, which isolates one at a time).
  var TYPE_GREYS = {
    "Rule":   "#333a45",
    "Hybrid": "#5b6675",
    "IL":     "#8a929e",
    "RL":     "#b2b9c2",
    "RLdemo": "#b2b9c2",
    "Replay": "#cdd2d9"
  };
  var TYPE_LABEL = {
    "Rule": "Rule-based", "Hybrid": "Hybrid", "IL": "IL",
    "RL": "RL", "RLdemo": "RL (Demonstration-derived)", "Replay": "Replay"
  };
  // title typography per family, so types read apart beyond colour/pattern.
  // TerraZero is exempt (plain blue — the accent already marks it); the reference
  // row is italic (set in drawLegend/drawBars). Keys are SVG/CSS attribute names
  // so the same map drives both SVG bar labels and HTML legend labels.
  var TYPE_STYLE = {
    "Rule":   {},
    "Hybrid": { "text-decoration": "underline" },
    "IL":     { "font-style": "italic" },
    "RL":     { "font-weight": "700" },
    "RLdemo": { "font-weight": "700" },
    "Replay": {}
  };

  // Beyond the grey shade, each approach type also carries a distinct hatch
  // texture, so the families stay separable when the charts are small or printed
  // in greyscale. Patterns live in one hidden <svg> injected once and are
  // referenced by id from every bar and legend swatch in the document.
  // charts that share one external legend (the WOSAC pair) register their
  // emphasis hooks here under a group name; a static legend marked
  // data-legend-group="<name>" then drives every chart in the group at once.
  var LEGEND_GROUPS = {};
  function wireSharedLegends() {
    var legs = document.querySelectorAll("[data-legend-group]");
    Array.prototype.forEach.call(legs, function (leg) {
      var g = leg.getAttribute("data-legend-group");
      Array.prototype.forEach.call(leg.querySelectorAll(".key[data-type]"), function (key) {
        var kind = key.getAttribute("data-type");
        key.addEventListener("mousemove", function () {
          (LEGEND_GROUPS[g] || []).forEach(function (r) { r.emph(kind); });
        });
      });
      leg.addEventListener("mouseleave", function () {
        (LEGEND_GROUPS[g] || []).forEach(function (r) { r.clear(); });
      });
    });
  }

  var PATTERNS_ADDED = false;
  function ensurePatterns() {
    if (PATTERNS_ADDED) return;
    PATTERNS_ADDED = true;
    var host = document.createElementNS(SVGNS, "svg");
    host.setAttribute("width", "0"); host.setAttribute("height", "0");
    host.setAttribute("aria-hidden", "true");
    host.style.position = "absolute";
    var defs = document.createElementNS(SVGNS, "defs");
    var S = 6, light = "rgba(255,255,255,0.45)", dark = "rgba(0,0,0,0.24)";
    function tile(type, draw) {
      var p = el("pattern", {
        id: "cmp-pat-" + type, patternUnits: "userSpaceOnUse",
        width: S, height: S
      });
      p.appendChild(el("rect", { x: 0, y: 0, width: S, height: S, fill: TYPE_GREYS[type] }));
      if (draw) draw(p);
      defs.appendChild(p);
    }
    tile("Rule");                                                   // solid, darkest
    tile("Hybrid", function (p) {                                   // forward hatch
      p.appendChild(el("path", { d: "M0,6 L6,0 M-1.5,1.5 L1.5,-1.5 M4.5,7.5 L7.5,4.5", stroke: light, "stroke-width": 1.3 }));
    });
    tile("IL", function (p) {                                       // dots
      p.appendChild(el("circle", { cx: 3, cy: 3, r: 1.05, fill: dark }));
    });
    tile("RL");                                                    // demonstration-free: solid, no shading
    tile("RLdemo", function (p) {                                   // demonstration-derived: back hatch
      p.appendChild(el("path", { d: "M0,0 L6,6 M-1.5,4.5 L1.5,7.5 M4.5,-1.5 L7.5,1.5", stroke: dark, "stroke-width": 1.1 }));
    });
    tile("Replay");                                                 // solid, lightest
    host.appendChild(defs);
    document.body.appendChild(host);
  }

  function el(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function render(host, data, uid) {
    var methods = data.methods || [];
    var axes = data.axes || [];
    var comp = data.composite || { max: 100 };
    var metaDefs = data.meta || [];
    var reduce = window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var grown = false;

    // colour identity: TerraZero is the blue accent; a reference/ceiling row is
    // dashed grey; every other method takes the grey of its approach TYPE.
    function colorOf(o) {
      if (o.m.highlight) return BLUE;
      if (o.m.ceiling) return GRAY;
      return TYPE_GREYS[o.m.type] || GRAY;
    }
    // solid fill for bars & legend chips: the hero is solid blue, a reference row
    // is unfilled, and every typed baseline gets its hatch pattern (which already
    // carries the type's grey as its background).
    function fillOf(o) {
      if (o.m.highlight) return BLUE;
      if (o.m.ceiling) return "none";
      return TYPE_GREYS[o.m.type] ? "url(#cmp-pat-" + o.m.type + ")" : GRAY;
    }

    function fmtScore(v) {
      if (v == null) return "";
      return comp.max <= 1 ? v.toFixed(3) : (Math.round(v * 10) / 10).toFixed(1);
    }
    function metaStr(m) {
      if (!metaDefs.length || !m.meta) return "";
      return metaDefs.map(function (d) {
        var v = m.meta[d.key];
        if (v == null) return null;
        if (d.format === "fixed2") v = (typeof v === "number" ? v.toFixed(2) : v);
        return d.label + " " + v;
      }).filter(Boolean).join(" · ");
    }

    // ----- scaffold -------------------------------------------------------
    var views = document.createElement("div");
    views.className = "cmp-views";
    var barsWrap = document.createElement("div");
    barsWrap.className = "cmp-bars";
    var radarWrap = document.createElement("div");
    radarWrap.className = "cmp-radar";
    views.appendChild(barsWrap);
    // composite-only benchmarks (no component axes, e.g. InterPlan) draw just the
    // bar chart, full width — the radar/hex is skipped rather than left empty
    var hasAxes = axes.length > 0;
    if (hasAxes) views.appendChild(radarWrap);
    else views.className += " cmp-views--solo";
    var tip = document.createElement("div");
    tip.className = "chart-tooltip";
    host.appendChild(views);
    host.appendChild(tip);
    if (data.note) {
      var note = document.createElement("p");
      note.className = "chart-note";
      note.textContent = data.note;
      host.appendChild(note);
    }

    // fixed line-up: TerraZero plus the three strongest contending baselines.
    // (Selection was dropped — the charts always show the top contenders.)
    var DISPLAY = (function () {
      var all = methods.map(function (m, i) { return { m: m, i: i }; });
      var hi = all.filter(function (o) { return o.m.highlight; });
      // a ceiling row (e.g. the WOSAC ground-truth upper bound) is always shown
      var ceil = all.filter(function (o) { return o.m.ceiling; });
      var pickable = all.filter(function (o) { return !o.m.highlight && !o.m.ceiling; });
      // an explicit "show" flag curates the line-up (e.g. val14 pairs TerraZero
      // with two stronger and two weaker planners); otherwise fall back to the
      // top 3 competitors alongside TerraZero — one tight, legible line-up shared
      // by the bar chart and (when present) the radar
      var explicit = pickable.filter(function (o) { return o.m.show; });
      var base = explicit.length ? explicit
        : pickable.sort(function (a, b) { return b.m.composite - a.m.composite; }).slice(0, 3);
      return ceil.concat(hi).concat(base);
    })();
    // the ceiling method (if any) bounds the radar axes and draws as a boundary
    var ceilM = (methods.filter(function (m) { return m.ceiling && m.components; })[0]) || null;
    function selectedList() { return DISPLAY; }

    // shared tooltip (bars + radar + legend all describe the same method)
    function tipHTML(m) {
      // just name, type, and composite score
      var tl = m.ceiling ? null : (TYPE_LABEL[m.type] || m.type);
      return "<b>" + m.name + "</b>" + (tl ? " · " + tl : "") +
        "<br>" + comp.label + " " + m.composite;
    }
    function showTip(ev, m) {
      var r = host.getBoundingClientRect();
      tip.style.left = (ev.clientX - r.left) + "px";
      tip.style.top = (ev.clientY - r.top) + "px";
      tip.style.opacity = 1;
      tip.innerHTML = tipHTML(m);
    }
    function hideTip() { tip.style.opacity = 0; }

    // hover emphasis: highlighting a method raises it and dims the others in
    // BOTH charts at once, so the overlapping radar areas stay readable and the
    // bar/radar/legend for one method light up together. radarEls/barEls are
    // rebuilt on every render; keys are original method indices.
    var radarEls = {}, barEls = {};
    function emphasize(idxs) {
      var set = Array.isArray(idxs) ? idxs : [idxs];
      Object.keys(radarEls).forEach(function (k) {
        var e = radarEls[k], on = set.indexOf(+k) >= 0;
        e.items.forEach(function (el) { el.style.opacity = on ? "1" : "0.16"; });
        if (e.main) e.main.setAttribute("stroke-width", on ? (e.hl ? 3 : 2.5) : (e.hl ? 2 : 1.5));
      });
      Object.keys(barEls).forEach(function (k) {
        var on = set.indexOf(+k) >= 0;
        barEls[k].forEach(function (el) { el.style.opacity = on ? "1" : "0.22"; });
      });
    }
    function clearEmph() {
      Object.keys(radarEls).forEach(function (k) {
        var e = radarEls[k];
        e.items.forEach(function (el) { el.style.opacity = "1"; });
        if (e.main) e.main.setAttribute("stroke-width", e.hl ? 2 : 1.5);
      });
      Object.keys(barEls).forEach(function (k) {
        barEls[k].forEach(function (el) { el.style.opacity = "1"; });
      });
    }

    // ----- composite bars -------------------------------------------------
    function drawBars(sel) {
      var rows = sel.slice().sort(function (a, b) { return b.m.composite - a.m.composite; });
      var n = rows.length;
      // composite-only charts run wider and a touch tighter per row so the full
      // field fills the panel instead of a few short bars floating in space
      var solo = !hasAxes;
      // a chart may pin its own viewBox width (e.g. the narrow WOSAC pair panels,
      // which would otherwise scale down to illegible text in their columns)
      var BW = data.barWidth || (solo ? 900 : 640);
      var rowH = data.rowH || (solo ? 34 : 40), mt = 10, mb = 8;
      var BH = mt + mb + n * rowH;
      // label column widens to fit the longest name (LLM-planner names are long)
      var longest = Math.max.apply(null, rows.map(function (o) { return o.m.name.length; }));
      var nameRight = Math.min(300, Math.max(120, longest * 7.2 + 6));
      var trackX0 = nameRight + 12, trackX1 = BW - 54;
      var trackLen = trackX1 - trackX0;
      barEls = {};

      var svg = el("svg", {
        viewBox: "0 0 " + BW + " " + BH, width: "100%", role: "img",
        "font-family": "'Applied Sans Text',sans-serif",
        "aria-label": comp.label + " by method"
      });

      rows.forEach(function (o, ri) {
        var yMid = mt + ri * rowH + rowH / 2;
        var v = o.m.composite;
        var len = Math.max(2, trackLen * Math.max(0, v) / comp.max);
        var hl = !!o.m.highlight;
        var ceiling = !!o.m.ceiling;
        var col = colorOf(o);

        // the work's title mirrors its legend styling: the reference row is
        // italic, and every method (TerraZero included, as an RL method) takes
        // its type's style — TerraZero just keeps the blue fill on top
        var nm = el("text", {
          x: nameRight, y: yMid + 5, "text-anchor": "end", "font-size": 15,
          "font-weight": 500, fill: hl ? BLUE : ceiling ? GRAY : INK
        });
        if (ceiling) {
          nm.setAttribute("font-style", "italic");
        } else {
          var st = TYPE_STYLE[o.m.type] || {};
          for (var sk in st) nm.setAttribute(sk, st[sk]);
        }
        nm.textContent = o.m.name;
        nm.style.transition = "opacity .15s ease";
        svg.appendChild(nm);

        // the ceiling row draws as a blank bordered bar (no fill) to read as an
        // upper-bound reference rather than a competing method
        var rect = el("rect", {
          x: trackX0, y: yMid - 9, width: len, height: 18, rx: 3,
          "class": "cmp-bar", fill: fillOf(o),
          stroke: ceiling ? GRAY : "none",
          "stroke-width": ceiling ? 1.5 : 0,
          "stroke-dasharray": ceiling ? "4 3" : "none"
        });
        rect.style.transformBox = "fill-box";
        rect.style.transformOrigin = "left";
        rect.style.transition = "transform .8s cubic-bezier(.2,.7,.2,1), opacity .15s ease";
        // stagger delay is for the one-time grow-in only; if we're already grown
        // (reduced-motion or re-render) omit it so hover fades stay instant
        rect.style.transitionDelay = (grown || reduce) ? "0s" : (ri * 0.05) + "s";
        rect.style.transform = (grown || reduce) ? "scaleX(1)" : "scaleX(0)";
        svg.appendChild(rect);

        var vt = el("text", {
          x: trackX0 + len + 8, y: yMid + 5, "text-anchor": "start",
          "font-size": 15, "font-weight": hl ? 700 : 600, fill: hl ? BLUE : ceiling ? GRAY : INK,
          "class": "cmp-val"
        });
        vt.style.transition = "opacity .5s ease";
        vt.style.transitionDelay = (grown || reduce) ? "0s" : (ri * 0.05 + 0.3) + "s";
        vt.style.opacity = (grown || reduce) ? "1" : "0";
        vt.textContent = fmtScore(v);
        svg.appendChild(vt);

        // transparent full-row hit area: hovering anywhere on the row — the
        // name, the bar, or the value — highlights the method in both charts
        var hit = el("rect", { x: 0, y: mt + ri * rowH, width: BW, height: rowH, fill: "transparent" });
        hit.style.cursor = "pointer";
        hit.addEventListener("mousemove", function (ev) { emphasize(o.i); showTip(ev, o.m); });
        svg.appendChild(hit);

        barEls[o.i] = [rect, nm, vt];
      });

      // clear on leaving the whole chart, not each row: moving fast between rows
      // must not let one row's mouseleave wipe the emphasis the next row just set
      svg.addEventListener("mouseleave", function () { clearEmph(); hideTip(); });

      barsWrap.innerHTML = "";
      barsWrap.appendChild(svg);
    }

    // ----- radar / hex ----------------------------------------------------
    function drawRadar(sel) {
      var N = axes.length;
      var RW = 430, RH = 350;
      var cx = RW / 2, cy = RH / 2 - 2;
      var R = Math.min(RW, RH) / 2 - 64;
      var svg = el("svg", {
        viewBox: "0 0 " + RW + " " + RH, width: "100%", role: "img",
        "font-family": "'Applied Sans Text',sans-serif",
        "aria-label": "Component metrics by method"
      });

      function pt(ai, radius) {
        var ang = -Math.PI / 2 + ai * 2 * Math.PI / N;
        return [cx + radius * Math.cos(ang), cy + radius * Math.sin(ang)];
      }
      function poly(radii) {
        return radii.map(function (r, ai) { var p = pt(ai, r); return p[0] + "," + p[1]; }).join(" ");
      }

      // concentric rings (static — drawn outside the grow group). When a ceiling
      // method bounds the axes, the OUTER ring is that ground-truth ceiling, so we
      // draw it dashed/grey to read as an upper bound rather than a plain gridline.
      var rings = 4;
      for (var rr = 1; rr <= rings; rr++) {
        var radii = [];
        for (var a = 0; a < N; a++) radii.push(R * rr / rings);
        var outer = ceilM && rr === rings;
        svg.appendChild(el("polygon", {
          points: poly(radii), fill: "none",
          stroke: outer ? GRAY : LINE,
          "stroke-width": outer ? 1.5 : 1,
          "stroke-dasharray": outer ? "4 3" : "none"
        }));
      }
      // spokes + axis labels
      axes.forEach(function (ax, ai) {
        var v = pt(ai, R);
        svg.appendChild(el("line", { x1: cx, y1: cy, x2: v[0], y2: v[1], stroke: LINE }));
        var lp = pt(ai, R + 15);
        var c = (lp[0] - cx) / (R + 15);
        var anchor = c > 0.25 ? "start" : c < -0.25 ? "end" : "middle";
        var t = el("text", {
          x: lp[0], y: lp[1] + 4, "text-anchor": anchor, "class": "cmp-axis-label",
          "font-size": 11, fill: GRAY
        });
        t.textContent = ax.label;
        svg.appendChild(t);
      });

      // ABSOLUTE 0-based scaling: every axis runs from 0 at the centre to its
      // maximum at the outer ring. That maximum is the ground-truth ceiling
      // per-axis when a ceiling method is present (so the ring is the achievable
      // upper bound), otherwise the metric maximum comp.max.
      var axisMax = axes.map(function (ax) {
        var m = ceilM && ceilM.components ? ceilM.components[ax.key] : null;
        return (m != null && m > 0) ? m : comp.max;
      });
      function factor(ai, v) {
        var mx = axisMax[ai];
        return Math.max(0, Math.min(1, mx > 0 ? v / mx : 0));
      }

      var g = el("g", { "class": "cmp-shapes" });
      g.style.transformOrigin = cx + "px " + cy + "px";
      g.style.transition = "transform .8s cubic-bezier(.2,.7,.2,1)";
      g.style.transform = (grown || reduce) ? "scale(1)" : "scale(0)";

      // baselines first, TerraZero last (on top). Only methods that carry a
      // component breakdown are plotted — some benchmarks (e.g. InterPlan) publish
      // per-metric sub-scores for TerraZero only, so competitors appear in the bar
      // chart and legend but have no radar polygon.
      radarEls = {};
      var ordered = sel.filter(function (o) { return o.m.components && !o.m.ceiling; })
        .sort(function (a, b) {
          return (a.m.highlight ? 1 : 0) - (b.m.highlight ? 1 : 0);
        });
      ordered.forEach(function (o) {
        var radii = axes.map(function (ax, ai) { return R * factor(ai, o.m.components[ax.key]); });
        var pts = poly(radii), items = [], main;
        var col = colorOf(o), hl = !!o.m.highlight;
        main = el("polygon", {
          points: pts, fill: hl ? BLUE_FILL : "none", stroke: col,
          "stroke-width": hl ? 2 : 2, "stroke-linejoin": "round"
        });
        main.style.pointerEvents = "none";
        g.appendChild(main); items.push(main);
        radii.forEach(function (r, ai) {
          var p = pt(ai, r);
          var dot = el("circle", { cx: p[0], cy: p[1], r: hl ? 2.6 : 2.1, fill: col });
          dot.style.pointerEvents = "none";
          g.appendChild(dot); items.push(dot);
        });
        items.forEach(function (el) { el.style.transition = "opacity .15s ease"; });
        radarEls[o.i] = { items: items, main: main, hl: hl };
      });
      // transparent fat-stroke hit outlines, on top: hovering near a method's
      // edge identifies it without the filled interior occluding the others
      ordered.forEach(function (o) {
        var radii = axes.map(function (ax, ai) { return R * factor(ai, o.m.components[ax.key]); });
        var hit = el("polygon", { points: poly(radii), fill: "none", stroke: "transparent", "stroke-width": 16 });
        hit.style.pointerEvents = "stroke";
        hit.style.cursor = "pointer";
        hit.addEventListener("mousemove", function (ev) { emphasize(o.i); showTip(ev, o.m); });
        g.appendChild(hit);
      });
      svg.appendChild(g);
      // clear on leaving the whole radar, not each polygon (see drawBars)
      svg.addEventListener("mouseleave", function () { clearEmph(); hideTip(); });
      radarWrap.innerHTML = "";
      radarWrap.appendChild(svg);
    }

    // swatch: a filled chip, or a hollow dashed box for a reference/ceiling row
    function makeSwatch(color, ceiling) {
      var sw = el("svg", { "class": "swatch", viewBox: "0 0 14 14" });
      sw.appendChild(el("rect", ceiling ? {
        x: 1.5, y: 1.5, width: 11, height: 11, rx: 3, fill: "none",
        stroke: GRAY, "stroke-width": 1.5, "stroke-dasharray": "3 2"
      } : {
        x: 1, y: 1, width: 12, height: 12, rx: 3, fill: color
      }));
      return sw;
    }
    // a hover-wired legend key: `idxs` are the method indices it lights up; `cls`
    // sets the title styling (hero / type / reference — see .key-* in the CSS)
    function legendKey(label, color, idxs, tipStr, cls, ceiling, labelStyle) {
      var key = document.createElement("span");
      key.className = "key on" + (cls ? " " + cls : "");
      key.style.cursor = "pointer";
      key.appendChild(makeSwatch(color, ceiling));
      var t = document.createElement("span");
      t.className = "key-label";
      t.textContent = label;
      if (labelStyle) for (var s in labelStyle) t.style.setProperty(s, labelStyle[s]);
      key.appendChild(t);
      key.addEventListener("mousemove", function (ev) {
        emphasize(idxs);
        var r = host.getBoundingClientRect();
        tip.style.left = (ev.clientX - r.left) + "px";
        tip.style.top = (ev.clientY - r.top) + "px";
        tip.style.opacity = 1;
        tip.innerHTML = tipStr;
      });
      return key;
    }

    // one shared legend keyed by APPROACH TYPE: the TerraZero accent first, then
    // one grey key per baseline family present, then any reference row. The type
    // titles are styled distinctly (see .key-type) because same-type methods
    // share a shade — the title, not the colour, tells them apart.
    // a chart may suppress its own legend (e.g. the WOSAC pair shares one merged
    // legend authored in the page) — see data.hideLegend
    var legendWrap = null;
    if (!data.hideLegend) {
      legendWrap = document.createElement("div");
      legendWrap.className = "chart-legend cmp-legend";
      legendWrap.addEventListener("mouseleave", function () { clearEmph(); hideTip(); });
      host.insertBefore(legendWrap, tip);
    }
    function drawLegend(sel) {
      if (!legendWrap) return;
      legendWrap.innerHTML = "";
      sel.filter(function (o) { return o.m.highlight; }).forEach(function (o) {
        var hs = { color: BLUE }, hst = TYPE_STYLE[o.m.type] || {};
        for (var hk in hst) hs[hk] = hst[hk];
        legendWrap.appendChild(legendKey(o.m.name, BLUE, [o.i], tipHTML(o.m), "key-hero", false, hs));
      });
      // types include TerraZero's own family (RL) so that category is always
      // present even when no baseline shares it (e.g. InterPlan has no RL baseline)
      var types = [];
      sel.forEach(function (o) {
        if (o.m.ceiling) return;
        var t = o.m.type || "Other";
        if (types.indexOf(t) < 0) types.push(t);
      });
      types.forEach(function (t) {
        var members = sel.filter(function (o) {
          return !o.m.ceiling && (o.m.type || "Other") === t;
        });
        var ls = { color: INK }, st = TYPE_STYLE[t] || {};
        for (var kk in st) ls[kk] = st[kk];
        legendWrap.appendChild(legendKey(
          TYPE_LABEL[t] || t, TYPE_GREYS[t] ? "url(#cmp-pat-" + t + ")" : GRAY,
          members.map(function (o) { return o.i; }),
          "<b>" + (TYPE_LABEL[t] || t) + "</b><br>" + members.map(function (o) { return o.m.name; }).join(", "),
          "key-type", false, ls));
      });
      sel.filter(function (o) { return o.m.ceiling; }).forEach(function (o) {
        legendWrap.appendChild(legendKey(o.m.name, GRAY, [o.i], tipHTML(o.m), "key-ref", true,
          { "font-style": "italic", color: GRAY }));
      });
    }

    function draw() {
      var sel = selectedList();
      drawBars(sel);
      if (hasAxes) drawRadar(sel);
      drawLegend(sel);
    }

    draw();

    // if this chart shares an external legend, register a by-type emphasiser so
    // a merged legend key lights up the matching bars here (empty match = leave
    // this chart untouched rather than dimming a family it doesn't contain)
    if (data.legendGroup) {
      (LEGEND_GROUPS[data.legendGroup] = LEGEND_GROUPS[data.legendGroup] || []).push({
        emph: function (kind) {
          var idxs = DISPLAY.filter(function (o) {
            if (kind === "__hero__") return o.m.highlight;
            if (kind === "__ref__") return o.m.ceiling;
            return !o.m.ceiling && (o.m.type || "Other") === kind;
          }).map(function (o) { return o.i; });
          // always emphasise — a panel with no member of this category dims all
          // its bars (rather than staying lit, which looked like a broken hover)
          emphasize(idxs);
        },
        clear: clearEmph
      });
    }

    // grow bars + radar the first time the explorer scrolls into view
    function reveal() {
      if (grown) return;
      grown = true;
      var i, bars = host.querySelectorAll(".cmp-bar");
      for (i = 0; i < bars.length; i++) bars[i].style.transform = "scaleX(1)";
      var vals = host.querySelectorAll(".cmp-val");
      for (i = 0; i < vals.length; i++) vals[i].style.opacity = "1";
      var shapes = host.querySelectorAll(".cmp-shapes");
      for (i = 0; i < shapes.length; i++) shapes[i].style.transform = "scale(1)";
      // once the staggered grow-in has played out, drop the per-row delays and
      // give the value numbers the same quick fade as everything else, so hover
      // emphasis clears uniformly on mouse-off instead of replaying as a flash
      setTimeout(function () {
        var j;
        for (j = 0; j < bars.length; j++) bars[j].style.transitionDelay = "0s";
        for (j = 0; j < vals.length; j++) {
          vals[j].style.transition = "opacity .15s ease";
          vals[j].style.transitionDelay = "0s";
        }
      }, 1300);
    }
    if (reduce) {
      grown = true;
    } else if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) { reveal(); io.disconnect(); } });
      }, { threshold: 0.2 });
      io.observe(host);
    } else {
      reveal();
    }
  }

  // reveal the host's <noscript> static table when the data can't be loaded
  function fallback(host) {
    var ns = host.querySelector("noscript");
    if (ns) host.innerHTML = ns.textContent;
  }

  function init() {
    ensurePatterns();
    wireSharedLegends();
    var hosts = Array.prototype.slice.call(document.querySelectorAll(".cmp[data-src]"));
    hosts.forEach(function (host, idx) {
      var src = host.getAttribute("data-src");
      fetch(src).then(function (r) {
        if (!r.ok) throw new Error("http " + r.status);
        return r.json();
      }).then(function (data) {
        render(host, data, idx);
      }).catch(function () {
        fallback(host);
      });
    });
  }

  window.TZcompare = { init: init };
})();
