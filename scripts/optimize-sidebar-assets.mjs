import { createCanvas, loadImage } from '@napi-rs/canvas';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Keep supplied PNG originals; these are delivery copies with the same composition.
for (const [name, maxWidth] of [
  ['kpi-sidebar-background', 1881],
  ['kpi-sidebar-background-day', 1881],
  ['kpi-holding-transparent', 640],
  ['holding-5040-collapsed', 640],
]) {
  const source = await loadImage(`src/assets/${name}.png`);
  const width = Math.min(source.width, maxWidth);
  const canvas = createCanvas(width, Math.round(source.height * width / source.width));
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const bytes = canvas.toBuffer('image/webp', 95);
  await writeFile(`src/assets/${name}.webp`, bytes);
  console.log(`${name}.webp ${canvas.width}x${canvas.height} ${bytes.length} bytes v=${createHash('sha256').update(bytes).digest('hex').slice(0,12)}`);
}
