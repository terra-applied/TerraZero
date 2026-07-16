/* Throughput chart: a linear-scale grouped bar chart built from throughput.json.
   Bars are grouped by hardware tier, one bar per simulator. Bars grow from the
   baseline when the chart first scrolls into view. Hover shows an exact-value
   tooltip; legend entries toggle systems. Falls back to the static SVG if the
   JSON cannot be loaded. Exposed as window.TZcharts.init(). */
(function () {
  "use strict";

  var SVGNS = "http://www.w3.org/2000/svg";
  var BLUE = "#006CFA";
  var GRAY = "#767676";
  var LINE = "#e4e4e4";
  var INK = "#1f2937";
  // grey bars are told apart by hatch pattern, not shade
  var HATCH_FG = "#5b6573";
  var HATCH_BG = "#eceef1";
  var HATCH_STROKE = "#b9bfc8";
  var HATCHES = ["diag", "cross", "dots", "vert", "back"];

  function el(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  // a seamless tileable hatch <pattern> in grey, one visual style per `kind`
  function makePattern(id, kind) {
    var s = kind === "dots" ? 8 : 7;
    var p = el("pattern", { id: id, patternUnits: "userSpaceOnUse", width: s, height: s });
    p.appendChild(el("rect", { x: 0, y: 0, width: s, height: s, fill: HATCH_BG }));
    function ln(x1, y1, x2, y2) {
      return el("line", { x1: x1, y1: y1, x2: x2, y2: y2, stroke: HATCH_FG,
        "stroke-width": 1.4, "stroke-linecap": "square" });
    }
    if (kind === "diag" || kind === "cross") p.appendChild(ln(0, s, s, 0));
    if (kind === "back" || kind === "cross") p.appendChild(ln(0, 0, s, s));
    if (kind === "vert") p.appendChild(ln(s / 2, 0, s / 2, s));
    if (kind === "horiz") p.appendChild(ln(0, s / 2, s, s / 2));
    if (kind === "dots") p.appendChild(el("circle", { cx: s / 2, cy: s / 2, r: 1.5, fill: HATCH_FG }));
    return p;
  }
  function hatchOf(i) { return HATCHES[i % HATCHES.length]; }

  function fmt(v) {
    if (v == null) return "";
    if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (v >= 1e3) return Math.round(v / 1e3) + "K";
    return String(v);
  }

  function render(host, data) {
    var W = 920, H = 470;
    var ml = 66, mr = 22, mt = 34, mb = 82;
    var pw = W - ml - mr, ph = H - mt - mb;
    var tiers = data.tiers, systems = data.systems;
    var hidden = {};
    var grown = false;
    var reduce = window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Linear scale: axis top is the data max rounded up to a clean 0.5M step.
    var step = 5e5, maxV = 0;
    systems.forEach(function (s) {
      tiers.forEach(function (t) {
        var v = s.values[t.key];
        if (v && v > maxV) maxV = v;
      });
    });
    var vmax = Math.max(step, Math.ceil(maxV / step) * step);

    function yOf(v) {
      return mt + ph * (1 - Math.max(0, v) / vmax);
    }

    var tip = document.createElement("div");
    tip.className = "chart-tooltip";
    host.appendChild(tip);

    var svg = el("svg", {
      viewBox: "0 0 " + W + " " + H, width: "100%",
      "font-family": "'Applied Sans Text',sans-serif", role: "img",
      "aria-label": "Throughput comparison, agent steps per second by hardware tier"
    });

    function draw() {
      while (svg.firstChild) svg.removeChild(svg.firstChild);

      // hatch pattern per non-highlight system (re-added since svg is cleared)
      var defs = el("defs", {});
      systems.forEach(function (s, i) {
        if (!s.highlight) defs.appendChild(makePattern("tzpat-" + i, hatchOf(i)));
      });
      svg.appendChild(defs);

      // gridlines + linear labels at every 0.5M step
      for (var gv = 0; gv <= vmax + 1; gv += step) {
        var y = yOf(gv);
        svg.appendChild(el("line", { x1: ml, y1: y, x2: W - mr, y2: y, stroke: LINE }));
        var t = el("text", { x: ml - 10, y: y + 5, "text-anchor": "end", "font-size": 16, fill: GRAY });
        t.textContent = gv === 0 ? "0" : fmt(gv);
        svg.appendChild(t);
      }

      var baseY = mt + ph;
      var nTiers = tiers.length;
      var groupW = pw / nTiers;
      var visible = systems.filter(function (s, i) { return !hidden[i]; });

      tiers.forEach(function (tier, ti) {
        var gcx = ml + ti * groupW + groupW / 2;
        var lbl = el("text", { x: gcx, y: H - mb + 30, "text-anchor": "middle", "font-size": 19, "font-weight": 700, fill: INK });
        lbl.textContent = tier.label;
        svg.appendChild(lbl);

        var bars = systems.map(function (s, i) { return { s: s, i: i }; })
          .filter(function (o) { return !hidden[o.i] && o.s.values[tier.key]; });
        var barW = Math.min(48, (groupW - 26) / Math.max(1, bars.length));
        var clusterW = barW * bars.length;
        var start = gcx - clusterW / 2;

        bars.forEach(function (o, bi) {
          var v = o.s.values[tier.key];
          var x = start + bi * barW, y = yOf(v);
          var hl = !!o.s.highlight;
          var delay = (ti * 0.08 + bi * 0.05);
          var rectAttrs = {
            x: x, y: y, width: Math.max(4, barW - 4), height: Math.max(0, baseY - y),
            rx: 2, "class": "tz-bar"
          };
          if (hl) {
            rectAttrs.fill = BLUE;
          } else {
            rectAttrs.fill = "url(#tzpat-" + o.i + ")";
            rectAttrs.stroke = HATCH_STROKE;
            rectAttrs["stroke-width"] = 1;
          }
          var rect = el("rect", rectAttrs);
          rect.style.cursor = "pointer";
          // grow from the baseline; full height immediately once already grown
          rect.style.transformBox = "fill-box";
          rect.style.transformOrigin = "bottom";
          rect.style.transition = "transform .8s cubic-bezier(.2,.7,.2,1)";
          rect.style.transitionDelay = delay + "s";
          rect.style.transform = (grown || reduce) ? "scaleY(1)" : "scaleY(0)";
          var dag = (o.s.dagger && o.s.dagger[tier.key]) ? " †" : "";

          // tooltip: name + tier only (the exact figure already sits atop the bar)
          function showTip(ev) {
            var r = host.getBoundingClientRect();
            tip.style.left = (ev.clientX - r.left) + "px";
            tip.style.top = (ev.clientY - r.top) + "px";
            tip.style.opacity = 1;
            tip.innerHTML = "<b>" + o.s.name + "</b> · " + tier.label + dag;
          }
          function hideTip() { tip.style.opacity = 0; }
          rect.addEventListener("mousemove", showTip);
          rect.addEventListener("mouseleave", hideTip);
          svg.appendChild(rect);

          var vt = el("text", {
            x: x + (barW - 4) / 2, y: y - 7, "text-anchor": "middle",
            "font-size": 15, "font-weight": hl ? 700 : 400, fill: hl ? BLUE : INK,
            "class": "tz-val"
          });
          vt.style.transition = "opacity .5s ease";
          vt.style.transitionDelay = (delay + 0.3) + "s";
          vt.style.opacity = (grown || reduce) ? "1" : "0";
          vt.style.cursor = "pointer";
          vt.textContent = fmt(v) + dag;
          // hovering the value label shows the same tooltip as the bar
          vt.addEventListener("mousemove", showTip);
          vt.addEventListener("mouseleave", hideTip);
          svg.appendChild(vt);
        });
      });

      svg.appendChild(el("line", { x1: ml, y1: baseY, x2: W - mr, y2: baseY, stroke: INK, "stroke-width": 1.5 }));
      var yl = el("text", {
        x: 16, y: mt + ph / 2, "font-size": 15, fill: GRAY,
        transform: "rotate(-90 16 " + (mt + ph / 2) + ")", "text-anchor": "middle"
      });
      yl.textContent = "agent steps / sec";
      svg.appendChild(yl);
    }

    draw();
    host.appendChild(svg);

    // grow the bars from the baseline the first time the chart scrolls into view
    function reveal() {
      if (grown) return;
      grown = true;
      var i, bars = svg.querySelectorAll(".tz-bar");
      for (i = 0; i < bars.length; i++) bars[i].style.transform = "scaleY(1)";
      var vals = svg.querySelectorAll(".tz-val");
      for (i = 0; i < vals.length; i++) vals[i].style.opacity = "1";
    }
    if (reduce) {
      grown = true;
    } else if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { reveal(); io.disconnect(); }
        });
      }, { threshold: 0.25 });
      io.observe(host);
    } else {
      reveal();
    }

    // legend with toggles
    var legend = document.createElement("div");
    legend.className = "chart-legend";
    systems.forEach(function (s, i) {
      var key = document.createElement("span");
      key.className = "key on";
      // swatch mirrors the bar: solid blue for the highlight, hatch otherwise
      var sw = el("svg", { "class": "swatch", viewBox: "0 0 14 14" });
      if (s.highlight) {
        sw.appendChild(el("rect", { x: 0, y: 0, width: 14, height: 14, rx: 2, fill: BLUE }));
      } else {
        var pid = "tzpat-leg-" + i;
        var d = el("defs", {});
        d.appendChild(makePattern(pid, hatchOf(i)));
        sw.appendChild(d);
        sw.appendChild(el("rect", { x: 0.5, y: 0.5, width: 13, height: 13, rx: 2,
          fill: "url(#" + pid + ")", stroke: HATCH_STROKE }));
      }
      key.appendChild(sw);
      key.appendChild(document.createTextNode(s.name));
      key.addEventListener("click", function () {
        hidden[i] = !hidden[i];
        key.classList.toggle("on", !hidden[i]);
        draw();
      });
      legend.appendChild(key);
    });
    host.appendChild(legend);

    // dagger key, shown next to where the symbol appears (only if any value uses it)
    var hasDagger = systems.some(function (s) {
      return s.dagger && tiers.some(function (t) { return s.dagger[t.key]; });
    });
    if (hasDagger) {
      var note = document.createElement("p");
      note.className = "chart-note";
      note.textContent = "† Reported by the original authors; other values are benchmarked under the TerraZero setup.";
      host.appendChild(note);
    }
  }

  function fallback(host) {
    var src = host.getAttribute("data-fallback");
    if (src) host.innerHTML = '<img src="' + src + '" alt="Throughput comparison chart">';
  }

  function init() {
    var host = document.getElementById("throughput-chart");
    if (!host) return;
    var src = host.getAttribute("data-src");
    fetch(src).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    }).then(function (data) {
      render(host, data);
    }).catch(function () {
      fallback(host);
    });
  }

  window.TZcharts = { init: init };
})();
