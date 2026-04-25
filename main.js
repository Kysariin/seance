// main.js

const ORDER = 2;
const LENGTH = 128;

const sequences = Object.values(CORPUS);
const corpus    = sequences.flat();
const chain     = buildChain(sequences, ORDER);

document.getElementById('status').textContent =
    `${corpus.length} notes · ${sequences.length} songs · ${Object.keys(chain.table).length} Markov states`;

let playing       = false;
let animFrameId   = null;
let currentBpm    = 90;
let playStartTime = null;
let notePulse     = 0;
let freqData      = null;

// --- candle visualiser ---

function getAudioEnergy() {
    if (!freqData) freqData = new Uint8Array(analyserNode.frequencyBinCount);
    analyserNode.getByteFrequencyData(freqData);
    let sum = 0;
    for (let i = 0; i < 80; i++) sum += freqData[i];
    return (sum / 80) / 255;
}

function drawCandle(c, W, H) {
    c.clearRect(0, 0, W, H);

    const cx       = W / 2;
    const candleW  = 36;
    const candleH  = 72;
    const candleTopY = H - candleH;

    // candle body — cylindrical gradient
    const bodyGrad = c.createLinearGradient(cx - candleW / 2, 0, cx + candleW / 2, 0);
    bodyGrad.addColorStop(0,    '#221830');
    bodyGrad.addColorStop(0.22, '#5a4868');
    bodyGrad.addColorStop(0.42, '#cfc0dc');
    bodyGrad.addColorStop(0.62, '#b0a0c0');
    bodyGrad.addColorStop(1,    '#1a1025');
    c.fillStyle = bodyGrad;
    c.fillRect(cx - candleW / 2, candleTopY, candleW, candleH);

    // wax pool
    const poolGrad = c.createRadialGradient(cx, candleTopY, 0, cx, candleTopY, candleW / 2);
    poolGrad.addColorStop(0, 'rgba(210, 195, 220, 0.95)');
    poolGrad.addColorStop(1, 'rgba(170, 155, 185, 0.6)');
    c.beginPath();
    c.ellipse(cx, candleTopY, candleW / 2, 5.5, 0, 0, Math.PI * 2);
    c.fillStyle = poolGrad;
    c.fill();

    // wick
    c.beginPath();
    c.strokeStyle = 'rgba(140, 120, 150, 0.85)';
    c.lineWidth = 1.5;
    c.moveTo(cx, candleTopY);
    c.lineTo(cx + 2, candleTopY - 13);
    c.stroke();

    // energy: audio + rhythmic beat pulse + per-note flash
    const audio       = getAudioEnergy();
    const beatPhase   = ((Date.now() - playStartTime) / 1000 * currentBpm / 60) % 1;
    const rhythmPulse = Math.pow((1 + Math.cos(beatPhase * 2 * Math.PI)) / 2, 2);
    notePulse        *= 0.86;
    const flicker     = (Math.random() - 0.5) * 0.07;
    const energy      = Math.min(1, audio * 0.5 + rhythmPulse * 0.35 + notePulse * 0.15 + flicker);

    // flame geometry
    const flameBaseY = candleTopY - 2;
    const flameH     = 42 + energy * 95;
    const flameW     = candleW * (0.52 + energy * 0.22);
    const tipX       = cx + (Math.random() - 0.5) * energy * 11;
    const tipY       = flameBaseY - flameH;
    const lean       = (Math.random() - 0.5) * 12;

    c.save();
    c.shadowBlur  = 28 + energy * 35;
    c.shadowColor = 'rgba(130, 80, 240, 0.55)';

    const flameGrad = c.createLinearGradient(cx, flameBaseY, cx, tipY);
    flameGrad.addColorStop(0,    'rgba(90,  40, 170, 0.95)');
    flameGrad.addColorStop(0.35, 'rgba(150, 100, 255, 0.88)');
    flameGrad.addColorStop(0.72, 'rgba(205, 175, 255, 0.65)');
    flameGrad.addColorStop(1,    'rgba(235, 230, 255, 0)');

    c.beginPath();
    c.moveTo(cx - flameW / 2, flameBaseY);
    c.quadraticCurveTo(cx - flameW * 0.82 + lean, flameBaseY - flameH * 0.52, tipX, tipY);
    c.quadraticCurveTo(cx + flameW * 0.82 + lean, flameBaseY - flameH * 0.52, cx + flameW / 2, flameBaseY);
    c.fillStyle = flameGrad;
    c.fill();

    const coreH    = flameH * 0.38;
    const coreGrad = c.createRadialGradient(cx, flameBaseY - coreH * 0.28, 0, cx, flameBaseY - coreH * 0.28, coreH * 0.58);
    coreGrad.addColorStop(0,   'rgba(255, 252, 255, 0.88)');
    coreGrad.addColorStop(0.5, 'rgba(195, 160, 255, 0.38)');
    coreGrad.addColorStop(1,   'rgba(155, 115, 245, 0)');

    c.beginPath();
    c.ellipse(cx, flameBaseY - coreH * 0.28, flameW * 0.28, coreH * 0.52, 0, 0, Math.PI * 2);
    c.fillStyle = coreGrad;
    c.fill();

    c.restore();
}

function startCandle() {
    const canvas = document.getElementById('candle');
    const c = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    canvas.classList.add('visible');

    function draw() {
        if (!playing) return;
        animFrameId = requestAnimationFrame(draw);
        drawCandle(c, W, H);
    }
    draw();
}

function stopCandle() {
    if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
    const canvas = document.getElementById('candle');
    canvas.classList.remove('visible');
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    notePulse = 0;
}

// --- playback ---

function stopPlayback() {
    playing = false;
    stopScheduler();
    stopAll();
    stopCandle();
    const noteEl = document.getElementById('note-display');
    noteEl.textContent = '';
    noteEl.classList.remove('visible');
    document.getElementById('generateBtn').disabled = false;
    document.getElementById('stopBtn').disabled = true;
}

async function playLoop() {
    await ensureAudio();
    let nextStart = null;

    while (playing) {
        const notes = generate(chain, corpus, ORDER, LENGTH);

        nextStart = await new Promise(resolve => {
            startScheduler(notes, currentBpm, (i) => {
                if (!playing) return;
                const el = document.getElementById('note-display');
                el.textContent = midiToName(notes[i]);
                el.classList.add('visible');
                notePulse = 1;
            }, resolve, nextStart);
        });

        if (!playing) break;
    }
}

// --- UI wiring ---

document.getElementById('generateBtn').addEventListener('click', () => {
    playing       = true;
    playStartTime = Date.now();
    document.getElementById('generateBtn').disabled = true;
    document.getElementById('stopBtn').disabled = false;
    playLoop();
    setTimeout(startCandle, 150);
});

document.getElementById('stopBtn').addEventListener('click', stopPlayback);

document.getElementById('bpmSlider').addEventListener('input', e => {
    currentBpm = parseInt(e.target.value);
    document.getElementById('bpmLabel').textContent = `${currentBpm} bpm`;
    setSchedulerBpm(currentBpm);
});

const rhythmHints = {
    even:   'all notes the same length',
    swing:  'long + short pairs · jazz triplet feel',
    dotted: 'long-short pairs · sharper, more march-like',
    lurch:  'uneven grouping · unstable, stumbling',
};

document.getElementById('rhythmSelect').addEventListener('change', e => {
    currentRhythm = e.target.value;
    document.getElementById('rhythmHint').textContent = rhythmHints[e.target.value];
});

document.getElementById('instrumentSelect').addEventListener('change', e => {
    const preset = applyInstrument(e.target.value);
    document.getElementById('instrHint').textContent = preset.desc;
    // sync ADSR sliders to new preset defaults
    const sliders = { atk: 'A', dcy: 'D', sus: 'S', rel: 'R' };
    for (const [id, key] of Object.entries(sliders)) {
        const val = preset.adsr[key];
        document.getElementById(id + 'Slider').value = val;
        const decimals = id === 'rel' ? 1 : 2;
        document.getElementById(id + 'Label').textContent = val.toFixed(decimals);
    }
});

document.getElementById('atkSlider').addEventListener('input', e => {
    adsr.A = parseFloat(e.target.value);
    document.getElementById('atkLabel').textContent = adsr.A.toFixed(2);
});
document.getElementById('dcySlider').addEventListener('input', e => {
    adsr.D = parseFloat(e.target.value);
    document.getElementById('dcyLabel').textContent = adsr.D.toFixed(2);
});
document.getElementById('susSlider').addEventListener('input', e => {
    adsr.S = parseFloat(e.target.value);
    document.getElementById('susLabel').textContent = adsr.S.toFixed(2);
});
document.getElementById('relSlider').addEventListener('input', e => {
    adsr.R = parseFloat(e.target.value);
    document.getElementById('relLabel').textContent = adsr.R.toFixed(1);
});
