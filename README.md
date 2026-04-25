# [PORTFOLIO ENTRY HERE](https://kysariin.github.io/project/sound/seance)
# séance

Markov chain composition engine trained on gothic rock, darkwave, and post-punk MIDI sources.
Generates and plays infinite melodies based on twenty MIDI files for songs (accessed for free online).

## Songs in Corpus
- A Forest by The Cure
- Atmosphere by Joy Division
- Bela Lugosi's Dead by Bauhaus
- Black Celebration by Depeche Mode
- Black No. 1 by Type O Negative
- Black Planet by Sisters of Mercy
- Christian Woman by Type O Negative
- Dark Entries by Bauhaus
- Disintegration by The Cure
- Hanging Garden by The Cure
- In Your Room by Depeche Mode
- It's a Sin by the Pet Shop Boys
- Join Me in Death by HIM
- Killing Moon by Echo and the Bunnymen
- Love Like Blood by Killing Joke
- Not In Love (feat. Robert Smith) by Crystal Castles
- Sacrifice by London After Midnight
- She Sells Sanctuary by The Cult
- Spellbound by Siouxsie and the Banshees
- Stripped by Depeche Mode

## Files
- `index.html` — entry point
- `corpus.js` — pre-extracted note sequences from MIDI training data
- `markov.js` — n-th order Markov chain: buildChain(), generate()
- `audio.js` — Web Audio API synth with reverb, delay, and lowpass filter
- `main.js` — wires everything together

## How It Works
`corpus.js` loads first and exposes a dictionary of note arrays, one per song.
`markov.js` scans those sequences to build a transition probability table, then generates new melodies by probabilistically sampling the next note given the last N notes.
`audio.js` plays the result through a raw Web Audio API signal chain: sawtooth oscillator --> ADSR envelope --> lowpass filter --> feedback delay --> convolution reverb.
`main.js` wires it all together and handles the play/stop loop.

## Regenerating the corpus
If you want to retrain on different MIDI files, drop them in `midis/`, edit the CONFIG files in `extract_corpus.py` and run:
```
python extract_corpus.py
```

## AI Usage
I leaned on Claude Code very heavily for the visual aspects of this project like the UI of sliders/dropdowns and the candle visualizer to accompany the notes.
