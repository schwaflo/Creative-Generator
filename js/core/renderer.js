'use strict';
/* WebGL2-Renderer: ein Vollbild-Dreieck, ein Shader-Programm pro Funktion. */
CG.Renderer = class {
  constructor(cv) {
    this.cv = cv;
    const gl = cv.getContext('webgl2', { preserveDrawingBuffer: false, antialias: false, alpha: false, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL2 ist in diesem Browser nicht verfügbar.');
    this.gl = gl;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.progs = {};
    const vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    this.maxDim = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), vp[0], vp[1]);
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    // Bild-Ebene: eine Textur, wird beim Wechsel überschrieben (kein Speicher-Stapel)
    this.tex = gl.createTexture();
    this.clearImage();
  }

  setImage(bmp) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.img = { on: 1, aspect: bmp.width / bmp.height, h: bmp.height };
  }

  clearImage() {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    this.img = { on: 0, aspect: 1, h: 1 };
  }

  shader(type, src) {
    const gl = this.gl, s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  program(fn) {
    if (this.progs[fn.id]) return this.progs[fn.id];
    const gl = this.gl, p = gl.createProgram();
    gl.attachShader(p, this.shader(gl.VERTEX_SHADER, CG.glsl.vert));
    gl.attachShader(p, this.shader(gl.FRAGMENT_SHADER, CG.glsl.build(fn)));
    gl.bindAttribLocation(p, 0, 'a');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return (this.progs[fn.id] = { prog: p, locs: {} });
  }

  /* w,h: Zeichenfläche · res: volle Ausgabeauflösung · off: Kachel-Offset */
  draw(fn, params, phase, w, h, res = [w, h], off = [0, 0], ss = 1) {
    const gl = this.gl, cv = this.cv, P = this.program(fn);
    if (cv.width !== w) cv.width = w;
    if (cv.height !== h) cv.height = h;
    gl.viewport(0, 0, w, h);
    gl.useProgram(P.prog);
    gl.bindVertexArray(this.vao);
    const loc = n => (n in P.locs) ? P.locs[n] : (P.locs[n] = gl.getUniformLocation(P.prog, n));
    gl.uniform2f(loc('uRes'), res[0], res[1]);
    gl.uniform2f(loc('uOffset'), off[0], off[1]);
    gl.uniform1f(loc('uPhase'), phase);
    gl.uniform1f(loc('uSS'), ss);
    for (const d of CG.allParams(fn)) {
      if (!d.u) continue;
      const v = params[d.key];
      if (d.type === 'color') gl.uniform3fv(loc(d.u), CG.util.hexToRgb(v));
      else if (d.type === 'angle') gl.uniform1f(loc(d.u), v * Math.PI / 180);
      else gl.uniform1f(loc(d.u), d.map ? d.map(v) : +v);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(loc('uImg'), 0);
    gl.uniform1f(loc('uImgOn'), this.img.on);
    gl.uniform1f(loc('uImgAspect'), this.img.aspect);
    gl.uniform1f(loc('uImgTexH'), this.img.h);
    gl.uniform1f(loc('uImgOverlay'), fn.usesImage ? 0 : 1);
    if (fn.bind) fn.bind(gl, loc, params, phase, this, res);   // funktionseigene Daten (Texturen, Kamera)
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
};
