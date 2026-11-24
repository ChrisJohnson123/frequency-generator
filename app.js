(() => {
  const MIN_HZ = 1;
  const MAX_HZ = 20000;
  const MAX_BEAT = 40;
  const FADE = 0.05;
  const STORAGE_KEY = "freq-gen-v1";

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

  const saved = (() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
    catch { return {}; }
  })();

  const state = {
    hz: parseHz(saved.hz, MIN_HZ, MAX_HZ, 440),
    vol: clamp(saved.vol ?? 0.3, 0, 1),
    wave: ["sine", "square", "triangle", "sawtooth"].includes(saved.wave) ? saved.wave : "sine",
    binaural: !!saved.binaural,
    beat: parseHz(saved.beat, 0.1, MAX_BEAT, 10),
    sweepStart: parseHz(saved.sweepStart, MIN_HZ, MAX_HZ, 100),
    sweepEnd: parseHz(saved.sweepEnd, MIN_HZ, MAX_HZ, 1000),
    sweepDur: clamp(saved.sweepDur ?? 10, 0.5, 120),
    playing: false
  };

  let ctx = null;
  let master = null;
  let analyser = null;
  let oscL = null;
  let oscR = null;
  let panL = null;
  let panR = null;
  let wakeLock = null;
  let sweepAnim = null;
  let timerUntil = 0;
  let timerId = 0;
  let timerMinutes = 0;
  let raf = 0;

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      hz: state.hz,
      vol: state.vol,
      wave: state.wave,
      binaural: state.binaural,
      beat: state.beat,
      sweepStart: state.sweepStart,
      sweepEnd: state.sweepEnd,
      sweepDur: state.sweepDur
    }));
  }

  function rightHz() {
    return clamp(state.hz + state.beat, MIN_HZ, MAX_HZ);
  }

  function fillTrack(el) {
    const min = Number(el.min);
    const max = Number(el.max);
    const pct = ((Number(el.value) - min) / (max - min)) * 100;
    el.style.setProperty("--fill", pct + "%");
  }

  function updateReadout() {
    hzDisplay.textContent = formatHz(state.hz);
    hzUnit.textContent = "Hz";
    freqInput.value = formatHz(state.hz);
    baseInput.value = formatHz(state.hz);
    freqSlider.value = String(Math.round(freqToSlider(state.hz)));
    fillTrack(freqSlider);
    if (state.binaural) {
      const r = rightHz();
      const actualBeat = Math.round((r - state.hz) * 10) / 10;
      stereoHint.innerHTML = `L <strong>${formatHz(state.hz)} Hz</strong> · R <strong>${formatHz(r)} Hz</strong> · beat ${formatHz(actualBeat)} Hz`;
    } else {
      stereoHint.textContent = "";
    }
    document.querySelectorAll("[data-preset]").forEach((btn) => {
      const hz = Number(btn.dataset.preset);
      btn.setAttribute("aria-pressed", String(!state.binaural && Math.abs(hz - state.hz) < 0.05));
    });
    document.querySelectorAll("#beatPresets .chip").forEach((btn) => {
      btn.setAttribute("aria-pressed", String(state.binaural && Math.abs(Number(btn.dataset.beat) - state.beat) < 0.05));
    });
  }

  function setStatus() {
    if (sweepAnim) {
      statusEl.textContent = "Sweeping";
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
    [oscL, oscR].forEach((osc) => {
      if (!osc) return;
      try { osc.stop(stopAt); } catch {}
      try { osc.disconnect(); } catch {}
    });
    [panL, panR].forEach((node) => {
      if (!node) return;
      try { node.disconnect(); } catch {}
    });
    oscL = oscR = panL = panR = null;
  }

  function makeOsc(freq) {
    const osc = ctx.createOscillator();
    osc.type = state.wave;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    return osc;
  }

  function startGraph() {
    stopOscillators(ctx.currentTime);
    if (state.binaural && ctx.createStereoPanner) {
      oscL = makeOsc(state.hz);
      oscR = makeOsc(rightHz());
      panL = ctx.createStereoPanner();
      panR = ctx.createStereoPanner();
      panL.pan.setValueAtTime(-1, ctx.currentTime);
      panR.pan.setValueAtTime(1, ctx.currentTime);
      oscL.connect(panL).connect(master);
      oscR.connect(panR).connect(master);
      oscL.start();
      oscR.start();
    } else if (state.binaural) {
      const merger = ctx.createChannelMerger(2);
      oscL = makeOsc(state.hz);
      oscR = makeOsc(rightHz());
      oscL.connect(merger, 0, 0);
      oscR.connect(merger, 0, 1);
      merger.connect(master);
      panL = merger;
      oscL.start();
      oscR.start();
    } else {
      oscL = makeOsc(state.hz);
      oscL.connect(master);
      oscL.start();
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
    apply(oscL, state.hz);
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

  async function play() {
    await unlockAudio();
    if (!state.playing) startGraph();
    fadeTo(state.vol, FADE);
    state.playing = true;
    setStatus();
    startViz();
    setWakeLock(true);
  }

  function stop({ fade = FADE } = {}) {
    cancelSweep();
    if (ctx && master && state.playing) {
      fadeTo(0, fade);
      const when = ctx.currentTime + fade;
      stopOscillators(when);
    } else {
      stopOscillators();
    }
    state.playing = false;
    setStatus();
    setWakeLock(false);
  }

  async function toggle() {
    if (state.playing) stop();
    else await play();
  }

  function setFreq(hz, { silent, fromSweep } = {}) {
    state.hz = clamp(Math.round(hz * 10) / 10, MIN_HZ, MAX_HZ);
    if (state.binaural) baseInput.value = formatHz(state.hz);
    updateReadout();
    if (!silent) persist();
    if (!fromSweep && state.playing && ctx) applyFreq();
  }

  function cancelSweep() {
    if (!sweepAnim) return;
    cancelAnimationFrame(sweepAnim.raf);
    sweepAnim = null;
    sweepBtn.textContent = "Start sweep";
    setStatus();
  }

  async function startSweep() {
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
    };
    draw();
  }

  function onNudgeHold(btn, delta) {
    let hold = 0;
    let repeating = 0;
    const step = () => setFreq(state.hz + delta);
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
      if (state.playing) {
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
      baseInput.value = formatHz(state.hz);
      state.beat = parseHz(beatInput.value, 0.1, MAX_BEAT, state.beat);
    }
    persist();
    updateReadout();
    if (state.playing) {
      await unlockAudio();
      startGraph();
      fadeTo(state.vol, FADE);
    }
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
    setFreq(parseHz(freqInput.value, MIN_HZ, MAX_HZ, state.hz));
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
    if (state.playing) applyFreq();
  });
  beatInput.addEventListener("change", () => {
    state.beat = parseHz(beatInput.value, 0.1, MAX_BEAT, state.beat);
    beatInput.value = formatHz(state.beat);
    persist();
    updateReadout();
    if (state.playing) applyFreq();
  });
  ["sweepStart", "sweepEnd", "sweepDur"].forEach((id) => {
    $(id).addEventListener("change", () => {
      state.sweepStart = parseHz(sweepStart.value, MIN_HZ, MAX_HZ, state.sweepStart);
      state.sweepEnd = parseHz(sweepEnd.value, MIN_HZ, MAX_HZ, state.sweepEnd);
      state.sweepDur = clamp(parseFloat(sweepDur.value) || state.sweepDur, 0.5, 120);
      persist();
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
      setFreq(state.hz - (event.shiftKey ? 0.1 : 1));
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      setFreq(state.hz + (event.shiftKey ? 0.1 : 1));
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
    document.querySelectorAll(".wave-btn").forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset.wave === state.wave));
    });
    document.querySelectorAll("[data-timer]").forEach((btn) => {
      btn.setAttribute("aria-pressed", String(Number(btn.dataset.timer) === 0));
    });
    updateReadout();
    setStatus();
    setSliderTicks();
    startViz();
  }

  syncForm();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }
})();
