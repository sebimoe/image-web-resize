import { createHash } from 'node:crypto';
import imageminWebp, { type Options as ImageminOptions } from 'imagemin-webp';
import sharp from 'sharp';

import type { ImageResizeOptions, ResizedImage } from './types';

export async function resizeImage(
  rawData: Buffer, 
  options: ImageResizeOptions = {}, 
  debugText?: string
): Promise<ResizedImage> {
  const imageminOptions: ImageminOptions = {
    quality: options.quality || 85,
    method: 6,
    preset: 'photo',
  };

  if(options.width || options.height) {
    imageminOptions.resize = {
      width: options.width || 0,
      height: options.height || 0,
    };
  }
  
  if(debugText) {
    const img = sharp(rawData);
    const { width, height } = await img.metadata();
    if(!width || !height) {
      throw new Error("Expected width and height in image metadata.");
    }else{
      const svgImage = `<svg width="${width}" height="${height}">
        <style>.title { fill: white; font-size: ${width/35}px; font-weight: bold; font-family: monospace; }</style>
        <filter id="shadow"><feDropShadow dx="0" dy="0" stdDeviation="15" flood-color="black"/></filter>
        <text filter="url(#shadow)" y="1em" text-anchor="left" class="title">
        ${debugText.split('\n').map(line => `<tspan x="${1 + 0.5*(/^ */.exec(line)![0].length)}em" dy="1.2em">${line.replace(/^ */, '')}</tspan>`).join('\n')}
        </text>
      </svg>`;
      rawData = await img.composite([{
        input: Buffer.from(svgImage), 
        top: 0, left: 0,
      }]).toBuffer();
    }
  }

  const minifyWebp = imageminWebp(imageminOptions);
  const resizedData = await minifyWebp(rawData);

  const hash = createHash('sha256');
  hash.update(resizedData);

  const img = sharp(resizedData);
  const { format: formatId, width, height } = await img.metadata();

  if(!formatId) throw new Error("Cannot parse resulting file - unknown output file extension");

  const extensions = sharp.format[formatId].input.fileSuffix;
  const ext = extensions?.length ? extensions[0] : `.${formatId}`;

  if(!width || !height) throw new Error("Cannot transform image, unknown output width or height.");

  return {
    ext,
    width,
    height,
    data: Buffer.from(resizedData),
    hash: hash.digest('hex'),
  };
}

