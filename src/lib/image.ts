/** Стискає фото до невеликого JPEG (data URL), щоб воно зручно зберігалось у базі. */
export async function photoToDataUrl(file: File, maxSide = 400, maxChars = 140_000): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('image'));
      el.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    for (const q of [0.72, 0.6, 0.48, 0.36]) {
      const data = canvas.toDataURL('image/jpeg', q);
      if (data.length <= maxChars) return data;
    }
    throw new Error('too_big');
  } finally {
    URL.revokeObjectURL(url);
  }
}
