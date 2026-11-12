/**
 * 2026-11-12, Lino: «🎙️ Live-Dubbing» — the recording engine.
 *
 * - getUserMedia with echoCancellation / noiseSuppression / autoGainControl OFF (a clean voice, no pumping)
 * - an AudioWorklet copies the raw PCM (Float32) to the main thread — no MediaRecorder compression
 * - WAV 48 kHz / 24-bit / mono
 * - latency compensation: the speaker reacts to what they SEE and HEAR, which reaches them `outputLatency`
 *   late, and their voice reaches us `input latency` late → the take is trimmed by both, so it lines up
 *   with the picture
 * - every finished take is first kept in IndexedDB (a crash / network loss loses nothing), then uploaded
 */

export const RATE = 48000;

const WORKLET = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.on = false; this.port.onmessage = (e) => { this.on = e.data === "on"; }; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && this.on) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("dub-tap", Tap);
`;

export type MicInfo = { deviceId: string; label: string; bluetooth: boolean };

const BT = /bluetooth|airpods|buds|hands-?free|headset \(|bt\b|beats|jabra|bose|sony wh|wf-/i;

export async function listMics(): Promise<MicInfo[]> {
  // labels only after a permission grant
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
  } catch {
    // no permission: the list stays without labels
  }
  const devs = await navigator.mediaDevices.enumerateDevices();
  return devs
    .filter((d) => d.kind === "audioinput")
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Mikrofon ${i + 1}`, bluetooth: BT.test(d.label) }));
}

export class DubRecorder {
  ctx: AudioContext | null = null;
  stream: MediaStream | null = null;
  analyser: AnalyserNode | null = null;
  private node: AudioWorkletNode | null = null;
  private chunks: Float32Array[] = [];
  private captured = 0;
  private markAt: number | null = null;

  async open(deviceId: string | null) {
    this.close();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
        sampleRate: RATE,
      },
    });
    this.ctx = new AudioContext({ sampleRate: RATE, latencyHint: "interactive" });
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    await this.ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    src.connect(this.analyser);
    this.node = new AudioWorkletNode(this.ctx, "dub-tap", { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1 });
    this.node.port.onmessage = (e) => {
      const c = e.data as Float32Array;
      this.chunks.push(c);
      this.captured += c.length;
    };
    src.connect(this.node);
  }

  /** 0…1 peak of the last block (level meter) */
  level(): number {
    if (!this.analyser) return 0;
    const buf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);
    let peak = 0;
    for (const v of buf) peak = Math.max(peak, Math.abs(v));
    return peak;
  }

  /** seconds the take is shifted by (output + input latency) */
  latency(): number {
    if (!this.ctx) return 0;
    const track = this.stream?.getAudioTracks()[0];
    const inLat = Number((track?.getSettings() as MediaTrackSettings & { latency?: number })?.latency ?? 0) || 0;
    const outLat = Number((this.ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0) || 0;
    return outLat + (this.ctx.baseLatency || 0) + inLat;
  }

  /** three beeps, one per second (resolves at the downbeat) */
  async countIn(onTick: (n: number) => void) {
    if (!this.ctx) return;
    await this.ctx.resume();
    for (const n of [3, 2, 1]) {
      onTick(n);
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.frequency.value = n === 1 ? 1320 : 880;
      g.gain.setValueAtTime(0.25, this.ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.15);
      o.connect(g).connect(this.ctx.destination);
      o.start();
      o.stop(this.ctx.currentTime + 0.16);
      await new Promise((r) => setTimeout(r, 1000));
    }
    onTick(0);
  }

  start() {
    this.chunks = [];
    this.captured = 0;
    this.markAt = null;
    this.node?.port.postMessage("on");
  }

  /** the picture starts NOW (video 'playing') — the take begins here (+ latency) */
  mark() {
    if (this.markAt === null) this.markAt = this.captured;
  }

  /** stop → the take as WAV (trimmed to `maxSeconds` after the mark) */
  stop(maxSeconds: number): { wav: Blob; seconds: number } {
    this.node?.port.postMessage("off");
    const all = new Float32Array(this.captured);
    let o = 0;
    for (const c of this.chunks) {
      all.set(c, o);
      o += c.length;
    }
    const from = Math.min(all.length, (this.markAt ?? 0) + Math.round(this.latency() * RATE));
    const to = Math.min(all.length, from + Math.round(maxSeconds * RATE));
    const pcm = all.subarray(from, to);
    this.chunks = [];
    return { wav: encodeWav24(pcm), seconds: pcm.length / RATE };
  }

  close() {
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.stream = null;
    this.node = null;
    this.analyser = null;
  }
}

export function encodeWav24(pcm: Float32Array): Blob {
  const n = pcm.length;
  const buf = new ArrayBuffer(44 + n * 3);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + n * 3, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 3, true);
  v.setUint16(32, 3, true);
  v.setUint16(34, 24, true);
  str(36, "data");
  v.setUint32(40, n * 3, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    const x = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff);
    v.setUint8(o, x & 0xff);
    v.setUint8(o + 1, (x >> 8) & 0xff);
    v.setUint8(o + 2, (x >> 16) & 0xff);
    o += 3;
  }
  return new Blob([buf], { type: "audio/wav" });
}

// ── IndexedDB backup (a take is never lost before it reached R2) ─────────────

const DB = "subshot-dubbing";
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("takes");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export type PendingTake = { id: string; nodeKey: string; sectionId: string; lang: string; seconds: number; wav: Blob; at: number };
export async function backupTake(t: PendingTake) {
  try {
    const d = await idb();
    await new Promise<void>((res, rej) => {
      const tx = d.transaction("takes", "readwrite");
      tx.objectStore("takes").put(t, t.id);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch {
    // private mode etc.: the upload still runs
  }
}
export async function dropBackup(id: string) {
  try {
    const d = await idb();
    d.transaction("takes", "readwrite").objectStore("takes").delete(id);
  } catch {
    // ignore
  }
}
export async function pendingBackups(nodeKey: string): Promise<PendingTake[]> {
  try {
    const d = await idb();
    return await new Promise((res) => {
      const r = d.transaction("takes").objectStore("takes").getAll();
      r.onsuccess = () => res((r.result as PendingTake[]).filter((t) => t.nodeKey === nodeKey));
      r.onerror = () => res([]);
    });
  } catch {
    return [];
  }
}
