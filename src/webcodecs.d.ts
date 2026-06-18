/**
 * Type declarations for browser APIs not in lib.dom.d.ts v5.4.
 * Remove once TypeScript catches up.
 */

declare global {
  // === ImageDecoder — WebCodecs API ===

  interface ImageDecoderInit {
    type: string;
    data: BufferSource;
  }

  interface ImageDecoderResult {
    image: VideoFrame;
    decodedFrames: number;
    complete: boolean;
  }

  interface ImageDecoderConstructorOptions {
    data: BufferSource;
    type: string;
  }

  class ImageClosedReason extends Error {}

  interface ImageDecodeOptions {
    frameIndex?: number;
  }

  interface ImageDecodeResult {
    image: VideoFrame;
    frame: {
      codedWidth: number;
      codedHeight: number;
      codedRect?: DOMRectReadOnly;
      visibleRect?: DOMRectReadOnly;
      displayWidth: number;
      displayHeight: number;
      duration: number | null;
      timestamp: number;
      colorSpace: VideoColorSpace;
    };
  }

  class ImageDecoder {
    static isTypeSupported(type: string): Promise<boolean>;
    constructor(init: ImageDecoderConstructorOptions);
    readonly type: string;
    readonly completed: Promise<ImageDecodeResult>;
    readonly tracks: {
      ready: Promise<void>;
      length: number;
      selectedIndex: number;
    };
    decode(options?: ImageDecodeOptions): Promise<ImageDecodeResult>;
    close(): void;
  }

  // === VideoEncoder — WebCodecs API ===

  interface VideoEncoderConfig {
    codec: string;
    width?: number;
    height?: number;
    bitrate?: number;
    framerate?: number;
  }

  interface VideoEncoderEncodeOptions {
    keyFrame?: boolean;
  }

  interface VideoEncoderInit {
    output: (chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) => void;
    error: (error: DOMException) => void;
  }

  class VideoEncoder {
    static isConfigSupported(config: VideoEncoderConfig): Promise<{ supported: boolean; config?: VideoEncoderConfig }>;
    constructor(init: VideoEncoderInit);
    configure(config: VideoEncoderConfig): void;
    encode(chunk: VideoFrame, options?: VideoEncoderEncodeOptions): void;
    flush(): Promise<void>;
    close(): void;
    readonly state: 'unconfigured' | 'configured' | 'closed';
  }

  // === Navigator extras (Network Information API, Device Memory API) ===

  interface NavigatorNetworkInformation {
    saveData: boolean;
    effectiveType: 'slow-2g' | '2g' | '3g' | '4g' | '5g';
    addEventListener(type: string, listener: EventListener): void;
    removeEventListener(type: string, listener: EventListener): void;
  }

  interface NavigatorDeviceMemory {
    deviceMemory: number; // GB, rounded to 0.25/0.5/1/2/4/8
  }

  // Augment built-in Navigator with optional extras (typed access without `as any`)
  interface Navigator {
    connection?: NavigatorNetworkInformation;
    deviceMemory?: number;
  }
}

export {};
