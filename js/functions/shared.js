'use strict';
/* Regler-Gruppen, die jede Funktion bekommt.
   Parameter-Typen:
     range (Standard) · gradient (Verlaufsspur) · step (Stufen) · angle (Drehregler)
     segment (Umschalter) · Farben über eine Gruppe mit palette:true
   Optionen: u (Uniform), map (Umrechnung), detent (Raste am Standardwert),
     action:'random', showIf(params), keep (bei Zufall nicht verändern) */
CG.shared = {
  anim: {
    id: 'anim', title: 'Animation',
    params: [
      { key: 'loopLen', label: 'Loop-Dauer', min: 2, max: 60, step: 0.5, def: 12, unit: 's', keep: true },
      { key: 'motion', u: 'uMotion', label: 'Bewegung', min: 0, max: 2, step: 0.01, def: 0.6 },
    ],
  },
  // Bild-Ebene: bei Feuer/Grounddata als Überlagerung, bei Fragment als Motiv.
  // Position & Größe in Einheiten der kürzeren Bildseite (0 = Mitte).
  image: {
    id: 'image', title: 'Bild', pre: body => CG.layer.buildUpload(body),
    params: [
      { key: 'imgId', hidden: true, def: null },
      { key: 'imgX', u: 'uImgX', label: 'Position X', min: -1.5, max: 1.5, step: 0.001, def: 0, detent: true, keep: true, showIf: s => !!s.imgId },
      { key: 'imgY', u: 'uImgY', label: 'Position Y', min: -1.5, max: 1.5, step: 0.001, def: 0, detent: true, keep: true, showIf: s => !!s.imgId },
      { key: 'imgScale', u: 'uImgScale', label: 'Größe', min: 0.05, max: 4, step: 0.001, def: 0.9, keep: true, showIf: s => !!s.imgId },
      { key: 'imgRot', u: 'uImgRot', type: 'angle', label: 'Drehung', def: 0, keep: true, showIf: s => !!s.imgId },
      { key: 'imgOpacity', u: 'uImgOpacity', label: 'Deckkraft', min: 0, max: 1, step: 0.01, def: 1, keep: true,
        showIf: s => !!s.imgId && !CG.fn().usesImage },
      { key: 'imgBlend', u: 'uImgBlend', type: 'segment', label: 'Mischmodus', def: 0, keep: true,
        options: [{ v: 0, label: 'Normal' }, { v: 1, label: 'Multipl.' }, { v: 2, label: 'Aufhellen' }],
        showIf: s => !!s.imgId && !CG.fn().usesImage },
    ],
  },
  finish: {
    id: 'finish', title: 'Finish',
    params: [
      { key: 'bright',   u: 'uBright',   label: 'Helligkeit', min: 0.5, max: 1.5, step: 0.01, def: 1, detent: true, keep: true },
      { key: 'contrast', u: 'uContrast', label: 'Kontrast',   min: 0.5, max: 1.8, step: 0.01, def: 1, detent: true, keep: true },
      { key: 'sat',      u: 'uSat',      label: 'Sättigung',  min: 0,   max: 2,   step: 0.01, def: 1, detent: true, keep: true },
      { key: 'temp',     u: 'uTemp',     label: 'Farbtemperatur', type: 'gradient', min: -1, max: 1, step: 0.01, def: 0, detent: true, keep: true,
        gradient: 'linear-gradient(90deg,#4f86c6,#c9c3b4 50%,#e2b33c)' },
      { key: 'grain',    u: 'uGrain',    label: 'Körnung',    min: 0, max: 1, step: 0.01, def: 0.12, keep: true },
      { key: 'vignette', u: 'uVignette', label: 'Vignette',   min: 0, max: 1, step: 0.01, def: 0, keep: true },
    ],
  },
};
