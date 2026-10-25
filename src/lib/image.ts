// Perkecil foto di perangkat sebelum diunggah: sisi terpanjang dibatasi dan dikodekan ulang JPEG.
// Foto dari kamera HP (3–8 MB) menjadi sekitar 200–500 KB sehingga muat di sinyal site.
export async function shrinkImage(file: File, maxSide = 1280, quality = 0.78): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') return file;
  if (file.size < 250 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file; // format tak terbaca peramban: kirim apa adanya
  }
}
