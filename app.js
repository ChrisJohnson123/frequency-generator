(() => {
  const MIN_HZ = 1;
  const MAX_HZ = 20000;
  const MAX_BEAT = 40;
  const FADE = 0.05;
  const STORAGE_KEY = "freq-gen-v1";
  const AM_FLOOR = 0.03;

  const COMMON = [
    { label: "A 440", hz: 440 },
    { label: "432", hz: 432 },
    { label: "528", hz: 528 },
    { label: "1 kHz", hz: 1000 },
    { label: "50 Hz", hz: 50 },
    { label: "60 Hz", hz: 60 }
  ];
  const SOLFEGGIO = [174, 285, 396, 417, 639, 741, 852, 963].map((hz) => ({
    label: String(hz),
    hz
  }));
  const BEATS = [
    { label: "4 Hz θ", hz: 4 },
    { label: "6 Hz", hz: 6 },
    { label: "8 Hz", hz: 8 },
    { label: "10 Hz α", hz: 10 },
    { label: "14 Hz", hz: 14 },
    { label: "20 Hz β", hz: 20 },
    { label: "40 Hz γ", hz: 40 }
  ];
  const TIMERS = [
    { label: "Off", min: 0 },
    { label: "5 min", min: 5 },
    { label: "10 min", min: 10 },
    { label: "15 min", min: 15 },
    { label: "30 min", min: 30 },
    { label: "60 min", min: 60 }
  ];
  const OBE_BUILDS = [
    { label: "5 min", min: 5 },
    { label: "10 min", min: 10 },
    { label: "15 min", min: 15 },
    { label: "20 min", min: 20 },
    { label: "30 min", min: 30 }
  ];

  const $ = (id) => document.getElementById(id);
  const playBtn = $("play");
  const playIcon = $("playIcon");
  const hzDisplay = $("hzDisplay");
  const hzUnit = $("hzUnit");
  const stereoHint = $("stereoHint");
  const statusEl = $("status");
  const freqSlider = $("freqSlider");
  const freqInput = $("freqInput");
  const volSlider = $("volSlider");
  const volLabel = $("volLabel");
  const baseInput = $("baseInput");
  const beatInput = $("beatInput");
  const binauralToggle = $("binauralToggle");
  const sweepStart = $("sweepStart");
  const sweepEnd = $("sweepEnd");
  const sweepDur = $("sweepDur");
  const sweepBtn = $("sweepBtn");
  const timerLeft = $("timerLeft");
  const timerCustom = $("timerCustom");
  const viz = $("viz");
  const unlockEl = $("unlock");
  const obeCarrier = $("obeCarrier");
  const obeBuild = $("obeBuild");
  const obeStartPulse = $("obeStartPulse");
  const obeEndPulse = $("obeEndPulse");
  const obeQuiet = $("obeQuiet");
  const obeBlend = $("obeBlend");
  const obeBeat = $("obeBeat");
  const obeBinauralToggle = $("obeBinauralToggle");
  const obePhaseEl = $("obePhase");
  const obePulseEl = $("obePulse");
  const obePulseUnit = $("obePulseUnit");
  const obeBar = $("obeBar");
  const obeBarFill = $("obeBarFill");
  const obeTimeEl = $("obeTime");

  const logMin = Math.log10(MIN_HZ);
  const logMax = Math.log10(MAX_HZ);
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const sliderToFreq = (t) => Math.pow(10, logMin + (t / 1000) * (logMax - logMin));
  const freqToSlider = (f) => ((Math.log10(clamp(f, MIN_HZ, MAX_HZ)) - logMin) / (logMax - logMin)) * 1000;

  function formatHz(f, { decimals } = {}) {
    const n = Number(f);
    if (!Number.isFinite(n)) return "—";
    if (decimals != null) return n.toFixed(decimals);
    const rounded = Math.round(n * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  }

  function parseHz(value, min, max, fallback) {
    const n = parseFloat(value);
    if (!Number.isFinite(n)) return fallback;
    return clamp(Math.round(n * 10) / 10, min, max);
  }

  function formatTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    const m = Math.floor(s / 60);
    const r = String(s % 60).padStart(2, "0");
    return `${m}:${r}`;
  }

  const saved = (() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
    catch { return {}; }
  })();

  const savedObe = saved.obe && typeof saved.obe === "object" ? saved.obe : {};

  const state = {
    mode: saved.mode === "obe" ? "obe" : "tone",
    hz: parseHz(saved.hz, MIN_HZ, MAX_HZ, 440),
    vol: clamp(saved.vol ?? 0.3, 0, 1),
    wave: ["sine", "square", "triangle", "sawtooth"].includes(saved.wave) ? saved.wave : "sine",
    binaural: !!saved.binaural,
    beat: parseHz(saved.beat, 0.1, MAX_BEAT, 10),
    sweepStart: parseHz(saved.sweepStart, MIN_HZ, MAX_HZ, 100),
    sweepEnd: parseHz(saved.sweepEnd, MIN_HZ, MAX_HZ, 1000),
    sweepDur: clamp(saved.sweepDur ?? 10, 0.5, 120),
    playing: false,
    obe: {
      carrier: parseHz(savedObe.carrier, MIN_HZ, MAX_HZ, 100),
      startPulse: parseHz(savedObe.startPulse, 0.5, 20, 2),
      endPulse: parseHz(savedObe.endPulse, 2, 60, 40),
      buildMin: clamp(savedObe.buildMin ?? 15, 0.05, 60),
      quietMin: clamp(savedObe.quietMin ?? 0, 0, 10),
      quietMode: savedObe.quietMode === "tone" ? "tone" : "silence",
      blendSec: clamp(savedObe.blendSec ?? 60, 3, 180),
      binaural: !!savedObe.binaural,
      beat: parseHz(savedObe.beat, 0.1, MAX_BEAT, 6)
    }
  };

  let ctx = null;
  let master = null;
  let analyser = null;
  let oscL = null;
  let oscR = null;
  let panL = null;
  let panR = null;
  let lfo = null;
  let lfoScale = null;
  let amOffset = null;
  let amGain = null;
  let wakeLock = null;
  let sweepAnim = null;
  let obeSess = null;
  let timerUntil = 0;
  let timerId = 0;
  let timerMinutes = 0;
  let raf = 0;

  function currentHz() {
    return state.mode === "obe" ? state.obe.carrier : state.hz;
  }

  function currentBinaural() {
    return state.mode === "obe" ? state.obe.binaural : state.binaural;
  }

  function currentBeat() {
    return state.mode === "obe" ? state.obe.beat : state.beat;
  }

  function rightHz() {
    return clamp(currentHz() + currentBeat(), MIN_HZ, MAX_HZ);
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      mode: state.mode,
      hz: state.hz,
      vol: state.vol,
      wave: state.wave,
      binaural: state.binaural,
      beat: state.beat,
      sweepStart: state.sweepStart,
      sweepEnd: state.sweepEnd,
      sweepDur: state.sweepDur,
      obe: state.obe
    }));
  }

  function fillTrack(el) {
    const min = Number(el.min);
    const max = Number(el.max);
    const pct = ((Number(el.value) - min) / (max - min)) * 100;
    el.style.setProperty("--fill", pct + "%");
  }

  function updateReadout() {
    const hz = currentHz();
    hzDisplay.textContent = formatHz(hz);
    hzUnit.textContent = "Hz";
    freqInput.value = formatHz(hz);
    if (baseInput) baseInput.value = formatHz(state.hz);
    if (obeCarrier) obeCarrier.value = formatHz(state.obe.carrier);
    freqSlider.value = String(Math.round(freqToSlider(hz)));
    fillTrack(freqSlider);
    if (currentBinaural()) {
      const r = rightHz();
      const actualBeat = Math.round((r - hz) * 10) / 10;
      stereoHint.innerHTML = `L <strong>${formatHz(hz)} Hz</strong> · R <strong>${formatHz(r)} Hz</strong> · beat ${formatHz(actualBeat)} Hz`;
    } else if (state.mode === "obe") {
      stereoHint.textContent = "Carrier · headphones recommended";
    } else {
      stereoHint.textContent = "";
    }
    document.querySelectorAll("[data-preset]").forEach((btn) => {
      const p = Number(btn.dataset.preset);
      btn.setAttribute("aria-pressed", String(state.mode === "tone" && !state.binaural && Math.abs(p - state.hz) < 0.05));
    });
    document.querySelectorAll("#beatPresets .chip").forEach((btn) => {
      btn.setAttribute("aria-pressed", String(state.binaural && Math.abs(Number(btn.dataset.beat) - state.beat) < 0.05));
    });
    document.querySelectorAll("#obeBuildChips .chip").forEach((btn) => {
      btn.setAttribute("aria-pressed", String(Math.abs(Number(btn.dataset.build) - state.obe.buildMin) < 0.01));
    });
  }

  function obeStatusLabel() {
    const snap = obeSnapshot();
    if (!snap) return "Stopped";
    return ({
      quiet: "Quiet start",
      build: "Building",
      blend: "Blending",
      hold: "Solid tone"
    })[snap.phase] || "Playing";
  }

  function setStatus() {
    if (sweepAnim) {
      statusEl.textContent = "Sweeping";
      statusEl.classList.add("is-on");
    } else if (state.playing && state.mode === "obe") {
      statusEl.textContent = obeStatusLabel();
      statusEl.classList.add("is-on");
    } else if (state.playing) {
      statusEl.textContent = "Playing";
      statusEl.classList.add("is-on");
    } else {
      statusEl.textContent = "Stopped";
      statusEl.classList.remove("is-on");
    }
    playBtn.setAttribute("aria-pressed", String(state.playing));
    playBtn.setAttribute("aria-label", state.playing ? "Stop" : "Play");
    if (state.playing) {
      playIcon.innerHTML = '<rect x="6" y="6" width="5" height="12" rx="1"/><rect x="13" y="6" width="5" height="12" rx="1"/>';
    } else {
      playIcon.innerHTML = '<path d="M8 5.5v13l12-6.5-12-6.5z"/>';
    }
  }

  function setSliderTicks() {
    const labels = [
      { f: 1, t: "1" },
      { f: 20, t: "20" },
      { f: 200, t: "200" },
      { f: 2000, t: "2k" },
      { f: 20000, t: "20k" }
    ];
    $("ticks").innerHTML = labels.map(({ f, t }, i) => {
      const pct = (Math.log10(f) - logMin) / (logMax - logMin) * 100;
      if (i === 0) return `<span style="left:0;transform:none">${t}</span>`;
      if (i === labels.length - 1) return `<span style="left:auto;right:0;transform:none">${t}</span>`;
      return `<span style="left:${pct}%">${t}</span>`;
    }).join("");
  }

  function chips(el, items, attr, onClick) {
    el.innerHTML = "";
    items.forEach((item) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      btn.textContent = item.label;
      if (attr === "preset") btn.dataset.preset = String(item.hz);
      if (attr === "beat") btn.dataset.beat = String(item.hz);
      if (attr === "timer") btn.dataset.timer = String(item.min);
      if (attr === "build") btn.dataset.build = String(item.min);
      btn.addEventListener("click", () => onClick(item, btn));
      el.appendChild(btn);
    });
  }

  function fadeTo(value, seconds) {
    if (!master || !ctx) return;
    const now = ctx.currentTime;
    const current = master.gain.value;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(current, now);
    master.gain.linearRampToValueAtTime(value, now + seconds);
  }

  async function unlockAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error("Web Audio is not supported in this browser.");
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0;
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.7;
      master.connect(analyser);
      analyser.connect(ctx.destination);
    }
    if (ctx.state === "suspended" || ctx.state === "interrupted") {
      await ctx.resume();
    }
    if (unlockEl) {
      unlockEl.currentTime = 0;
      const playPromise = unlockEl.play();
      if (playPromise) playPromise.catch(() => {});
    }
    const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  }

  function stopOscillators(when) {
    const stopAt = (when ?? (ctx ? ctx.currentTime : 0)) + 0.02;
    [oscL, oscR, lfo, amOffset].forEach((node) => {
      if (!node) return;
      try { node.stop(stopAt); } catch {}
      try { node.disconnect(); } catch {}
    });
    [panL, panR, lfoScale, amGain].forEach((node) => {
      if (!node) return;
      try { node.disconnect(); } catch {}
    });
    oscL = oscR = panL = panR = lfo = lfoScale = amOffset = amGain = null;
  }

  function makeOsc(freq) {
    const osc = ctx.createOscillator();
    osc.type = state.wave;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    return osc;
  }

  function connectCarriers(dest) {
    if (currentBinaural() && ctx.createStereoPanner) {
      oscL = makeOsc(currentHz());
      oscR = makeOsc(rightHz());
      panL = ctx.createStereoPanner();
      panR = ctx.createStereoPanner();
      panL.pan.setValueAtTime(-1, ctx.currentTime);
      panR.pan.setValueAtTime(1, ctx.currentTime);
      oscL.connect(panL).connect(dest);
      oscR.connect(panR).connect(dest);
      oscL.start();
      oscR.start();
    } else if (currentBinaural()) {
      const merger = ctx.createChannelMerger(2);
      oscL = makeOsc(currentHz());
      oscR = makeOsc(rightHz());
      oscL.connect(merger, 0, 0);
      oscR.connect(merger, 0, 1);
      merger.connect(dest);
      panL = merger;
      oscL.start();
      oscR.start();
    } else {
      oscL = makeOsc(currentHz());
      oscL.connect(dest);
      oscL.start();
    }
  }

  function startGraph() {
    stopOscillators(ctx.currentTime);
    connectCarriers(master);
  }

  function startObeGraph() {
    stopOscillators(ctx.currentTime);
    amGain = ctx.createGain();
    amGain.gain.value = 0;
    amGain.connect(master);
    connectCarriers(amGain);

    lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.setValueAtTime(Math.max(0.1, state.obe.startPulse), ctx.currentTime);

    if (typeof ctx.createConstantSource === "function") {
      amOffset = ctx.createConstantSource();
      amOffset.offset.value = 1;
    } else {
      const src = ctx.createBufferSource();
      const buf = ctx.createBuffer(1, 2, ctx.sampleRate);
      buf.getChannelData(0)[0] = 1;
      buf.getChannelData(0)[1] = 1;
      src.buffer = buf;
      src.loop = true;
      const g = ctx.createGain();
      g.gain.value = 1;
      src.connect(g);
      amOffset = g;
      amOffset._src = src;
      amOffset.offset = g.gain;
    }

    lfoScale = ctx.createGain();
    lfoScale.gain.value = 0;
    lfo.connect(lfoScale);
    lfoScale.connect(amGain.gain);
    amOffset.connect(amGain.gain);
    lfo.start();
    if (amOffset.start) amOffset.start();
    else if (amOffset._src) amOffset._src.start();
  }

  function setAmDepth(depth, at, ramp) {
    if (!amOffset || !lfoScale) return;
    const d = clamp(depth, 0, 1);
    const span = d * (1 - AM_FLOOR) / 2;
    const mid = 1 - span;
    const now = at ?? ctx.currentTime;
    const later = now + (ramp ?? 0);
    amOffset.offset.cancelScheduledValues(now);
    lfoScale.gain.cancelScheduledValues(now);
    amOffset.offset.setValueAtTime(amOffset.offset.value, now);
    lfoScale.gain.setValueAtTime(lfoScale.gain.value, now);
    amOffset.offset.linearRampToValueAtTime(mid, later);
    lfoScale.gain.linearRampToValueAtTime(span, later);
  }

  function scheduleObe(t0) {
    readObeFields();
    const quiet = state.obe.quietMin * 60;
    const build = state.obe.buildMin * 60;
    const blend = state.obe.blendSec;
    const startP = Math.max(0.1, state.obe.startPulse);
    const endP = Math.max(startP + 0.1, state.obe.endPulse);
    const soft = state.obe.quietMode === "tone";
    const tBuild = t0 + quiet;
    const tBlend = tBuild + build;
    const tHold = tBlend + blend;
    const intro = Math.min(4, Math.max(0.6, build * 0.12));

    master.gain.cancelScheduledValues(t0);
    const fromVol = master.gain.value;
    master.gain.setValueAtTime(fromVol, t0);
    if (quiet > 0 && !soft) {
      master.gain.linearRampToValueAtTime(0, t0 + FADE);
      const fadeIn = Math.min(3, Math.max(1, quiet));
      const tIn = Math.max(t0 + FADE, tBuild - fadeIn);
      master.gain.setValueAtTime(0, tIn);
      master.gain.linearRampToValueAtTime(state.vol, tBuild);
    } else if (quiet > 0 && soft) {
      const softVol = Math.max(0.04, state.vol * 0.28);
      master.gain.linearRampToValueAtTime(softVol, t0 + 0.6);
      const trans = Math.min(8, Math.max(2, quiet * 0.2));
      master.gain.setValueAtTime(softVol, Math.max(t0 + 0.6, tBuild - trans));
      master.gain.linearRampToValueAtTime(state.vol, tBuild);
    } else {
      master.gain.linearRampToValueAtTime(state.vol, t0 + FADE);
    }

    setAmDepth(0, t0, FADE);
    lfo.frequency.cancelScheduledValues(t0);
    lfo.frequency.setValueAtTime(startP, t0);
    setAmDepth(1, tBuild, intro);
    lfo.frequency.setValueAtTime(startP, tBuild);
    try {
      lfo.frequency.exponentialRampToValueAtTime(endP, tBlend);
    } catch {
      lfo.frequency.linearRampToValueAtTime(endP, tBlend);
    }
    if (amOffset && lfoScale) {
      const span = (1 - AM_FLOOR) / 2;
      amOffset.offset.setValueAtTime(1 - span, tBlend);
      lfoScale.gain.setValueAtTime(span, tBlend);
      amOffset.offset.linearRampToValueAtTime(1, tHold);
      lfoScale.gain.linearRampToValueAtTime(0, tHold);
    }

    obeSess = { t0, quiet, build, blend, startP, endP, intro };
  }

  function obeSnapshot() {
    if (!obeSess) return null;
    const clock = ctx ? ctx.currentTime : 0;
    const t = Math.max(0, clock - obeSess.t0);
    const { quiet, build, blend, startP, endP } = obeSess;
    const toHold = quiet + build + blend;
    if (t < quiet) {
      return {
        phase: "quiet",
        pulse: 0,
        elapsed: t,
        phaseLeft: quiet - t,
        toHold: toHold - t,
        progress: toHold ? t / toHold : 1
      };
    }
    if (t < quiet + build) {
      const p = (t - quiet) / Math.max(0.001, build);
      const pulse = startP * Math.pow(endP / startP, clamp(p, 0, 1));
      return {
        phase: "build",
        pulse,
        elapsed: t,
        phaseLeft: quiet + build - t,
        toHold: toHold - t,
        progress: toHold ? t / toHold : 1
      };
    }
    if (t < toHold) {
      return {
        phase: "blend",
        pulse: endP,
        elapsed: t,
        phaseLeft: toHold - t,
        toHold: toHold - t,
        progress: toHold ? t / toHold : 1
      };
    }
    return {
      phase: "hold",
      pulse: 0,
      elapsed: t,
      phaseLeft: 0,
      toHold: 0,
      progress: 1
    };
  }

  function plannedObe() {
    const quiet = state.obe.quietMin * 60;
    const build = state.obe.buildMin * 60;
    const blend = state.obe.blendSec;
    return { quiet, build, blend, total: quiet + build + blend };
  }

  function updateObeUi() {
    if (state.mode !== "obe" || !obePhaseEl) return;
    const snap = state.playing ? obeSnapshot() : null;
    if (!snap) {
      const plan = plannedObe();
      obePhaseEl.textContent = "Ready";
      obePulseEl.textContent = formatHz(state.obe.startPulse);
      obePulseUnit.textContent = "pulses/s start";
      const parts = [];
      if (plan.quiet > 0) parts.push(`${formatTime(plan.quiet)} quiet start`);
      parts.push(`${formatTime(plan.build)} build-up`);
      parts.push(`${formatTime(plan.blend)} blend`);
      obeTimeEl.textContent = parts.join(" · ") + ", then a solid tone";
      obeBarFill.style.width = "0%";
      obeBar.setAttribute("aria-valuenow", "0");
      return;
    }
    const labels = {
      quiet: "Quiet start",
      build: "Build-up",
      blend: "Blending to solid",
      hold: "Solid tone"
    };
    obePhaseEl.textContent = labels[snap.phase];
    if (snap.phase === "build" || snap.phase === "blend") {
      obePulseEl.textContent = formatHz(snap.pulse, { decimals: snap.pulse < 10 ? 2 : 1 });
      obePulseUnit.textContent = "pulses/s";
    } else if (snap.phase === "quiet") {
      obePulseEl.textContent = state.obe.quietMode === "tone" ? "Soft" : "Silent";
      obePulseUnit.textContent = "before build-up";
    } else {
      obePulseEl.textContent = "Solid";
      obePulseUnit.textContent = "steady tone";
    }
    const pct = Math.round(clamp(snap.progress, 0, 1) * 100);
    obeBarFill.style.width = pct + "%";
    obeBar.setAttribute("aria-valuenow", String(pct));
    if (snap.phase === "hold") {
      obeTimeEl.textContent = "Holding until you stop, or the sleep timer ends";
    } else if (snap.phase === "build") {
      obeTimeEl.textContent = `${formatTime(snap.phaseLeft)} left in build-up · ${formatTime(snap.toHold)} until solid`;
    } else if (snap.phase === "blend") {
      obeTimeEl.textContent = `${formatTime(snap.phaseLeft)} left blending to a solid tone`;
    } else {
      obeTimeEl.textContent = `${formatTime(snap.phaseLeft)} left in quiet start · ${formatTime(snap.toHold)} until solid`;
    }
  }

  function applyFreq(now = ctx ? ctx.currentTime : 0, ramp = 0.03) {
    if (!oscL) return;
    const apply = (osc, freq) => {
      const safe = Math.max(0.01, freq);
      osc.frequency.cancelScheduledValues(now);
      osc.frequency.setValueAtTime(Math.max(0.01, osc.frequency.value), now);
      try {
        osc.frequency.exponentialRampToValueAtTime(safe, now + ramp);
      } catch {
        osc.frequency.linearRampToValueAtTime(safe, now + ramp);
      }
    };
    apply(oscL, currentHz());
    if (oscR) apply(oscR, rightHz());
  }

  function applyWave() {
    if (oscL) oscL.type = state.wave;
    if (oscR) oscR.type = state.wave;
  }

  async function setWakeLock(on) {
    try {
      if (on && "wakeLock" in navigator) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => { wakeLock = null; });
      } else if (wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch {
      wakeLock = null;
    }
  }

  function cancelObe() {
    obeSess = null;
    updateObeUi();
  }

  async function play() {
    await unlockAudio();
    if (!state.playing) {
      if (state.mode === "obe") {
        startObeGraph();
        scheduleObe(ctx.currentTime);
      } else {
        startGraph();
        fadeTo(state.vol, FADE);
      }
    } else if (state.mode !== "obe") {
      fadeTo(state.vol, FADE);
    }
    state.playing = true;
    setStatus();
    startViz();
    updateObeUi();
    setWakeLock(true);
  }

  function stop({ fade = FADE } = {}) {
    cancelSweep();
    cancelObe();
    if (ctx && master && state.playing) {
      fadeTo(0, fade);
      const when = ctx.currentTime + fade;
      stopOscillators(when);
    } else {
      stopOscillators();
    }
    state.playing = false;
    setStatus();
    updateObeUi();
    setWakeLock(false);
  }

  async function toggle() {
    if (state.playing) stop();
    else await play();
  }

  function setFreq(hz, { silent, fromSweep } = {}) {
    const next = clamp(Math.round(hz * 10) / 10, MIN_HZ, MAX_HZ);
    if (state.mode === "obe") state.obe.carrier = next;
    else state.hz = next;
    updateReadout();
    if (!silent) persist();
    if (!fromSweep && state.playing && ctx) applyFreq();
  }

  function setMode(mode) {
    if (mode !== "tone" && mode !== "obe") return;
    if (state.mode === mode) return;
    if (state.playing) stop();
    cancelSweep();
    state.mode = mode;
    applyModeUi();
    persist();
    updateReadout();
    setStatus();
    updateObeUi();
  }

  function applyModeUi() {
    const obe = state.mode === "obe";
    document.body.classList.toggle("mode-obe", obe);
    document.body.classList.toggle("mode-tone", !obe);
    $("tabTone").setAttribute("aria-selected", String(!obe));
    $("tabObe").setAttribute("aria-selected", String(obe));
    document.querySelectorAll(".tone-only").forEach((el) => { el.hidden = obe; });
    document.querySelectorAll(".obe-only").forEach((el) => { el.hidden = !obe; });
  }

  function readObeFields() {
    state.obe.carrier = parseHz(obeCarrier.value, MIN_HZ, MAX_HZ, state.obe.carrier);
    state.obe.startPulse = parseHz(obeStartPulse.value, 0.5, 20, state.obe.startPulse);
    state.obe.endPulse = parseHz(obeEndPulse.value, 2, 60, state.obe.endPulse);
    if (state.obe.endPulse < state.obe.startPulse) state.obe.endPulse = state.obe.startPulse;
    state.obe.buildMin = clamp(parseFloat(obeBuild.value) || state.obe.buildMin, 0.05, 60);
    state.obe.quietMin = clamp(parseFloat(obeQuiet.value) || 0, 0, 10);
    state.obe.blendSec = clamp(parseFloat(obeBlend.value) || state.obe.blendSec, 3, 180);
    state.obe.beat = parseHz(obeBeat.value, 0.1, MAX_BEAT, state.obe.beat);
    obeCarrier.value = formatHz(state.obe.carrier);
    obeStartPulse.value = formatHz(state.obe.startPulse);
    obeEndPulse.value = formatHz(state.obe.endPulse);
    obeBuild.value = String(state.obe.buildMin);
    obeQuiet.value = String(state.obe.quietMin);
    obeBlend.value = String(state.obe.blendSec);
    obeBeat.value = formatHz(state.obe.beat);
  }

  function cancelSweep() {
    if (!sweepAnim) return;
    cancelAnimationFrame(sweepAnim.raf);
    sweepAnim = null;
    sweepBtn.textContent = "Start sweep";
    setStatus();
  }

  async function startSweep() {
    if (state.mode !== "tone") return;
    state.sweepStart = parseHz(sweepStart.value, MIN_HZ, MAX_HZ, 100);
    state.sweepEnd = parseHz(sweepEnd.value, MIN_HZ, MAX_HZ, 1000);
    state.sweepDur = clamp(parseFloat(sweepDur.value) || 10, 0.5, 120);
    sweepStart.value = formatHz(state.sweepStart);
    sweepEnd.value = formatHz(state.sweepEnd);
    sweepDur.value = String(state.sweepDur);
    persist();
    cancelSweep();
    setFreq(state.sweepStart, { silent: true });
    await play();
    const t0 = performance.now();
    const dur = state.sweepDur * 1000;
    const startF = state.sweepStart;
    const endF = state.sweepEnd;
    const expo = startF > 0 && endF > 0;
    if (oscL && ctx) {
      const now = ctx.currentTime;
      const seconds = state.sweepDur;
      const schedule = (osc, from, to) => {
        osc.frequency.cancelScheduledValues(now);
        osc.frequency.setValueAtTime(Math.max(0.01, from), now);
        try {
          osc.frequency.exponentialRampToValueAtTime(Math.max(0.01, to), now + seconds);
        } catch {
          osc.frequency.linearRampToValueAtTime(to, now + seconds);
        }
      };
      schedule(oscL, startF, endF);
      if (oscR) schedule(oscR, clamp(startF + state.beat, MIN_HZ, MAX_HZ), clamp(endF + state.beat, MIN_HZ, MAX_HZ));
    }
    sweepBtn.textContent = "Cancel sweep";
    const tick = () => {
      if (!sweepAnim) return;
      const p = Math.min(1, (performance.now() - t0) / dur);
      const f = expo ? startF * Math.pow(endF / startF, p) : startF + (endF - startF) * p;
      setFreq(f, { silent: true, fromSweep: true });
      if (p < 1 && state.playing) {
        sweepAnim.raf = requestAnimationFrame(tick);
      } else {
        setFreq(endF);
        sweepAnim = null;
        sweepBtn.textContent = "Start sweep";
        setStatus();
      }
    };
    sweepAnim = { raf: 0 };
    setStatus();
    sweepAnim.raf = requestAnimationFrame(tick);
  }

  function clearTimer() {
    if (timerId) clearInterval(timerId);
    timerId = 0;
    timerUntil = 0;
    timerMinutes = 0;
    timerLeft.textContent = "";
    document.querySelectorAll("[data-timer]").forEach((btn) => {
      btn.setAttribute("aria-pressed", String(Number(btn.dataset.timer) === 0));
    });
  }

  function setTimer(minutes) {
    if (timerId) clearInterval(timerId);
    timerMinutes = minutes;
    document.querySelectorAll("[data-timer]").forEach((btn) => {
      btn.setAttribute("aria-pressed", String(Math.abs(Number(btn.dataset.timer) - minutes) < 0.01));
    });
    if (!minutes) {
      timerUntil = 0;
      timerLeft.textContent = "";
      return;
    }
    timerUntil = Date.now() + minutes * 60 * 1000;
    const tick = () => {
      const left = timerUntil - Date.now();
      if (left <= 0) {
        clearTimer();
        stop({ fade: 1.5 });
        timerLeft.textContent = "Timer ended";
        return;
      }
      const total = Math.ceil(left / 1000);
      const m = Math.floor(total / 60);
      const s = String(total % 60).padStart(2, "0");
      timerLeft.textContent = `Stops in ${m}:${s}`;
    };
    tick();
    timerId = setInterval(tick, 250);
  }

  function startViz() {
    if (raf) return;
    const canvas = viz;
    const g = canvas.getContext("2d");
    const time = new Uint8Array(analyser ? analyser.fftSize : 2048);
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const w = canvas.width;
      const h = canvas.height;
      g.clearRect(0, 0, w, h);
      g.lineWidth = 3;
      g.lineJoin = "round";
      g.lineCap = "round";
      g.strokeStyle = state.playing ? "#7ee0c8" : "#2a2d36";
      g.beginPath();
      if (analyser && state.playing) {
        analyser.getByteTimeDomainData(time);
        const n = time.length;
        for (let i = 0; i < n; i++) {
          const x = (i / (n - 1)) * w;
          const y = (time[i] / 255) * h;
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
      } else {
        g.moveTo(0, h / 2);
        g.lineTo(w, h / 2);
      }
      g.stroke();
      if (state.mode === "obe") {
        updateObeUi();
        if (state.playing) setStatus();
      }
    };
    draw();
  }

  function onNudgeHold(btn, delta) {
    let hold = 0;
    let repeating = 0;
    const step = () => setFreq(currentHz() + delta);
    const down = (event) => {
      event.preventDefault();
      cancelSweep();
      step();
      hold = setTimeout(() => {
        repeating = setInterval(step, 80);
      }, 380);
    };
    const up = () => {
      clearTimeout(hold);
      clearInterval(repeating);
    };
    btn.addEventListener("pointerdown", down);
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointercancel", up);
    btn.addEventListener("pointerleave", up);
  }

  chips($("commonPresets"), COMMON, "preset", (item) => {
    cancelSweep();
    if (state.binaural) {
      state.binaural = false;
      binauralToggle.setAttribute("aria-pressed", "false");
    }
    setFreq(item.hz);
  });
  chips($("solfeggioPresets"), SOLFEGGIO, "preset", (item) => {
    cancelSweep();
    if (state.binaural) {
      state.binaural = false;
      binauralToggle.setAttribute("aria-pressed", "false");
    }
    setFreq(item.hz);
  });
  chips($("beatPresets"), BEATS, "beat", (item) => {
    state.beat = item.hz;
    beatInput.value = formatHz(state.beat);
    if (!state.binaural) {
      state.binaural = true;
      binauralToggle.setAttribute("aria-pressed", "true");
      if (state.playing && state.mode === "tone") {
        startGraph();
        fadeTo(state.vol, FADE);
      }
    } else if (state.playing) {
      applyFreq();
    }
    persist();
    updateReadout();
  });
  chips($("timerChips"), TIMERS, "timer", (item) => {
    timerCustom.value = "";
    if (!item.min) clearTimer();
    else setTimer(item.min);
  });
  chips($("obeBuildChips"), OBE_BUILDS, "build", (item) => {
    state.obe.buildMin = item.min;
    obeBuild.value = String(item.min);
    persist();
    updateReadout();
    updateObeUi();
  });

  $("tabTone").addEventListener("click", () => setMode("tone"));
  $("tabObe").addEventListener("click", () => setMode("obe"));

  playBtn.addEventListener("click", () => toggle());
  sweepBtn.addEventListener("click", () => {
    if (sweepAnim) {
      cancelSweep();
      return;
    }
    startSweep();
  });

  binauralToggle.addEventListener("click", async () => {
    state.binaural = !state.binaural;
    binauralToggle.setAttribute("aria-pressed", String(state.binaural));
    if (state.binaural) {
      state.beat = parseHz(beatInput.value, 0.1, MAX_BEAT, state.beat);
    }
    persist();
    updateReadout();
    if (state.playing && state.mode === "tone") {
      await unlockAudio();
      startGraph();
      fadeTo(state.vol, FADE);
    }
  });

  obeBinauralToggle.addEventListener("click", async () => {
    state.obe.binaural = !state.obe.binaural;
    obeBinauralToggle.setAttribute("aria-pressed", String(state.obe.binaural));
    persist();
    updateReadout();
    if (state.playing && state.mode === "obe" && ctx) {
      const snap = obeSnapshot();
      const elapsed = snap ? snap.elapsed : 0;
      startObeGraph();
      scheduleObe(ctx.currentTime - elapsed);
    }
  });

  document.querySelectorAll("[data-quiet-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.obe.quietMode = btn.dataset.quietMode;
      document.querySelectorAll("[data-quiet-mode]").forEach((b) => {
        b.setAttribute("aria-pressed", String(b === btn));
      });
      persist();
      updateObeUi();
    });
  });

  freqSlider.addEventListener("input", () => {
    cancelSweep();
    const hz = sliderToFreq(Number(freqSlider.value));
    const rounded = hz < 100 ? Math.round(hz * 10) / 10 : Math.round(hz);
    setFreq(rounded);
  });
  fillTrack(freqSlider);

  freqInput.addEventListener("change", () => {
    cancelSweep();
    setFreq(parseHz(freqInput.value, MIN_HZ, MAX_HZ, currentHz()));
  });

  volSlider.addEventListener("input", () => {
    state.vol = Number(volSlider.value) / 100;
    volLabel.textContent = Math.round(state.vol * 100) + "%";
    fillTrack(volSlider);
    persist();
    if (state.playing) fadeTo(state.vol, 0.03);
  });

  document.querySelectorAll(".wave-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.wave = btn.dataset.wave;
      document.querySelectorAll(".wave-btn").forEach((b) => {
        b.setAttribute("aria-pressed", String(b === btn));
      });
      applyWave();
      persist();
    });
  });

  document.querySelectorAll(".nudge").forEach((btn) => {
    onNudgeHold(btn, Number(btn.dataset.delta));
  });

  baseInput.addEventListener("change", () => {
    state.hz = parseHz(baseInput.value, MIN_HZ, MAX_HZ, state.hz);
    baseInput.value = formatHz(state.hz);
    persist();
    updateReadout();
    if (state.playing && state.mode === "tone") applyFreq();
  });
  beatInput.addEventListener("change", () => {
    state.beat = parseHz(beatInput.value, 0.1, MAX_BEAT, state.beat);
    beatInput.value = formatHz(state.beat);
    persist();
    updateReadout();
    if (state.playing && state.mode === "tone") applyFreq();
  });
  ["sweepStart", "sweepEnd", "sweepDur"].forEach((id) => {
    $(id).addEventListener("change", () => {
      state.sweepStart = parseHz(sweepStart.value, MIN_HZ, MAX_HZ, state.sweepStart);
      state.sweepEnd = parseHz(sweepEnd.value, MIN_HZ, MAX_HZ, state.sweepEnd);
      state.sweepDur = clamp(parseFloat(sweepDur.value) || state.sweepDur, 0.5, 120);
      persist();
    });
  });
  ["obeCarrier", "obeBuild", "obeStartPulse", "obeEndPulse", "obeQuiet", "obeBlend", "obeBeat"].forEach((id) => {
    $(id).addEventListener("change", () => {
      readObeFields();
      persist();
      updateReadout();
      updateObeUi();
      if (id === "obeCarrier" && state.playing && state.mode === "obe") applyFreq();
    });
  });
  timerCustom.addEventListener("change", () => {
    const minutes = clamp(parseFloat(timerCustom.value) || 0, 0, 180);
    if (minutes > 0) setTimer(minutes);
    else clearTimer();
  });

  document.addEventListener("keydown", (event) => {
    const tag = (event.target && event.target.tagName) || "";
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (event.code === "Space") {
      if (tag === "BUTTON") return;
      event.preventDefault();
      toggle();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      setFreq(currentHz() - (event.shiftKey ? 0.1 : 1));
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      setFreq(currentHz() + (event.shiftKey ? 0.1 : 1));
    }
  });

  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible" && state.playing && ctx) {
      if (ctx.state === "suspended" || ctx.state === "interrupted") {
        try { await ctx.resume(); } catch {}
      }
      if (!wakeLock) setWakeLock(true);
    }
  });

  function syncForm() {
    volSlider.value = String(Math.round(state.vol * 100));
    volLabel.textContent = Math.round(state.vol * 100) + "%";
    fillTrack(volSlider);
    baseInput.value = formatHz(state.hz);
    beatInput.value = formatHz(state.beat);
    sweepStart.value = formatHz(state.sweepStart);
    sweepEnd.value = formatHz(state.sweepEnd);
    sweepDur.value = String(state.sweepDur);
    binauralToggle.setAttribute("aria-pressed", String(state.binaural));
    obeCarrier.value = formatHz(state.obe.carrier);
    obeBuild.value = String(state.obe.buildMin);
    obeStartPulse.value = formatHz(state.obe.startPulse);
    obeEndPulse.value = formatHz(state.obe.endPulse);
    obeQuiet.value = String(state.obe.quietMin);
    obeBlend.value = String(state.obe.blendSec);
    obeBeat.value = formatHz(state.obe.beat);
    obeBinauralToggle.setAttribute("aria-pressed", String(state.obe.binaural));
    document.querySelectorAll("[data-quiet-mode]").forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset.quietMode === state.obe.quietMode));
    });
    document.querySelectorAll(".wave-btn").forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset.wave === state.wave));
    });
    document.querySelectorAll("[data-timer]").forEach((btn) => {
      btn.setAttribute("aria-pressed", String(Number(btn.dataset.timer) === 0));
    });
    applyModeUi();
    updateReadout();
    setStatus();
    setSliderTicks();
    updateObeUi();
    startViz();
  }

  syncForm();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }
})();
