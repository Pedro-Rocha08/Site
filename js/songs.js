/* Aurora Keys — músicas incluídas (domínio público, arranjos simplificados) */
(function (global) {
  'use strict';

  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  function nameToMidi(s) {
    const m = /^([A-G])(#|b)?(-?\d)$/.exec(s);
    if (!m) throw new Error('Nota inválida: ' + s);
    return PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (parseInt(m[3], 10) + 1) * 12;
  }

  /**
   * Notação compacta: "C4 D4:0.5 E4+G4:2 r:1 |"
   *  - duração em tempos (semínimas); "r" = pausa; "+" = acorde; "|" = barra (ignorada)
   */
  function seq(str, bpm, defDur, vel) {
    const spb = 60 / bpm;
    let beat = 0;
    const notes = [];
    str.trim().split(/\s+/).forEach(tok => {
      if (tok === '|' || !tok) return;
      const [pitch, d] = tok.split(':');
      const dur = d ? parseFloat(d) : defDur;
      if (pitch !== 'r') {
        pitch.split('+').forEach(n => notes.push({
          midi: nameToMidi(n),
          start: beat * spb,
          dur: dur * spb * 0.94,
          vel: vel + (Math.random() - 0.5) * 0.08
        }));
      }
      beat += dur;
    });
    return { notes, beats: beat };
  }

  function song(def) {
    const right = seq(def.right, def.bpm, def.unit || 1, 0.78);
    const left = seq(def.left, def.bpm, def.unit || 1, 0.62);
    const spb = 60 / def.bpm;
    const total = Math.max(right.beats, left.beats);
    const bars = [];
    const pickup = def.pickup || 0;
    if (pickup) bars.push(0);
    for (let b = pickup; b <= total + 0.001; b += def.meter) bars.push(b * spb);
    return {
      id: def.id,
      title: def.title,
      artist: def.artist,
      builtin: true,
      bpm: def.bpm,
      bars,
      duration: total * spb,
      parts: [
        { name: 'Mão direita', hand: 'right', notes: right.notes },
        { name: 'Mão esquerda', hand: 'left', notes: left.notes }
      ]
    };
  }

  const defs = [
    {
      id: 'builtin-escala',
      title: 'Escala de Dó Maior',
      artist: 'Exercício · mãos juntas',
      bpm: 84, meter: 4,
      right: 'C4 D4 E4 F4 | G4 A4 B4 C5 | B4 A4 G4 F4 | E4 D4 C4:2 | C4:0.5 E4:0.5 G4:0.5 C5:0.5 G4:0.5 E4:0.5 C4 | C4+E4+G4:4',
      left: 'C3 D3 E3 F3 | G3 A3 B3 C4 | B3 A3 G3 F3 | E3 D3 C3:2 | C3:0.5 E3:0.5 G3:0.5 C4:0.5 G3:0.5 E3:0.5 C3 | C3+G3:4'
    },
    {
      id: 'builtin-brilha',
      title: 'Brilha, Brilha, Estrelinha',
      artist: 'Canção tradicional',
      bpm: 100, meter: 4,
      right: 'C4 C4 G4 G4 | A4 A4 G4:2 | F4 F4 E4 E4 | D4 D4 C4:2 | G4 G4 F4 F4 | E4 E4 D4:2 | G4 G4 F4 F4 | E4 E4 D4:2 | C4 C4 G4 G4 | A4 A4 G4:2 | F4 F4 E4 E4 | D4 D4 C4:2',
      left: 'C3+G3:4 | F3+A3:2 C3+G3:2 | F3+A3:2 C3+G3:2 | G2+F3:2 C3+E3:2 | C3+E3:2 G2+D3:2 | C3+G3:2 G2+D3:2 | C3+E3:2 G2+D3:2 | C3+G3:2 G2+D3:2 | C3+G3:4 | F3+A3:2 C3+G3:2 | F3+A3:2 C3+G3:2 | G2+F3:2 C3+E3:2'
    },
    {
      id: 'builtin-ode',
      title: 'Ode à Alegria',
      artist: 'Ludwig van Beethoven',
      bpm: 108, meter: 4,
      right: 'E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | E4:1.5 D4:0.5 D4:2 | E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4:1.5 C4:0.5 C4:2 | D4 D4 E4 C4 | D4 E4:0.5 F4:0.5 E4 C4 | D4 E4:0.5 F4:0.5 E4 D4 | C4 D4 G3:2 | E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4:1.5 C4:0.5 C4:2',
      left: 'C3+G3:4 | G2+D3:4 | C3+G3:4 | G2+D3:4 | C3+G3:4 | G2+D3:4 | C3+G3:4 | G2+D3:2 C3+G3:2 | G2+D3:2 C3+G3:2 | G2+D3:2 C3+G3:2 | G2+D3:2 G2+B2:2 | C3+G3:2 G2+D3:2 | C3+G3:4 | G2+D3:4 | C3+G3:4 | G2+D3:2 C3+G3:2'
    },
    {
      id: 'builtin-parabens',
      title: 'Parabéns pra Você',
      artist: 'Mildred & Patty Hill',
      bpm: 116, meter: 3, pickup: 1,
      right: 'G4:0.75 G4:0.25 | A4 G4 C5 | B4:2 G4:0.75 G4:0.25 | A4 G4 D5 | C5:2 G4:0.75 G4:0.25 | G5 E5 C5 | B4 A4 F5:0.75 F5:0.25 | E5 C5 D5 | C5:3',
      left: 'r:1 | C3+G3:3 | G2+F3:3 | G2+F3:3 | C3+G3:3 | C3+E3:3 | F2+C3:3 | C3+G3:2 G2+F3:1 | C3+G3:3'
    },
    {
      id: 'builtin-jingle',
      title: 'Jingle Bells',
      artist: 'James Lord Pierpont',
      bpm: 132, meter: 4,
      right: 'E4 E4 E4:2 | E4 E4 E4:2 | E4 G4 C4:1.5 D4:0.5 | E4:4 | F4 F4 F4:1.5 F4:0.5 | F4 E4 E4 E4:0.5 E4:0.5 | E4 D4 D4 E4 | D4:2 G4:2 | E4 E4 E4:2 | E4 E4 E4:2 | E4 G4 C4:1.5 D4:0.5 | E4:4 | F4 F4 F4:1.5 F4:0.5 | F4 E4 E4 E4:0.5 E4:0.5 | G4 G4 F4 D4 | C4:4',
      left: 'C3+G3:4 | C3+G3:4 | C3+G3:4 | C3+G3:4 | F2+C3:4 | C3+G3:4 | D3+A3:4 | G2+D3:4 | C3+G3:4 | C3+G3:4 | C3+G3:4 | C3+G3:4 | F2+C3:4 | C3+G3:4 | G2+F3:4 | C3+G3:4'
    },
    {
      id: 'builtin-minueto',
      title: 'Minueto em Sol',
      artist: 'Christian Petzold (atrib. J. S. Bach)',
      bpm: 112, meter: 3,
      right: 'D5 G4:0.5 A4:0.5 B4:0.5 C5:0.5 | D5 G4 G4 | E5 C5:0.5 D5:0.5 E5:0.5 F#5:0.5 | G5 G4 G4 | C5 D5:0.5 C5:0.5 B4:0.5 A4:0.5 | B4 C5:0.5 B4:0.5 A4:0.5 G4:0.5 | F#4 G4:0.5 A4:0.5 B4:0.5 G4:0.5 | A4:3 | D5 G4:0.5 A4:0.5 B4:0.5 C5:0.5 | D5 G4 G4 | E5 C5:0.5 D5:0.5 E5:0.5 F#5:0.5 | G5 G4 G4 | C5 D5:0.5 C5:0.5 B4:0.5 A4:0.5 | B4 C5:0.5 B4:0.5 A4:0.5 G4:0.5 | A4 B4:0.5 A4:0.5 G4:0.5 F#4:0.5 | G4:3',
      left: 'G3+B3+D4:2 A3 | B3:3 | C4:3 | B3:3 | A3:3 | G3:3 | D4 B3 G3 | D4 C4 B3:0.5 A3:0.5 | G3+B3+D4:2 A3 | B3:3 | C4:3 | B3 C4 B3:0.5 A3:0.5 | A3:2 F#3 | G3:2 B3 | C4 D4 D3 | G3:2 G2'
    },
    {
      id: 'builtin-elise',
      title: 'Für Elise',
      artist: 'Ludwig van Beethoven',
      bpm: 66, meter: 1.5, pickup: 0.5, unit: 0.25,
      right: 'E5 D#5 | E5 D#5 E5 B4 D5 C5 | A4:0.5 r C4 E4 A4 | B4:0.5 r E4 G#4 B4 | C5:0.5 r E4 E5 D#5 | E5 D#5 E5 B4 D5 C5 | A4:0.5 r C4 E4 A4 | B4:0.5 r E4 C5 B4 | A4:0.5 r:0.5 E5 D#5 | E5 D#5 E5 B4 D5 C5 | A4:0.5 r C4 E4 A4 | B4:0.5 r E4 G#4 B4 | C5:0.5 r E4 E5 D#5 | E5 D#5 E5 B4 D5 C5 | A4:0.5 r C4 E4 A4 | B4:0.5 r E4 C5 B4 | A4:1.5',
      left: 'r:0.5 | r:1.5 | A2 E3 A3 r:0.75 | E2 E3 G#3 r:0.75 | A2 E3 A3 r:0.75 | r:1.5 | A2 E3 A3 r:0.75 | E2 E3 G#3 r:0.75 | A2 E3 A3 r:0.75 | r:1.5 | A2 E3 A3 r:0.75 | E2 E3 G#3 r:0.75 | A2 E3 A3 r:0.75 | r:1.5 | A2 E3 A3 r:0.75 | E2 E3 G#3 r:0.75 | A2 E3 A3:1'
    }
  ];

  global.BUILTIN_SONGS = defs.map(song);
})(window);
