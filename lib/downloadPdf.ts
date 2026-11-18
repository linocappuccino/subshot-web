// 2026-11-18 — download a PDF the API builds on the fly (nothing stored): fetch with auth / unlock headers,
// save as a file with the server's filename (Content-Disposition filename*), fall back to `fallbackName`.
export async function downloadPdf(url: string, headers: Record<string, string>, fallbackName: string): Promise<void> {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); if (typeof j?.detail === "string") msg = j.detail; } catch { /* not json */ }
    throw new Error(msg);
  }
  const cd = res.headers.get("Content-Disposition") || "";
  const m = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  const name = m ? decodeURIComponent(m[1]) : fallbackName;
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}
