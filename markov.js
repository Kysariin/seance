// markov.js
// builds an nth-order markov chain from note sequences, and generates new melodies by probabilistic sampling

/**
 * build a markov transition table from an array of note sequences
 * @param {number[][]} sequences - an array of note sequences, where each sequence is an array of note objects
 * @param {number} order - the order of the markov chain (number of previous notes to consider)
 * @returns {{ table: Object, vocab: number[] }} a markov transition table mapping note contexts to possible next notes and their probabilities
 */
function buildChain(sequences, order) {
    const table = {};
    const vocabSet = new Set();

    for (const notes of sequences) {
        for (const n of notes) vocabSet.add(n);

        for (let i = 0; i + order < notes.length; i++) {
            const state = notes.slice(i, i + order).join(',');
            const next = notes[i + order];
            if (!table[state]) table[state] = {};
            if (!table[state][next]) table[state][next] = 0;
            table[state][next]++;
        }
    }

    // normalize counts --> probabilities
    for (const state in table) {
        const total = Object.values(table[state]).reduce((s, c) => s + c, 0);
        for (const n in table[state]) table[state][n] /= total;
    }

    return { table, vocab: [...vocabSet].sort((a, b) => a - b), };
}

/**
 * sample next note from a probability map
 * falls back to a random vocab note if state is unknown/dead end
 */
function sampleNext(table, vocab, state) {
    const tr = table[state];
    if (!tr) return vocab[Math.floor(Math.random() * vocab.length)];

    let r = Math.random();
    for (const [note, prob] of Object.entries(tr)) {
        r -= prob;
        if (r <= 0) return parseInt(note);
    }
    return parseInt(Object.keys(tr)[0]); // fallback in case of rounding issues
}

/**
 * generate a melody of 'length' notes 
 * seeds from a random window in full corpus
 */
function generate(chain, corpus, order, length = 64) {
    const { table, vocab } = chain;
    const seedIdx = Math.floor(Math.random() * (corpus.length - order));
    const result = corpus.slice(seedIdx, seedIdx + order);

    for (let i = 0; i < length - order; i++) {
        const state = result.slice(-order).join(',');
        result.push(sampleNext(table, vocab, state));
    }
    return result;
}