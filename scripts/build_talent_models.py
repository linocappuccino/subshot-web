"""Build a talent (woman / man) for the Subshot light plot from MakeHuman CC0 assets, pure numpy (no Blender).
usage: mh_build.py <female|male> <standing|sitting> <assets_dir> <base_dir> <out.glb>
  - base mesh hm08 + macro targets (caucasian young, ideal proportions), arms lowered from the A-pose,
    optional sitting pose (hip + knee bend by smooth region weights)
  - proxies fitted with the .mhclo rules (3 base vertices + weights + scaled offsets): eyes, eyebrows,
    eyelashes, hair, clothes, shoes; body parts under the clothes deleted (delete_verts)
  - metres, y up, facing +x, feet at y = 0; one glb with a node per part, quantised attributes, JPEG / PNG textures"""
import sys, os, io, json, struct, re
import numpy as np
from PIL import Image

SEX, POSE, AS, BASE, OUT = sys.argv[1:6]
PARTS = {
    "female": dict(skin="skins/young_caucasian_female2", hair="hair/ponytail01", clothes="clothes/female_elegantsuit01", brows="eyebrows/eyebrow001"),
    "male": dict(skin="skins/young_caucasian_male", hair="hair/short02", clothes="clothes/male_casualsuit01", brows="eyebrows/eyebrow001"),
}[SEX]


def read_obj(path):
    V, VT, groups, faces = [], [], {}, []
    g = None
    for line in open(path, encoding="utf-8", errors="ignore"):
        if line.startswith("v "):
            V.append([float(x) for x in line.split()[1:4]])
        elif line.startswith("vt "):
            VT.append([float(x) for x in line.split()[1:3]])
        elif line.startswith("g "):
            g = line.split()[1]
        elif line.startswith("f "):
            idx = []
            for tok in line.split()[1:]:
                p = tok.split("/")
                idx.append((int(p[0]) - 1, int(p[1]) - 1 if len(p) > 1 and p[1] else -1))
            faces.append((g, idx))
    return np.array(V, np.float64), np.array(VT, np.float64) if VT else np.zeros((0, 2)), faces


def read_target(path, n):
    d = np.zeros((n, 3))
    for line in open(path):
        if line.startswith("#") or not line.strip():
            continue
        p = line.split()
        d[int(p[0])] = [float(p[1]), float(p[2]), float(p[3])]
    return d


def read_mhclo(path):
    info = {"verts": [], "delete": set()}
    mode = None
    for line in open(path, encoding="utf-8", errors="ignore"):
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        p = s.split()
        if p[0] in ("x_scale", "y_scale", "z_scale"):
            info[p[0]] = (int(p[1]), int(p[2]), float(p[3])); continue
        if p[0] in ("obj_file", "material", "name"):
            info[p[0]] = p[1]; continue
        if p[0] == "verts":
            mode = "verts"; continue
        if p[0] == "delete_verts":
            mode = "delete"; continue
        if p[0] in ("weights", "uuid", "basemesh", "tag", "z_depth", "max_pole", "special_pose", "offsets"):
            mode = None if p[0] != "weights" else "skip"; continue
        if mode == "verts":
            if len(p) == 1:
                info["verts"].append(((int(p[0]), 0, 0), (1.0, 0.0, 0.0), (0.0, 0.0, 0.0)))
            elif len(p) >= 9:
                info["verts"].append(((int(p[0]), int(p[1]), int(p[2])), tuple(map(float, p[3:6])), tuple(map(float, p[6:9]))))
        elif mode == "delete":
            toks = s.replace(" - ", "-").split()
            for t in toks:
                if "-" in t:
                    a, b = t.split("-"); info["delete"].update(range(int(a), int(b) + 1))
                elif t.isdigit():
                    info["delete"].add(int(t))
    return info


def fit(info, V, Vs=None):
    Vs = V if Vs is None else Vs
    def sc(k, ax):
        if k not in info:
            return 1.0
        i, j, d = info[k]
        return abs(Vs[i, ax] - Vs[j, ax]) / d
    s = np.array([sc("x_scale", 0), sc("y_scale", 1), sc("z_scale", 2)])
    out = []
    for (a, b, c), (wa, wb, wc), off in info["verts"]:
        out.append(wa * V[a] + wb * V[b] + wc * V[c] + np.array(off) * s)
    return np.array(out)


def mat_tex(mhmat_path, key="diffuseTexture"):
    d = os.path.dirname(mhmat_path)
    for line in open(mhmat_path, encoding="utf-8", errors="ignore"):
        p = line.split()
        if len(p) >= 2 and p[0] == key:
            return os.path.normpath(os.path.join(d, p[1]))
    return None


# ── base + targets ──
V0, VT0, F0 = read_obj(os.path.join(BASE, "base.obj"))
n = len(V0)
V = V0.copy()
for t in (f"caucasian-{SEX}-young.target", f"universal-{SEX}-young-averagemuscle-averageweight.target",
          f"{SEX}-young-averagemuscle-averageweight-idealproportions.target"):
    V += read_target(os.path.join(BASE, t), n) * (0.5 if "proportions" in t else 1.0)


def joint(name):
    idx = sorted({vi for g, f in F0 if g == f"joint-{name}" for vi, _ in f})
    return V[idx].mean(0)


def joint_now(name, Vc):
    idx = sorted({vi for g, f in F0 if g == f"joint-{name}" for vi, _ in f})
    return Vc[idx].mean(0)


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def rot_about(P, origin, axis, ang):
    """rotate points P (k×3) about axis through origin by per-point angles ang (k)"""
    axis = axis / np.linalg.norm(axis)
    p = P - origin
    c, s = np.cos(ang)[:, None], np.sin(ang)[:, None]
    cross = np.cross(axis, p)
    dot = (p @ axis)[:, None]
    return origin + p * c + cross * s + axis * dot * (1 - c)


# ── arms down from the A-pose: a vertex belongs to the arm by its distance to the arm bones (shoulder → elbow →
#    hand → fingertips) compared with the torso / legs; the weight fades in across the shoulder ──
def seg_dist(P, a, b):
    ab = b - a
    t = np.clip(((P - a) @ ab) / (ab @ ab), 0, 1)
    return np.linalg.norm(P - (a + t[:, None] * ab), axis=1), t


ARMW = np.zeros(n)
for side in ("l", "r"):
    sh, el, ha = joint(f"{side}-shoulder"), joint(f"{side}-elbow"), joint(f"{side}-hand")
    tip = ha + (ha - el) * 0.55
    d1, t1 = seg_dist(V, sh, el)
    d2, _ = seg_dist(V, el, ha)
    d3, _ = seg_dist(V, ha, tip)
    d_arm = np.minimum(np.minimum(d1, d2), d3)
    # torso: the spine line; legs: hip → knee → ankle of both sides
    spine = [joint("pelvis"), joint("spine-1"), joint("spine-3"), joint("head")]
    d_body = np.min([seg_dist(V, spine[k], spine[k + 1])[0] for k in range(3)], axis=0)
    for s2 in ("l", "r"):
        d_body = np.minimum(d_body, seg_dist(V, joint(f"{s2}-upper-leg"), joint(f"{s2}-knee"))[0])
        d_body = np.minimum(d_body, seg_dist(V, joint(f"{s2}-knee"), joint(f"{s2}-ankle"))[0])
    member = smooth(0.0, 0.35, d_body - d_arm - 0.25)          # clearly closer to the arm than to the body
    fade = smooth(0.0, 0.35, t1 + (d1 > d2) * 1.0)             # fades in from the shoulder joint
    w = member * fade
    ARMW = np.maximum(ARMW, member)
    arm = el - sh
    sgn = np.sign(arm[0])
    cur = np.arctan2(abs(arm[0]), -arm[1])
    target = np.radians(4)
    V = rot_about(V, sh, np.array([0, 0, 1.0]), -(cur - target) * w * sgn)
    # forearm: the A-pose angles it further out — bring the hand in next to the thigh (rotate about the elbow)
    el2, ha2 = joint_now(f"{side}-elbow", V), joint_now(f"{side}-hand", V)
    fa = ha2 - el2
    cur2 = np.arctan2(abs(fa[0]), -fa[1])
    d2b, t2 = seg_dist(V, el2, ha2)
    w2 = member * smooth(-0.15, 0.25, t2 + (d2b > d1) * 0.0) * (seg_dist(V, sh, el2)[1] > 0.6)
    V = rot_about(V, el2, np.array([0, 0, 1.0]), -(cur2 - np.radians(2)) * w2 * sgn)

V_REST = V.copy()   # proxies take their scale from the standing body (a bent leg must not stretch the shoes)
# ── sitting: thighs forward (hip axis), shins down again (knee axis) ──
if POSE == "sitting":
    for side in ("l", "r"):
        hip, knee = joint(f"{side}-upper-leg"), joint(f"{side}-knee")
        sidesel = (np.sign(V[:, 0]) == np.sign(hip[0])) | (abs(V[:, 0]) < 0.05)
        legw = smooth(hip[1] + 0.6, hip[1] - 0.9, V[:, 1]) * sidesel * (abs(V[:, 0] - hip[0]) < 2.2) * (1 - ARMW)
        V = rot_about(V, hip, np.array([1.0, 0, 0]), -np.radians(88) * legw)
        knee2 = rot_about(knee[None], hip, np.array([1.0, 0, 0]), np.array([-np.radians(88)]))[0]
        # below the knee (in the rotated frame: further forward than the knee along +z)
        kw = smooth(knee2[2] - 0.5, knee2[2] + 0.5, V[:, 2]) * legw   # the foot points up here — no height limit
        V = rot_about(V, knee2, np.array([1.0, 0, 0]), np.radians(88) * kw)

# ── assemble parts ──
parts = []   # (name, positions (k×3), uvs (k×2), tris (m×3), texture path, alpha)


def tri_from_faces(faces, V, VT):
    keymap, P, U, T = {}, [], [], []
    for _, f in faces:
        ids = []
        for vi, ti in f:
            k = (vi, ti)
            if k not in keymap:
                keymap[k] = len(P); P.append(V[vi]); U.append(VT[ti] if ti >= 0 else (0, 0))
            ids.append(keymap[k])
        for i in range(1, len(ids) - 1):
            T.append((ids[0], ids[i], ids[i + 1]))
    return np.array(P), np.array(U), np.array(T, np.int64)


# clothes first: which body vertices they hide
cl_info = read_mhclo(os.path.join(AS, PARTS["clothes"], os.path.basename(PARTS["clothes"]) + ".mhclo"))
sh_info = read_mhclo(os.path.join(AS, "clothes/shoes01/shoes01.mhclo"))
hidden = cl_info["delete"] | sh_info["delete"]
body_faces = [(g, f) for g, f in F0 if g == "body" and not any(vi in hidden for vi, _ in f)]
P, U, T = tri_from_faces(body_faces, V, VT0)
skin_tex = os.path.join(AS, PARTS["skin"], [x for x in os.listdir(os.path.join(AS, PARTS["skin"])) if x.endswith(".png")][0])
parts.append(("body", P, U, T, skin_tex, False))


def proxy(rel, mhclo_name=None, alpha=False, tex=None, rigid_feet=False):
    d = os.path.join(AS, rel)
    name = mhclo_name or os.path.basename(rel)
    info = read_mhclo(os.path.join(d, name + ".mhclo"))
    PV, PVT, PF = read_obj(os.path.join(d, info.get("obj_file", name + ".obj")))
    if rigid_feet and POSE == "sitting":
        # shoes hang on the helper tights, whose offsets assume a standing foot: fit them standing, then move each
        # shoe rigidly with its foot (best-fit rotation + translation of the body's foot vertices, rest → seated)
        fitted = fit(info, V_REST, V_REST)
        body_idx = np.array(sorted({vi for g, f in F0 if g == "body" for vi, _ in f}))
        for sgn in (-1, 1):
            foot = body_idx[(V_REST[body_idx, 1] < V_REST[:, 1].min() + 1.2) & (np.sign(V_REST[body_idx, 0]) == sgn)]
            A, B = V_REST[foot], V[foot]
            ca, cb = A.mean(0), B.mean(0)
            U_, _, Wt = np.linalg.svd((A - ca).T @ (B - cb))
            R = (U_ @ Wt).T
            if np.linalg.det(R) < 0:
                Wt[-1] *= -1; R = (U_ @ Wt).T
            sel = np.sign(fitted[:, 0]) == sgn
            fitted[sel] = (fitted[sel] - ca) @ R.T + cb
    else:
        fitted = fit(info, V, V_REST)
    P, U, T = tri_from_faces(PF, fitted, PVT)
    if tex is None and info.get("material"):
        tex = mat_tex(os.path.normpath(os.path.join(d, info["material"])))
    parts.append((name, P, U, T, tex, alpha))


proxy("eyes/high-poly", alpha=True)   # the cornea layer is transparent in the eye texture
proxy(PARTS["brows"], alpha=True)
proxy("eyelashes/eyelashes01", alpha=True)
proxy(PARTS["hair"], alpha=True)
proxy(PARTS["clothes"])
proxy("clothes/shoes01", rigid_feet=True)

# ── units / orientation: dm → m, MakeHuman faces +z → our figure faces +x; feet on the floor ──
allP = np.vstack([p[1] for p in parts])
floor = allP[:, 1].min()
out_parts = []
for name, P, U, T, tex, alpha in parts:
    Q = np.stack([P[:, 2], P[:, 1] - floor, -P[:, 0]], 1) * 0.1
    out_parts.append((name, Q.astype(np.float32), U.astype(np.float32), T, tex, alpha))
height = max(p[1][:, 1].max() for p in out_parts if p[0] in ("body",))
# seat height (sitting): the lowest body point behind the knees — where a chair seat must be
bodyQ = next(p[1] for p in out_parts if p[0] == "body")
lowQ = np.vstack([p[1] for p in out_parts if p[0] in ("body", PARTS["clothes"].split("/")[-1])])
lowQ = lowQ[(lowQ[:, 1] > 0.25) & (lowQ[:, 1] < 0.75)]
seat = float(np.percentile(lowQ[lowQ[:, 0] < lowQ[:, 0].min() + 0.2, 1], 1)) if POSE == "sitting" and len(lowQ) else 0.0
# eye height (for the face meter / close-up camera)
eyeQ = next(p[1] for p in out_parts if p[0] == "high-poly")
eye_y = float(eyeQ[:, 1].mean())
print(f"{SEX} {POSE}: height {height:.3f} m, parts", [(p[0], len(p[1]), len(p[3])) for p in out_parts])


# ── normals ──
def normals(P, T):
    N = np.zeros_like(P, dtype=np.float64)
    fn = np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]])
    for k in range(3):
        np.add.at(N, T[:, k], fn)
    N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-12
    return N.astype(np.float32)


# ── glb writer: quantised positions (int16 per node, KHR_mesh_quantization), int8 normals, uint16 uvs ──
def img_bytes(path, maxsize, alpha):
    im = Image.open(path)
    im = im.convert("RGBA" if alpha else "RGB")
    if max(im.size) > maxsize:
        im.thumbnail((maxsize, maxsize), Image.LANCZOS)
    b = io.BytesIO()
    if alpha:
        im.save(b, "PNG", optimize=True); return b.getvalue(), "image/png"
    im.save(b, "JPEG", quality=82, optimize=True); return b.getvalue(), "image/jpeg"


TEX_MAX = {"body": 1024, "high-poly": 512, "eyebrow001": 256, "eyelashes01": 256}
bin_ = b""; views = []; accessors = []; meshes = []; nodes = []; images = []; textures = []; materials = []


def add_view(data, target=None):
    global bin_
    pad = (-len(bin_)) % 4
    bin_ += b"\0" * pad
    v = {"buffer": 0, "byteOffset": len(bin_), "byteLength": len(data)}
    if target:
        v["target"] = target
    bin_ += data
    views.append(v)
    return len(views) - 1


for name, P, U, T, tex, alpha in out_parts:
    N = normals(P, T)
    lo, hi = P.min(0), P.max(0)
    span = np.maximum(hi - lo, 1e-6)
    q = np.round((P - lo) / span * 65535 - 32768).astype(np.int16)
    qpad = np.zeros((len(q), 4), np.int16); qpad[:, :3] = q          # 4-byte alignment per vertex
    nq = np.round(N * 127).astype(np.int8); npad = np.zeros((len(nq), 4), np.int8); npad[:, :3] = nq
    uq = np.round(np.clip(np.stack([U[:, 0], 1 - U[:, 1]], 1), 0, 1) * 65535).astype(np.uint16)
    idx = T.astype(np.uint16 if len(P) < 65535 else np.uint32).ravel()
    a0 = len(accessors)
    accessors += [
        {"bufferView": add_view(qpad.tobytes(), 34962), "byteOffset": 0, "componentType": 5122, "normalized": True, "count": len(q), "type": "VEC3",
         "min": q.min(0).tolist(), "max": q.max(0).tolist()},   # raw component units (the loader normalises them)
        {"bufferView": add_view(npad.tobytes(), 34962), "componentType": 5120, "normalized": True, "count": len(q), "type": "VEC3"},
        {"bufferView": add_view(uq.tobytes(), 34962), "componentType": 5123, "normalized": True, "count": len(q), "type": "VEC2"},
        {"bufferView": add_view(idx.tobytes(), 34963), "componentType": 5123 if idx.dtype == np.uint16 else 5125, "count": len(idx), "type": "SCALAR"},
    ]
    views[accessors[a0]["bufferView"]]["byteStride"] = 8
    views[accessors[a0 + 1]["bufferView"]]["byteStride"] = 4
    rough = {"body": 0.72, "high-poly": 0.08}.get(name, 0.85)     # glossy eyes → catchlights of the lamps
    mat = {"name": name, "pbrMetallicRoughness": {"metallicFactor": 0, "roughnessFactor": rough}, "doubleSided": alpha}
    if tex and os.path.exists(tex):
        data, mime = img_bytes(tex, TEX_MAX.get(name, 512), alpha)
        images.append({"bufferView": add_view(data), "mimeType": mime})
        textures.append({"source": len(images) - 1, "sampler": 0})
        mat["pbrMetallicRoughness"]["baseColorTexture"] = {"index": len(textures) - 1}
    if alpha:
        mat["alphaMode"] = "MASK"; mat["alphaCutoff"] = 0.45 if name.startswith("eyebrow") else 0.35
    if name.startswith("eyebrow"):
        mat["pbrMetallicRoughness"]["baseColorFactor"] = [0.55, 0.42, 0.33, 1]
    materials.append(mat)
    meshes.append({"name": name, "primitives": [{"attributes": {"POSITION": a0, "NORMAL": a0 + 1, "TEXCOORD_0": a0 + 2}, "indices": a0 + 3, "material": len(materials) - 1}]})
    # node transform undoes the quantisation: p = lo + (q/32767 … ) — normalized int16 maps to [-1, 1]
    scale = (span / 2 * 65535 / 65534).tolist()
    trans = (lo + span / 2 + span / 65534 / 2 * 0).tolist()
    nodes.append({"name": name, "mesh": len(meshes) - 1, "scale": scale, "translation": trans})

gl = {"asset": {"version": "2.0", "generator": "subshot mh_build (MakeHuman CC0 assets)", "copyright": "MakeHuman assets, CC0 1.0 (makehumancommunity.org)"},
      "extensionsUsed": ["KHR_mesh_quantization"], "extensionsRequired": ["KHR_mesh_quantization"],
      "scene": 0, "scenes": [{"nodes": list(range(len(nodes)))}], "nodes": nodes, "meshes": meshes, "materials": materials,
      "accessors": accessors, "bufferViews": views, "buffers": [{"byteLength": len(bin_)}],
      "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071}], "textures": textures, "images": images,
      "extras": {"height_m": round(float(height), 3), "seat_m": round(seat, 3), "eye_m": round(eye_y, 3), "sex": SEX, "pose": POSE}}
js = json.dumps(gl, separators=(",", ":")).encode(); js += b" " * ((-len(js)) % 4)
bin_ += b"\0" * ((-len(bin_)) % 4)
open(OUT, "wb").write(struct.pack("<III", 0x46546C67, 2, 28 + len(js) + len(bin_)) + struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(bin_), 0x004E4942) + bin_)
print("wrote", OUT, os.path.getsize(OUT), "bytes")
