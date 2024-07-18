import { StringKeyValueStore } from "./string-kv-store";

/** Single image resize options */
export interface ImageResizeOptions {
  width?: number,
  height?: number,
  quality?: number,
}

/** Single image resize response */
export interface ResizedImage {
  ext: string,
  width: number,
  height: number,
  data: Buffer,
  hash: string,
}


/** Single image transform options */
export interface ImageTransformOptions {
  resize: ImageResizeOptions,
}

/** Single image transform response */
export interface TransformedImageAsset {
  src: string, 
  width: number, 
  height: number,
}


/* Image set request types */


export interface ImageBreakpoint {
  /** max-width of viewport for this breakpoint to apply, may be null - then this applies to the fallback image */
  maxWidth: number | null,
  /** desired image width at this breakpoint at 1x dpi scaling */
  imageWidth: number,
}

export interface ImageResizeRequest {
  processedImageCacheStore: StringKeyValueStore,
  outputDirectory: string,
  publicPathPrefix: string,
  customOutputNameGenerator?: (rawHash: string, resizedImage: ResizedImage) => string,
  customStorageWriter?: (data: Buffer, outputName: string, outputDirectory: string) => Promise<void>,
  sequential?: boolean,
  sizeThreshold: number,
  inputImage: Buffer | string,
  pixelDensities: number[],
  breakpoints: ImageBreakpoint[],
}


/* Image set response */

export interface ImageResizeResponse {
  imageSet: ImageSet,
  generated: number,
  cached: number,
}

/** single image asset with associated pixel density in context of the image source it appears in */
export interface ImageSetAsset {
  /** image url */
  src: string,
  /** pixel density factor valid in cotext of a image source for particular display size */
  dpi: number,
}

/** source of a picture */
export interface ImageSetSource {
  /** list of images in srcset of this source */
  srcset: ImageSetAsset[],
  /** media query max-width for which this image set will apply */
  w: number,
}

/** picture with sources and fallback image, all having srcset for different dpi */
export interface ImageSet {
  /** list of sources of a picture */
  sources: ImageSetSource[],
  /** source of fallback img tag (contains entire srcset) */
  img: ImageSetAsset[],
  /** aspect ratio for picture to prevent layout shifting */
  aspect: number,
}

