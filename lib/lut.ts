// 2026-09-29 — client-only LUT pipeline, from linocappuccino.com's LUT Previewer; used by the board's LUT preview node (2026-10-11).
//
// "Richtig angewendet" in practice means three things, each easy to get subtly wrong:
//  1. The LOG image's pixel values must reach the LUT untouched — no browser colour management,
//     no ICC/Display-P3 conversion, no premultiplied alpha, EXIF orientation honoured. That's why
//     decoding goes through createImageBitmap({ colorSpaceConversion: "none" }) and the WebGL
//     upload disables UNPACK_COLORSPACE_CONVERSION, instead of a plain <img> + 2D canvas.
//  2. The .cube file is parsed per the Adobe/Resolve spec: red changes fastest, DOMAIN_MIN/MAX
//     (and Resolve's LUT_3D_INPUT_RANGE) respected, 1D and 3D both supported.
//  3. Interpolation is trilinear on exact float texel fetches (not the GPU's own linear filter,
//     which on many GPUs only has 8 bits of weight precision and bands visibly) — trilinear is
//     also DaVinci Resolve's default 3D LUT interpolation, so the result matches what Lino sees
//     there.
// Both the LOG and the graded version go through the SAME render path (mode 0 = passthrough), so
// the two halves of the slider are guaranteed to differ only by the LUT itself.

export type ParsedLut = {
  kind: "1d" | "3d";
  size: number;
  data: Float32Array; // RGB triplets, .cube order (red fastest)
  domainMin: [number, number, number];
  domainMax: [number, number, number];
};

export function parseCubeLut(text: string): ParsedLut {
  let size3d = 0;
  let size1d = 0;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  const values: number[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const keyword = parts[0].toUpperCase();

    if (/^[-+.\d]/.test(parts[0])) {
      if (parts.length < 3) throw new Error("LUT-Datei ist beschädigt (ungültige Datenzeile).");
      values.push(Number(parts[0]), Number(parts[1]), Number(parts[2]));
      continue;
    }
    switch (keyword) {
      case "LUT_3D_SIZE":
        size3d = parseInt(parts[1], 10);
        break;
      case "LUT_1D_SIZE":
        size1d = parseInt(parts[1], 10);
        break;
      case "DOMAIN_MIN":
        domainMin = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
        break;
      case "DOMAIN_MAX":
        domainMax = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
        break;
      // Resolve-specific single-value variant of DOMAIN_MIN/MAX.
      case "LUT_3D_INPUT_RANGE":
      case "LUT_1D_INPUT_RANGE": {
        const lo = Number(parts[1]);
        const hi = Number(parts[2]);
        domainMin = [lo, lo, lo];
        domainMax = [hi, hi, hi];
        break;
      }
      default:
        // TITLE and any vendor keyword — irrelevant for applying the LUT.
        break;
    }
  }

  if (values.some((v) => !Number.isFinite(v))) throw new Error("LUT-Datei enthält ungültige Zahlen.");

  if (size3d > 0) {
    if (size3d < 2 || size3d > 256) throw new Error(`Ungültige 3D-LUT-Grösse (${size3d}).`);
    if (values.length !== size3d ** 3 * 3) {
      throw new Error(`LUT-Datei unvollständig: ${values.length / 3} statt ${size3d ** 3} Einträge.`);
    }
    return { kind: "3d", size: size3d, data: new Float32Array(values), domainMin, domainMax };
  }
  if (size1d > 0) {
    if (size1d < 2) throw new Error(`Ungültige 1D-LUT-Grösse (${size1d}).`);
    if (values.length !== size1d * 3) {
      throw new Error(`LUT-Datei unvollständig: ${values.length / 3} statt ${size1d} Einträge.`);
    }
    return { kind: "1d", size: size1d, data: new Float32Array(values), domainMin, domainMax };
  }
  throw new Error("Keine gültige .cube-Datei (LUT_3D_SIZE / LUT_1D_SIZE fehlt).");
}

export function lutNameFromFileName(fileName: string): string {
  return fileName.replace(/\.cube$/i, "").trim() || "LUT";
}

const VERTEX_SHADER = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  // Flip Y here instead of via UNPACK_FLIP_Y (which is ignored for ImageBitmap uploads in some
  // browsers) so the canvas reads out top-down, same orientation as the source.
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler3D;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uImage;
uniform sampler3D uLut3d;
uniform sampler2D uLut1d;
uniform int uMode;       // 0 = passthrough, 1 = 3D LUT, 2 = 1D LUT
uniform int uSize;
uniform int uLut1dWidth; // 1D LUTs are wrapped into rows of this width
uniform vec3 uDomainMin;
uniform vec3 uDomainMax;

vec3 fetch3d(ivec3 p) {
  return texelFetch(uLut3d, p, 0).rgb;
}

vec3 fetch1d(int i) {
  return texelFetch(uLut1d, ivec2(i % uLut1dWidth, i / uLut1dWidth), 0).rgb;
}

float lookup1d(float x, int channel) {
  float pos = x * float(uSize - 1);
  int i0 = int(floor(pos));
  int i1 = min(i0 + 1, uSize - 1);
  float f = pos - float(i0);
  return mix(fetch1d(i0)[channel], fetch1d(i1)[channel], f);
}

void main() {
  vec3 src = texture(uImage, vUv).rgb;
  if (uMode == 0) {
    outColor = vec4(src, 1.0);
    return;
  }
  vec3 x = clamp((src - uDomainMin) / (uDomainMax - uDomainMin), 0.0, 1.0);
  if (uMode == 2) {
    outColor = vec4(lookup1d(x.r, 0), lookup1d(x.g, 1), lookup1d(x.b, 2), 1.0);
    return;
  }
  vec3 pos = x * float(uSize - 1);
  ivec3 i0 = ivec3(floor(pos));
  ivec3 i1 = min(i0 + 1, ivec3(uSize - 1));
  vec3 f = pos - vec3(i0);
  vec3 c00 = mix(fetch3d(ivec3(i0.x, i0.y, i0.z)), fetch3d(ivec3(i1.x, i0.y, i0.z)), f.r);
  vec3 c10 = mix(fetch3d(ivec3(i0.x, i1.y, i0.z)), fetch3d(ivec3(i1.x, i1.y, i0.z)), f.r);
  vec3 c01 = mix(fetch3d(ivec3(i0.x, i0.y, i1.z)), fetch3d(ivec3(i1.x, i0.y, i1.z)), f.r);
  vec3 c11 = mix(fetch3d(ivec3(i0.x, i1.y, i1.z)), fetch3d(ivec3(i1.x, i1.y, i1.z)), f.r);
  vec3 c0 = mix(c00, c10, f.g);
  vec3 c1 = mix(c01, c11, f.g);
  outColor = vec4(clamp(mix(c0, c1, f.b), 0.0, 1.0), 1.0);
}`;

// Long edge cap for the rendered JPEGs — plenty for judging a grade on any screen, keeps each
// upload around 1–3 MB, and stays well under every GPU's max texture size.
const MAX_EDGE = 3840;

export type DecodedImage = { bitmap: ImageBitmap; width: number; height: number };

export async function decodeLogImage(file: File): Promise<DecodedImage> {
  const opts: ImageBitmapOptions = {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
    imageOrientation: "from-image",
  };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, opts);
  } catch {
    throw new Error(`"${file.name}" konnte nicht gelesen werden (JPG, PNG oder WebP verwenden).`);
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  if (scale < 1) {
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const resized = await createImageBitmap(file, { ...opts, resizeWidth: width, resizeHeight: height, resizeQuality: "high" });
    bitmap.close();
    bitmap = resized;
  }
  return { bitmap, width: bitmap.width, height: bitmap.height };
}

type Renderer = {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  imageTex: WebGLTexture;
  lut3dTex: WebGLTexture;
  lut1dTex: WebGLTexture;
};

let renderer: Renderer | null = null;

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`Shader-Fehler: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}

function nearestTexture(gl: WebGL2RenderingContext, target: number) {
  const tex = gl.createTexture()!;
  gl.bindTexture(target, tex);
  gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (target === gl.TEXTURE_3D) gl.texParameteri(target, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  return tex;
}

function getRenderer(): Renderer {
  if (renderer && !renderer.gl.isContextLost()) return renderer;
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false });
  if (!gl) throw new Error("Dieser Browser unterstützt kein WebGL2.");

  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Shader-Fehler: ${gl.getProgramInfoLog(program)}`);
  }
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  // Image texture: LINEAR is fine here (it's sampled 1:1, never scaled).
  const imageTex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, imageTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const lut3dTex = nearestTexture(gl, gl.TEXTURE_3D);
  const lut1dTex = nearestTexture(gl, gl.TEXTURE_2D);

  gl.uniform1i(gl.getUniformLocation(program, "uImage"), 0);
  gl.uniform1i(gl.getUniformLocation(program, "uLut3d"), 1);
  gl.uniform1i(gl.getUniformLocation(program, "uLut1d"), 2);

  renderer = { canvas, gl, program, imageTex, lut3dTex, lut1dTex };
  return renderer;
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Bild konnte nicht erzeugt werden."))), "image/jpeg", 0.92);
  });
}

// Sizes the shared canvas to the image and uploads it as raw code values (no colour conversion).
function prepareImage(image: DecodedImage): Renderer {
  const r = getRenderer();
  const { canvas, gl, program, imageTex } = r;
  canvas.width = image.width;
  canvas.height = image.height;
  gl.viewport(0, 0, image.width, image.height);
  gl.useProgram(program);

  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, imageTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image.bitmap);
  return r;
}

/// Just the image, through the same passthrough as renderLogAndGraded's LOG pass — used for the
/// plain two-image comparison (no LUT), so both sides are encoded exactly like a LOG side.
export async function renderPlain(image: DecodedImage): Promise<Blob> {
  const { canvas, gl, program } = prepareImage(image);
  gl.uniform1i(gl.getUniformLocation(program, "uMode"), 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return canvasToJpeg(canvas);
}

/// Renders the image once untouched (LOG) and once through the LUT, returning both as JPEG blobs
/// of identical size.
export async function renderLogAndGraded(image: DecodedImage, lut: ParsedLut): Promise<{ log: Blob; graded: Blob }> {
  const { canvas, gl, program, lut3dTex, lut1dTex } = prepareImage(image);

  if (lut.kind === "3d") {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, lut3dTex);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB32F, lut.size, lut.size, lut.size, 0, gl.RGB, gl.FLOAT, lut.data);
  } else {
    const width = Math.min(lut.size, 4096);
    const rows = Math.ceil(lut.size / width);
    const padded = new Float32Array(width * rows * 3);
    padded.set(lut.data);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, lut1dTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, width, rows, 0, gl.RGB, gl.FLOAT, padded);
    gl.uniform1i(gl.getUniformLocation(program, "uLut1dWidth"), width);
  }

  gl.uniform1i(gl.getUniformLocation(program, "uSize"), lut.size);
  gl.uniform3fv(gl.getUniformLocation(program, "uDomainMin"), lut.domainMin);
  gl.uniform3fv(gl.getUniformLocation(program, "uDomainMax"), lut.domainMax);
  const uMode = gl.getUniformLocation(program, "uMode");

  gl.uniform1i(uMode, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  const log = await canvasToJpeg(canvas);

  gl.uniform1i(uMode, lut.kind === "3d" ? 1 : 2);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  const graded = await canvasToJpeg(canvas);

  return { log, graded };
}

/// Board LUT preview (2026-10-11): a stored LOG image (fetched back from storage, CORS allowed) →
/// the same raw-pixel decode as a dropped file.
export async function decodeLogBlob(blob: Blob, name = "image.jpg"): Promise<DecodedImage> {
  return decodeLogImage(new File([blob], name, { type: blob.type || "image/jpeg" }));
}
