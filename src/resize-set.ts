import { createHash } from 'node:crypto'
import { join, sep, dirname } from 'node:path'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { resizeImage } from "./resize-image"
import type { ImageResizeRequest, ImageResizeResponse, ImageSet, ImageSetAsset, ImageSetSource, TransformedImageAsset } from "./types"

const renderDebugSizeOnImages = false;

interface SizeSpec { 
  density: number, 
  width: number, // original target width
  actualWidth: number, // actual transformed width (after consolidation)
}

export async function processImageRequest(request: ImageResizeRequest): Promise<ImageResizeResponse> { 
  if(!request.inputImage) throw new Error("Invalid input image");
  const inputImage = typeof request.inputImage === "string" ? await readFile(request.inputImage) : request.inputImage;
  const promiseAll = request.sequential ? promiseAllSequential : promiseAllPrarallel;
  
  const statsGeneratedUrls = new Map<string, boolean>();
  async function transform(sizeSpec: SizeSpec) {
    const { width: originalTargetWidth, actualWidth } = sizeSpec;
    const debugText = renderDebugSizeOnImages ? JSON.stringify(sizeSpec, null, 4) : undefined;
    const { isCached, data: { src, width, height } } = await transformSingleImage(inputImage, request, actualWidth, debugText);
    statsGeneratedUrls.set(src, isCached);
    const actualDensity = Math.floor((width / originalTargetWidth)*100)/100;
    return { src, width, height, actualDensity };
  }

  const sizeSpecKey = (width: number, density: number) => `${width}@${density}`;
  const consolidatedSizes: Record<string, SizeSpec> = {};

  // Calculate consolidatedSizes
  { 
    const allSizes: SizeSpec[] = [];
    for(let { imageWidth } of request.breakpoints) {
      for(let density of request.pixelDensities) {
        allSizes.push({ width: imageWidth, density, actualWidth: Math.round(imageWidth * density) });
      }
    }

    allSizes.sort(({actualWidth: a}, {actualWidth: b}) => b - a);


    let lastUsedSize: SizeSpec | null = null;
    for(let size of allSizes) {
      if(lastUsedSize !== null && lastUsedSize.actualWidth * request.sizeThreshold <= size.actualWidth) {
        consolidatedSizes[sizeSpecKey(size.width, size.density)] = {
          ...size,
          actualWidth: lastUsedSize.actualWidth,
        };
        continue;
      }
      consolidatedSizes[sizeSpecKey(size.width, size.density)] = size;
      lastUsedSize = size;
    }
  }

  let aspectRatio: { ratio: number, width: number } | null = null;

  async function transformForDensities(breakpointWidth: number) : Promise<ImageSetAsset[]> {
    return getUniqueImages(await promiseAll(request.pixelDensities.map((density) => async () => {
      const sizeSpec = consolidatedSizes[sizeSpecKey(breakpointWidth, density)];
      if(!sizeSpec) throw new Error(`miscalculated consolidatedSizes, no key ${sizeSpecKey(breakpointWidth, density)}`)
      const { src, width, height, actualDensity } = await transform(sizeSpec);
      
      if (aspectRatio === null || aspectRatio.width < width) {
        aspectRatio = { ratio: width / height, width };
      }

      return {
        src,
        dpi: actualDensity,
      }
    })));
  }
  
  const sourceBreakpoints = request.breakpoints.filter(b => b.maxWidth !== null);
  const fallbackBreakpoint = request.breakpoints.find(b => b.maxWidth === null);
  if (!fallbackBreakpoint) {
    throw new Error('Fallback breakpoint (with maxWidth: null) is required');
  }
  
  const sources: ImageSetSource[] = await promiseAll(sourceBreakpoints.map((breakpoint) => async () => ({
    w: breakpoint.maxWidth!,
    srcset: await transformForDensities(breakpoint.imageWidth),
  })));

  const fallbackImages = await transformForDensities(fallbackBreakpoint.imageWidth); 

  const imageSet: ImageSet = {
    sources: sources,
    img: fallbackImages,
    aspect: Math.round(aspectRatio!.ratio * 100000) / 100000,
  };
  
  // Return the complete image set
  return {
    imageSet,
    generated: [...statsGeneratedUrls.values()].filter(x => x).length,
    cached: [...statsGeneratedUrls.values()].filter(x => !x).length,
  };
}


async function transformSingleImage(
  inputImage: Buffer,
  request: ImageResizeRequest,
  maxWidth: number, 
  debugText?: string
): Promise<{ isCached: boolean, data: TransformedImageAsset }> {
  const rawHash = (() => {
    const hash = createHash('sha256');
    hash.update(request.inputImage);
    return hash.digest('hex');
  })();

  const cacheKey = `${rawHash}@${maxWidth}:${debugText||''}`;

  let isCached = true;
  const entry = await request.processedImageCacheStore.getOrCreate(cacheKey, async () => {
    isCached = false;
    const resizedImage = await resizeImage(inputImage, { width: maxWidth }, debugText);
    
    const outputName = request.customOutputNameGenerator?.(rawHash, resizedImage) ?? (() => {
      const { ext, width } = resizedImage;
      const fileDirName = rawHash.substring(0, 2);
      const fileName = `${rawHash.substring(2, 10)}-${Math.floor(width/10)}}${ext}`;
      return join(fileDirName, fileName);
    })();
    
    if(request.customStorageWriter) {
      await request.customStorageWriter(resizedImage.data, outputName, request.outputDirectory);
    }else{
      const outputPath = join(request.outputDirectory, outputName);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, resizedImage.data);
    }

    const entry: TransformedImageAsset = {
      height: resizedImage.height, 
      width: resizedImage.width, 
      src: `${request.publicPathPrefix}/${outputName.split(sep).join('/')}`
    }
    return JSON.stringify(entry);
  });

  if(!entry) throw new Error("Could not process image");

  return {
    isCached,
    data: JSON.parse(entry) as TransformedImageAsset,
  };
}

function getUniqueImages(images: ImageSetAsset[]): ImageSetAsset[] {
  const uniqueImages: ImageSetAsset[] = [];
  const seenWidths: Set<string> = new Set();
  
  for (const image of images) {
    const key = `${image.src}`;
    if (!seenWidths.has(key)) {
      uniqueImages.push(image);
      seenWidths.add(key);
    }
  }
  
  return uniqueImages;
}

async function promiseAllSequential<T>(promiseFactories: (() => Promise<T>)[]): Promise<T[]> {
  const ret: T[] = [];
  for(let i in promiseFactories) {
    ret.push(await promiseFactories[i]());
  }
  return ret;
}

async function promiseAllPrarallel<T>(promiseFactories: (() => Promise<T>)[]): Promise<T[]> {
  return await Promise.all(promiseFactories.map(x => x()))
}
