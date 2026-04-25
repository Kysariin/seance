// audio.js
// signal chain: oscillator(s) --> gain --> filter --> delay --> reverb --> output

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiToFreq(n) { return 440 * Math.pow(2, (n - 69) / 12); }
function midiToName(n) { return NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 1); }

let ctx          = null;
let filterNode   = null;
let delayNode    = null;
let reverbNode   = null;
let activeOscList = [];
let analyserNode = null;

// --- mutable params (read by playNote each time it fires) ---
const adsr = { A: 0.05, D: 0.15, S: 0.22, R: 1.6 };

// --- instrument presets ---
const instruments = {
    synth: {
        desc:      'two detuned oscillators · bright analog lead',
        filterFreq: 1800, filterQ: 1.5,
        adsr: { A: 0.05, D: 0.15, S: 0.22, R: 1.60 },
    },
    organ: {
        desc:      'stacked harmonic sines · sustained pipe organ',
        filterFreq: 3200, filterQ: 0.4,
        adsr: { A: 0.01, D: 0.02, S: 0.80, R: 0.08 },
    },
    pluck: {
        desc:      'sharp attack, quick fade · harp or guitar',
        filterFreq: 1000, filterQ: 1.2,
        adsr: { A: 0.003, D: 0.10, S: 0.00, R: 0.70 },
    },
    pad: {
        desc:      'slow fade in, long release · thick ambient wash',
        filterFreq:  600, filterQ: 0.8,
        adsr: { A: 1.00, D: 0.60, S: 0.55, R: 3.00 },
    },
};
let currentInstrument = 'synth';

/** Switch instrument: update adsr defaults + ramp filter (audible immediately). */
function applyInstrument(name) {
    currentInstrument = name;
    const p = instruments[name];
    Object.assign(adsr, p.adsr);
    if (filterNode) {
        filterNode.frequency.linearRampToValueAtTime(p.filterFreq, ctx.currentTime + 0.1);
        filterNode.Q.linearRampToValueAtTime(p.filterQ,            ctx.currentTime + 0.1);
    }
    return p;
}

// --- rhythm patterns ---
const rhythmPatterns = {
    even:   [1],
    swing:  [1.33, 0.67],
    dotted: [1.5,  0.5],
    lurch:  [2, 0.5, 0.5, 1],
};
let currentRhythm = 'even';

// --- audio init ---
async function initAudio() {
    if (ctx) return;
    ctx = new AudioContext();

    reverbNode = ctx.createConvolver();
    const impulseLen = ctx.sampleRate * 3;
    const impulse = ctx.createBuffer(2, impulseLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
        const d = impulse.getChannelData(ch);
        for (let i = 0; i < impulseLen; i++)
            d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / impulseLen, 2.5);
    }
    reverbNode.buffer = impulse;

    delayNode = ctx.createDelay(1.0);
    delayNode.delayTime.value = 0.22;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.28;
    delayNode.connect(feedback);
    feedback.connect(delayNode);
    const delayWet = ctx.createGain();
    delayWet.gain.value = 0.22;
    delayNode.connect(delayWet);
    delayWet.connect(reverbNode);

    filterNode = ctx.createBiquadFilter();
    filterNode.type = 'lowpass';
    filterNode.frequency.value = instruments[currentInstrument].filterFreq;
    filterNode.Q.value         = instruments[currentInstrument].filterQ;
    filterNode.connect(delayNode);
    filterNode.connect(reverbNode);

    const reverbWet = ctx.createGain();
    reverbWet.gain.value = 0.5;
    reverbNode.connect(reverbWet);
    reverbWet.connect(ctx.destination);

    analyserNode = ctx.createAnalyser();
    analyserNode.fftSize = 1024;
    analyserNode.smoothingTimeConstant = 0.8;
    reverbWet.connect(analyserNode);
}

async function ensureAudio() {
    await initAudio();
    if (ctx.state === 'suspended') await ctx.resume();
}

// --- synthesis helpers ---

function _reg(osc, startTime, stopAfter) {
    osc.start(startTime);
    osc.stop(startTime + stopAfter + 0.05);
    activeOscList.push(osc);
    osc.onended = () => { activeOscList = activeOscList.filter(o => o !== osc); };
}

/** Standard ADSR envelope — clamps attack so it never overruns the note duration. */
function _env(startTime, dur) {
    const env = ctx.createGain();
    const { A, D, S, R } = adsr;
    const effA = Math.min(A, dur * 0.8);
    const effD = Math.min(D, Math.max(0, dur * 0.95 - effA));
    env.gain.setValueAtTime(0, startTime);
    env.gain.linearRampToValueAtTime(0.5,     startTime + effA);
    env.gain.linearRampToValueAtTime(S * 0.5, startTime + effA + effD);
    env.gain.setValueAtTime(S * 0.5,          startTime + dur);
    env.gain.linearRampToValueAtTime(0,        startTime + dur + R);
    return env;
}

// synth: two detuned sawtooth oscillators — wide, chorus-like
function _playSynth(freq, startTime, dur) {
    const env = _env(startTime, dur);
    env.connect(filterNode);
    [-10, 10].forEach(cents => {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = freq * Math.pow(2, cents / 1200);
        osc.connect(env);
        _reg(osc, startTime, dur + adsr.R);
    });
}

// organ: sine waves at 1f, 2f, 3f, 4f, 6f — Hammond drawbar approximation
const ORGAN_PARTIALS = [[1, 0.35], [2, 0.25], [3, 0.12], [4, 0.08], [6, 0.04]];
function _playOrgan(freq, startTime, dur) {
    const { A, R } = adsr;
    ORGAN_PARTIALS.forEach(([mult, gain]) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq * mult;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0,    startTime);
        env.gain.linearRampToValueAtTime(gain, startTime + A);
        env.gain.setValueAtTime(gain, startTime + dur);
        env.gain.linearRampToValueAtTime(0,    startTime + dur + R);
        osc.connect(env);
        env.connect(filterNode);
        _reg(osc, startTime, dur + R);
    });
}

// pluck: single triangle with sharp attack, fast decay (S=0 by default)
function _playPluck(freq, startTime, dur) {
    const env = _env(startTime, dur);
    env.connect(filterNode);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    osc.connect(env);
    _reg(osc, startTime, dur + adsr.R);
}

// pad: three detuned sawtooths, ignores note duration — runs full ADSR autonomously
// so overlapping notes blur into a thick wash
function _playPad(freq, startTime) {
    const { A, D, S, R } = adsr;
    const totalDur = A + D + R;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0,        startTime);
    env.gain.linearRampToValueAtTime(0.22,      startTime + A);
    env.gain.linearRampToValueAtTime(S * 0.22,  startTime + A + D);
    env.gain.linearRampToValueAtTime(0,          startTime + A + D + R);
    env.connect(filterNode);
    [-5, 0, 5].forEach(cents => {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = freq * Math.pow(2, cents / 1200);
        osc.connect(env);
        _reg(osc, startTime, totalDur);
    });
}

function playNote(midi, startTime, duration) {
    const freq = midiToFreq(midi);
    switch (currentInstrument) {
        case 'synth': _playSynth(freq, startTime, duration); break;
        case 'organ': _playOrgan(freq, startTime, duration); break;
        case 'pluck': _playPluck(freq, startTime, duration); break;
        case 'pad':   _playPad(freq, startTime);             break;
    }
}

function stopAll() {
    activeOscList.forEach(osc => { try { osc.stop(); } catch(e) {} });
    activeOscList = [];
    if (ctx) ctx.suspend();
}

// --- lookahead scheduler ---

let _schedTimer = null;
let _sched      = {};
const LOOKAHEAD_S = 0.12;
const TICK_MS     = 25;

function _schedulerTick() {
    const pattern = rhythmPatterns[currentRhythm];
    const base    = (60 / _sched.bpm) * 0.5;

    while (_sched.index < _sched.notes.length &&
           _sched.nextTime < ctx.currentTime + LOOKAHEAD_S) {
        const dur = base * pattern[_sched.index % pattern.length];
        playNote(_sched.notes[_sched.index], _sched.nextTime, dur * 0.85);
        const ms  = Math.max(0, (_sched.nextTime - ctx.currentTime) * 1000);
        const idx = _sched.index;
        setTimeout(() => _sched.onNote(idx), ms);
        _sched.nextTime += dur;
        _sched.index++;
    }

    if (_sched.index >= _sched.notes.length) {
        clearInterval(_schedTimer);
        _schedTimer = null;
        _sched.onEnd(_sched.nextTime);
    }
}

function startScheduler(notes, bpm, onNote, onEnd, startAt = null) {
    if (_schedTimer) clearInterval(_schedTimer);
    _sched = { notes, bpm, onNote, onEnd, index: 0, nextTime: startAt ?? ctx.currentTime + 0.05 };
    _schedulerTick();
    _schedTimer = setInterval(_schedulerTick, TICK_MS);
}

function setSchedulerBpm(bpm) { _sched.bpm = bpm; }

function stopScheduler() {
    if (_schedTimer) { clearInterval(_schedTimer); _schedTimer = null; }
}
