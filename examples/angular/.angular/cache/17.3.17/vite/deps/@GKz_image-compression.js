import {
  __async,
  __objRest,
  __spreadProps,
  __spreadValues
} from "./chunk-WDMUDEB6.js";

// ../../node_modules/comlink/dist/esm/comlink.mjs
var proxyMarker = Symbol("Comlink.proxy");
var createEndpoint = Symbol("Comlink.endpoint");
var releaseProxy = Symbol("Comlink.releaseProxy");
var finalizer = Symbol("Comlink.finalizer");
var throwMarker = Symbol("Comlink.thrown");
var isObject = (val) => typeof val === "object" && val !== null || typeof val === "function";
var proxyTransferHandler = {
  canHandle: (val) => isObject(val) && val[proxyMarker],
  serialize(obj) {
    const { port1, port2 } = new MessageChannel();
    expose(obj, port1);
    return [port2, [port2]];
  },
  deserialize(port) {
    port.start();
    return wrap(port);
  }
};
var throwTransferHandler = {
  canHandle: (value) => isObject(value) && throwMarker in value,
  serialize({ value }) {
    let serialized;
    if (value instanceof Error) {
      serialized = {
        isError: true,
        value: {
          message: value.message,
          name: value.name,
          stack: value.stack
        }
      };
    } else {
      serialized = { isError: false, value };
    }
    return [serialized, []];
  },
  deserialize(serialized) {
    if (serialized.isError) {
      throw Object.assign(new Error(serialized.value.message), serialized.value);
    }
    throw serialized.value;
  }
};
var transferHandlers = /* @__PURE__ */ new Map([
  ["proxy", proxyTransferHandler],
  ["throw", throwTransferHandler]
]);
function isAllowedOrigin(allowedOrigins, origin) {
  for (const allowedOrigin of allowedOrigins) {
    if (origin === allowedOrigin || allowedOrigin === "*") {
      return true;
    }
    if (allowedOrigin instanceof RegExp && allowedOrigin.test(origin)) {
      return true;
    }
  }
  return false;
}
function expose(obj, ep = globalThis, allowedOrigins = ["*"]) {
  ep.addEventListener("message", function callback(ev) {
    if (!ev || !ev.data) {
      return;
    }
    if (!isAllowedOrigin(allowedOrigins, ev.origin)) {
      console.warn(`Invalid origin '${ev.origin}' for comlink proxy`);
      return;
    }
    const { id, type, path } = Object.assign({ path: [] }, ev.data);
    const argumentList = (ev.data.argumentList || []).map(fromWireValue);
    let returnValue;
    try {
      const parent = path.slice(0, -1).reduce((obj2, prop) => obj2[prop], obj);
      const rawValue = path.reduce((obj2, prop) => obj2[prop], obj);
      switch (type) {
        case "GET":
          {
            returnValue = rawValue;
          }
          break;
        case "SET":
          {
            parent[path.slice(-1)[0]] = fromWireValue(ev.data.value);
            returnValue = true;
          }
          break;
        case "APPLY":
          {
            returnValue = rawValue.apply(parent, argumentList);
          }
          break;
        case "CONSTRUCT":
          {
            const value = new rawValue(...argumentList);
            returnValue = proxy(value);
          }
          break;
        case "ENDPOINT":
          {
            const { port1, port2 } = new MessageChannel();
            expose(obj, port2);
            returnValue = transfer(port1, [port1]);
          }
          break;
        case "RELEASE":
          {
            returnValue = void 0;
          }
          break;
        default:
          return;
      }
    } catch (value) {
      returnValue = { value, [throwMarker]: 0 };
    }
    Promise.resolve(returnValue).catch((value) => {
      return { value, [throwMarker]: 0 };
    }).then((returnValue2) => {
      const [wireValue, transferables] = toWireValue(returnValue2);
      ep.postMessage(Object.assign(Object.assign({}, wireValue), { id }), transferables);
      if (type === "RELEASE") {
        ep.removeEventListener("message", callback);
        closeEndPoint(ep);
        if (finalizer in obj && typeof obj[finalizer] === "function") {
          obj[finalizer]();
        }
      }
    }).catch((error) => {
      const [wireValue, transferables] = toWireValue({
        value: new TypeError("Unserializable return value"),
        [throwMarker]: 0
      });
      ep.postMessage(Object.assign(Object.assign({}, wireValue), { id }), transferables);
    });
  });
  if (ep.start) {
    ep.start();
  }
}
function isMessagePort(endpoint) {
  return endpoint.constructor.name === "MessagePort";
}
function closeEndPoint(endpoint) {
  if (isMessagePort(endpoint))
    endpoint.close();
}
function wrap(ep, target) {
  const pendingListeners = /* @__PURE__ */ new Map();
  ep.addEventListener("message", function handleMessage(ev) {
    const { data } = ev;
    if (!data || !data.id) {
      return;
    }
    const resolver = pendingListeners.get(data.id);
    if (!resolver) {
      return;
    }
    try {
      resolver(data);
    } finally {
      pendingListeners.delete(data.id);
    }
  });
  return createProxy(ep, pendingListeners, [], target);
}
function throwIfProxyReleased(isReleased) {
  if (isReleased) {
    throw new Error("Proxy has been released and is not useable");
  }
}
function releaseEndpoint(ep) {
  return requestResponseMessage(ep, /* @__PURE__ */ new Map(), {
    type: "RELEASE"
  }).then(() => {
    closeEndPoint(ep);
  });
}
var proxyCounter = /* @__PURE__ */ new WeakMap();
var proxyFinalizers = "FinalizationRegistry" in globalThis && new FinalizationRegistry((ep) => {
  const newCount = (proxyCounter.get(ep) || 0) - 1;
  proxyCounter.set(ep, newCount);
  if (newCount === 0) {
    releaseEndpoint(ep);
  }
});
function registerProxy(proxy2, ep) {
  const newCount = (proxyCounter.get(ep) || 0) + 1;
  proxyCounter.set(ep, newCount);
  if (proxyFinalizers) {
    proxyFinalizers.register(proxy2, ep, proxy2);
  }
}
function unregisterProxy(proxy2) {
  if (proxyFinalizers) {
    proxyFinalizers.unregister(proxy2);
  }
}
function createProxy(ep, pendingListeners, path = [], target = function() {
}) {
  let isProxyReleased = false;
  const proxy2 = new Proxy(target, {
    get(_target, prop) {
      throwIfProxyReleased(isProxyReleased);
      if (prop === releaseProxy) {
        return () => {
          unregisterProxy(proxy2);
          releaseEndpoint(ep);
          pendingListeners.clear();
          isProxyReleased = true;
        };
      }
      if (prop === "then") {
        if (path.length === 0) {
          return { then: () => proxy2 };
        }
        const r = requestResponseMessage(ep, pendingListeners, {
          type: "GET",
          path: path.map((p) => p.toString())
        }).then(fromWireValue);
        return r.then.bind(r);
      }
      return createProxy(ep, pendingListeners, [...path, prop]);
    },
    set(_target, prop, rawValue) {
      throwIfProxyReleased(isProxyReleased);
      const [value, transferables] = toWireValue(rawValue);
      return requestResponseMessage(ep, pendingListeners, {
        type: "SET",
        path: [...path, prop].map((p) => p.toString()),
        value
      }, transferables).then(fromWireValue);
    },
    apply(_target, _thisArg, rawArgumentList) {
      throwIfProxyReleased(isProxyReleased);
      const last = path[path.length - 1];
      if (last === createEndpoint) {
        return requestResponseMessage(ep, pendingListeners, {
          type: "ENDPOINT"
        }).then(fromWireValue);
      }
      if (last === "bind") {
        return createProxy(ep, pendingListeners, path.slice(0, -1));
      }
      const [argumentList, transferables] = processArguments(rawArgumentList);
      return requestResponseMessage(ep, pendingListeners, {
        type: "APPLY",
        path: path.map((p) => p.toString()),
        argumentList
      }, transferables).then(fromWireValue);
    },
    construct(_target, rawArgumentList) {
      throwIfProxyReleased(isProxyReleased);
      const [argumentList, transferables] = processArguments(rawArgumentList);
      return requestResponseMessage(ep, pendingListeners, {
        type: "CONSTRUCT",
        path: path.map((p) => p.toString()),
        argumentList
      }, transferables).then(fromWireValue);
    }
  });
  registerProxy(proxy2, ep);
  return proxy2;
}
function myFlat(arr) {
  return Array.prototype.concat.apply([], arr);
}
function processArguments(argumentList) {
  const processed = argumentList.map(toWireValue);
  return [processed.map((v) => v[0]), myFlat(processed.map((v) => v[1]))];
}
var transferCache = /* @__PURE__ */ new WeakMap();
function transfer(obj, transfers) {
  transferCache.set(obj, transfers);
  return obj;
}
function proxy(obj) {
  return Object.assign(obj, { [proxyMarker]: true });
}
function toWireValue(value) {
  for (const [name, handler] of transferHandlers) {
    if (handler.canHandle(value)) {
      const [serializedValue, transferables] = handler.serialize(value);
      return [
        {
          type: "HANDLER",
          name,
          value: serializedValue
        },
        transferables
      ];
    }
  }
  return [
    {
      type: "RAW",
      value
    },
    transferCache.get(value) || []
  ];
}
function fromWireValue(value) {
  switch (value.type) {
    case "HANDLER":
      return transferHandlers.get(value.name).deserialize(value.value);
    case "RAW":
      return value.value;
  }
}
function requestResponseMessage(ep, pendingListeners, msg, transfers) {
  return new Promise((resolve) => {
    const id = generateUUID();
    pendingListeners.set(id, resolve);
    if (ep.start) {
      ep.start();
    }
    ep.postMessage(Object.assign({ id }, msg), transfers);
  });
}
function generateUUID() {
  return new Array(4).fill(0).map(() => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(16)).join("-");
}

// ../../dist/index.js
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
function readExifOrientation(file2) {
  return __async(this, null, function* () {
    if (file2.size < 14) return 1;
    if (file2.type && file2.type !== "image/jpeg" && file2.type !== "image/jpg") {
      return 1;
    }
    const sliceSize = Math.min(file2.size, 65536);
    const slice = file2.slice(0, sliceSize);
    const buffer = yield slice.arrayBuffer();
    const view = new DataView(buffer);
    if (view.getUint16(0) !== 65496) return 1;
    let offset = 2;
    while (offset < view.byteLength - 4) {
      if (view.getUint8(offset) !== 255) return 1;
      const marker = view.getUint8(offset + 1);
      if (marker === 255) {
        offset++;
        continue;
      }
      if (marker === 216 || marker === 217 || marker >= 208 && marker <= 215) {
        offset += 2;
        continue;
      }
      const segmentLength = view.getUint16(offset + 2);
      if (marker === 225) {
        if (view.getUint8(offset + 4) === 69 && // 'E'
        view.getUint8(offset + 5) === 120 && // 'x'
        view.getUint8(offset + 6) === 105 && // 'i'
        view.getUint8(offset + 7) === 102 && // 'f'
        view.getUint8(offset + 8) === 0 && view.getUint8(offset + 9) === 0) {
          return readOrientationFromTiff(view, offset + 10);
        }
      }
      offset += 2 + segmentLength;
    }
    return 1;
  });
}
function readOrientationFromTiff(view, tiffStart) {
  const byteOrder = view.getUint16(tiffStart);
  let littleEndian;
  if (byteOrder === 18761) {
    littleEndian = true;
  } else if (byteOrder === 19789) {
    littleEndian = false;
  } else {
    return 1;
  }
  if (view.getUint16(tiffStart + 2, littleEndian) !== 42) return 1;
  const ifd0Offset = view.getUint32(tiffStart + 4, littleEndian);
  const ifd0Start = tiffStart + ifd0Offset;
  if (ifd0Start + 2 > view.byteLength) return 1;
  const numEntries = view.getUint16(ifd0Start, littleEndian);
  if (ifd0Start + 2 + numEntries * 12 > view.byteLength) return 1;
  for (let i = 0; i < numEntries; i++) {
    const entryOffset = ifd0Start + 2 + i * 12;
    const tag = view.getUint16(entryOffset, littleEndian);
    if (tag === 274) {
      const value = view.getUint16(entryOffset + 8, littleEndian);
      if (value >= 1 && value <= 8) return value;
      return 1;
    }
  }
  return 1;
}
var init_exif = __esm({
  "src/exif.ts"() {
    "use strict";
  }
});
var worker_helpers_exports = {};
__export(worker_helpers_exports, {
  applyExifOrientation: () => applyExifOrientation,
  applyRotation: () => applyRotation,
  applyTransforms: () => applyTransforms,
  encodeViaOffscreenCanvas: () => encodeViaOffscreenCanvas,
  readExifOrientation: () => readExifOrientation,
  resizeExact: () => resizeExact,
  resizeOffscreen: () => resizeOffscreen,
  tryDecodeHEIC: () => tryDecodeHEIC
});
function resizeOffscreen(file2, maxWidthOrHeight) {
  return __async(this, null, function* () {
    const bitmap = yield createImageBitmap(file2);
    const { width: srcW, height: srcH } = bitmap;
    if (srcW <= maxWidthOrHeight && srcH <= maxWidthOrHeight) {
      return { bitmap, width: srcW, height: srcH };
    }
    const ratio = srcW / srcH;
    let targetW;
    let targetH;
    if (srcW >= srcH) {
      targetW = Math.min(maxWidthOrHeight, srcW);
      targetH = Math.round(targetW / ratio);
    } else {
      targetH = Math.min(maxWidthOrHeight, srcH);
      targetW = Math.round(targetH * ratio);
    }
    const canvas = new OffscreenCanvas(targetW, targetH);
    const ctx = canvas.getContext("2d", { willReadFrequently: false });
    if (!ctx) {
      throw new Error("OffscreenCanvas 2d context unavailable");
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    bitmap.close();
    const resized = canvas.transferToImageBitmap();
    return { bitmap: resized, width: targetW, height: targetH };
  });
}
function applyExifOrientation(bitmap, orientation) {
  if (orientation === 1 || orientation < 1 || orientation > 8) {
    return { bitmap, width: bitmap.width, height: bitmap.height };
  }
  const swap = orientation >= 5;
  const w = swap ? bitmap.height : bitmap.width;
  const h = swap ? bitmap.width : bitmap.height;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("OffscreenCanvas 2d context unavailable for orientation");
  }
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  ctx.translate(w / 2, h / 2);
  switch (orientation) {
    case 2:
      ctx.scale(-1, 1);
      break;
    case 3:
      ctx.rotate(Math.PI);
      break;
    case 4:
      ctx.scale(1, -1);
      break;
    case 5:
      ctx.rotate(-Math.PI / 2);
      ctx.scale(1, -1);
      break;
    case 6:
      ctx.rotate(Math.PI / 2);
      break;
    case 7:
      ctx.rotate(Math.PI / 2);
      ctx.scale(-1, 1);
      break;
    case 8:
      ctx.rotate(-Math.PI / 2);
      break;
  }
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  const transformed = canvas.transferToImageBitmap();
  return { bitmap: transformed, width: w, height: h };
}
function encodeViaOffscreenCanvas(bitmap, format, quality) {
  return __async(this, null, function* () {
    const { width, height } = bitmap;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("OffscreenCanvas 2d context unavailable for encode");
    }
    ctx.drawImage(bitmap, 0, 0);
    return yield canvas.convertToBlob({ type: format, quality });
  });
}
function tryDecodeHEIC(file2) {
  return __async(this, null, function* () {
    if (typeof ImageDecoder === "undefined") return null;
    try {
      const supported = yield ImageDecoder.isTypeSupported("image/heic");
      if (!supported) return null;
      const buffer = yield file2.arrayBuffer();
      const decoder = new ImageDecoder({ data: buffer, type: "image/heic" });
      const { image } = yield decoder.decode();
      decoder.close();
      const bitmap = yield createImageBitmap(image);
      return bitmap;
    } catch {
      return null;
    }
  });
}
function applyRotation(bitmap, rotate = 0, mirror) {
  if (rotate === 0 && !mirror) {
    return { bitmap, width: bitmap.width, height: bitmap.height };
  }
  const swap = rotate === 90 || rotate === 270;
  const dstW = swap ? bitmap.height : bitmap.width;
  const dstH = swap ? bitmap.width : bitmap.height;
  const canvas = new OffscreenCanvas(dstW, dstH);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable for rotation");
  ctx.translate(dstW / 2, dstH / 2);
  if (rotate !== 0) ctx.rotate(rotate * Math.PI / 180);
  if (mirror === "horizontal") ctx.scale(-1, 1);
  else if (mirror === "vertical") ctx.scale(1, -1);
  ctx.translate(-bitmap.width / 2, -bitmap.height / 2);
  ctx.drawImage(bitmap, 0, 0);
  return {
    bitmap: canvas.transferToImageBitmap(),
    width: dstW,
    height: dstH
  };
}
function resizeExact(bitmap, width, height) {
  if (width === bitmap.width && height === bitmap.height) {
    return { bitmap, width, height };
  }
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable for resize");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  return {
    bitmap: canvas.transferToImageBitmap(),
    width,
    height
  };
}
function applyTransforms(bitmap, opts = {}) {
  const rotate = opts.rotate ?? 0;
  const mirror = opts.mirror;
  const exactW = opts.width;
  const exactH = opts.height;
  const hasRotation = rotate !== 0 || !!mirror;
  const hasExactResize = exactW !== void 0 && exactH !== void 0;
  const needsTransform = hasRotation || hasExactResize;
  if (!needsTransform) {
    return { bitmap, width: bitmap.width, height: bitmap.height };
  }
  const swap = rotate === 90 || rotate === 270;
  const srcW = bitmap.width;
  const srcH = bitmap.height;
  const afterRotateW = swap ? srcH : srcW;
  const afterRotateH = swap ? srcW : srcH;
  const finalW = hasExactResize ? exactW : afterRotateW;
  const finalH = hasExactResize ? exactH : afterRotateH;
  const canvas = new OffscreenCanvas(finalW, finalH);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable for transforms");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.translate(finalW / 2, finalH / 2);
  if (rotate !== 0) ctx.rotate(rotate * Math.PI / 180);
  if (mirror === "horizontal") ctx.scale(-1, 1);
  else if (mirror === "vertical") ctx.scale(1, -1);
  ctx.translate(-srcW / 2, -srcH / 2);
  ctx.drawImage(bitmap, 0, 0);
  return {
    bitmap: canvas.transferToImageBitmap(),
    width: finalW,
    height: finalH
  };
}
var init_worker_helpers = __esm({
  "src/worker-helpers.ts"() {
    "use strict";
    init_exif();
  }
});
function calculateTier(hasImageDecoder, offscreenWorks, hasWorker, bitmapWorks, hardwareConcurrency, deviceMemory) {
  let tier = "low";
  if (hasImageDecoder && offscreenWorks && hasWorker && bitmapWorks) {
    tier = "high";
  } else if (offscreenWorks && hasWorker && bitmapWorks) {
    tier = "mid";
  }
  if (tier === "high") {
    if (deviceMemory > 0 && deviceMemory <= 2) tier = "mid";
    if (hardwareConcurrency <= 2) tier = "mid";
  }
  return tier;
}
function detectCapabilities() {
  return __async(this, null, function* () {
    const nav = navigator;
    const hasWorker = typeof Worker !== "undefined";
    const hasOffscreenCanvas = typeof OffscreenCanvas !== "undefined";
    const hasCreateImageBitmap = typeof createImageBitmap !== "undefined";
    const hasImageDecoder = typeof ImageDecoder !== "undefined";
    const hasVideoEncoder = typeof VideoEncoder !== "undefined";
    const hasWebCodecs = hasImageDecoder;
    const hasCanvas2D = hasOffscreenCanvas || typeof HTMLCanvasElement !== "undefined";
    let offscreenWorks = false;
    if (hasOffscreenCanvas) {
      try {
        const canvas = new OffscreenCanvas(1, 1);
        const ctx = canvas.getContext("2d");
        offscreenWorks = ctx !== null;
      } catch {
        offscreenWorks = false;
      }
    }
    let bitmapWorks = false;
    if (hasCreateImageBitmap) {
      try {
        const tinyPng = new Blob(
          [
            new Uint8Array([
              137,
              80,
              78,
              71,
              13,
              10,
              26,
              10,
              0,
              0,
              0,
              13,
              73,
              72,
              68,
              82,
              0,
              0,
              0,
              1,
              0,
              0,
              0,
              1,
              8,
              6,
              0,
              0,
              0,
              31,
              21,
              196,
              137,
              0,
              0,
              0,
              13,
              73,
              68,
              65,
              84,
              120,
              218,
              99,
              100,
              96,
              248,
              95,
              15,
              0,
              2,
              135,
              1,
              128,
              235,
              71,
              186,
              146,
              0,
              0,
              0,
              0,
              73,
              69,
              78,
              68,
              174,
              66,
              96,
              130
            ])
          ],
          { type: "image/png" }
        );
        const bm = yield createImageBitmap(tinyPng);
        bm.close();
        bitmapWorks = true;
      } catch {
        bitmapWorks = false;
      }
    }
    let supportsHEIC = false;
    if (hasImageDecoder) {
      try {
        supportsHEIC = yield ImageDecoder.isTypeSupported("image/heic");
      } catch {
        supportsHEIC = false;
      }
    }
    const ua = navigator.userAgent;
    const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
    const isIOS = /iPad|iPhone|iPod/.test(ua) || typeof document !== "undefined" && ua.includes("Mac") && "ontouchend" in document;
    const hardwareConcurrency = nav.hardwareConcurrency || 2;
    const deviceMemory = nav.deviceMemory || 0;
    const saveData = Boolean(nav.connection?.saveData);
    const effectiveType = nav.connection?.effectiveType || "4g";
    const tier = calculateTier(
      hasImageDecoder,
      offscreenWorks,
      hasWorker,
      bitmapWorks,
      hardwareConcurrency,
      deviceMemory
    );
    return {
      // hasWebCodecs is kept for backward compat — now means "has ImageDecoder".
      // VideoEncoder is no longer required (we use Canvas convertToBlob for encoding).
      hasWebCodecs: hasImageDecoder && offscreenWorks && bitmapWorks,
      hasImageDecoder,
      hasVideoEncoder,
      hasOffscreenCanvas: offscreenWorks,
      hasWorker,
      hasCreateImageBitmap: bitmapWorks,
      hasCanvas2D,
      supportsHEIC,
      hardwareConcurrency,
      deviceMemory,
      saveData,
      effectiveType,
      tier
    };
  });
}
var MIME_EXTENSIONS = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
  "image/png": ".png",
  "image/avif": ".avif",
  "image/heic": ".heic",
  "image/heif": ".heif"
};
function extensionForMimeType(mimeType) {
  return MIME_EXTENSIONS[mimeType.toLowerCase()] ?? ".bin";
}
var CompressionError = class _CompressionError extends Error {
  constructor(code, message, options) {
    super(message);
    this.name = "CompressionError";
    this.code = code;
    this.path = options?.path;
    this.tried = options?.tried;
    this.cause = options?.cause;
    Object.setPrototypeOf(this, _CompressionError.prototype);
    const ErrorCtor = Error;
    if (typeof ErrorCtor.captureStackTrace === "function") {
      ErrorCtor.captureStackTrace(this, _CompressionError);
    }
  }
};
function isCompressionResult(evt) {
  return "blob" in evt && "path" in evt && "tier" in evt;
}
function isBatchResult(evt) {
  return Array.isArray(evt);
}
init_worker_helpers();
function tryDecodeHEICLazy(file) {
  return __async(this, null, function* () {
    if (typeof ImageDecoder !== "undefined") {
      try {
        const supported = yield ImageDecoder.isTypeSupported("image/heic");
        if (supported) {
          const buffer = yield file.arrayBuffer();
          const decoder = new ImageDecoder({ data: buffer, type: "image/heic" });
          const { image } = yield decoder.decode();
          decoder.close();
          const bitmap = yield createImageBitmap(image);
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(bitmap, 0, 0);
            const blob = yield canvas.convertToBlob({ type: "image/jpeg", quality: 0.95 });
            bitmap.close();
            return blob;
          }
        }
      } catch {
      }
    }
    const heic2anyUrl = globalThis.__IC_HEIC2ANY_URL;
    if (heic2anyUrl) {
      try {
        const mod = yield eval(`import('${heic2anyUrl}')`);
        const heic2any = (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          globalThis.heic2any ?? mod.default ?? mod
        );
        if (typeof heic2any !== "function") {
          throw new Error("heic2any not found after script load (no global, no default)");
        }
        const result = yield heic2any({ blob: file, toType: "image/jpeg" });
        return Array.isArray(result) ? result[0] : result;
      } catch {
      }
    }
    try {
      const mod2 = yield import(
        /* @vite-ignore */
        "./image-compression-2WQ6A7FY.js"
      );
      const heic2any2 = (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        globalThis.heic2any ?? mod2.default ?? mod2
      );
      if (typeof heic2any2 !== "function") {
        throw new Error("heic2any not found after bare import");
      }
      const result2 = yield heic2any2({ blob: file, toType: "image/jpeg" });
      return Array.isArray(result2) ? result2[0] : result2;
    } catch {
      return null;
    }
  });
}
function isHEICFile(file2) {
  if (file2 instanceof File && /\.(heic|heif)$/i.test(file2.name)) return true;
  return file2.type === "image/heic" || file2.type === "image/heif";
}
var VERSION_TAG = (true ? "0.10.15" : Date.now().toString()).replace(/[^a-z0-9.]/gi, "").slice(0, 32) || "dev";
function resolveWorker() {
  if (typeof window !== "undefined") {
    const overrideUrl = window.__IC_WORKER_URL;
    if (overrideUrl) {
      return new Worker(overrideUrl, { type: "module" });
    }
  }
  try {
    return new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  } catch (err) {
    console.warn(
      '[ImageCompression] new URL("./worker", import.meta.url) failed, falling back to hard-coded URL:',
      err
    );
    return new Worker(`/image-compression.worker.js?v=${VERSION_TAG}`, { type: "module" });
  }
}
var ImageCompression = class _ImageCompression {
  constructor() {
    this.capabilities = null;
    this.capabilitiesPromise = null;
    this.worker = null;
    this.workerPromise = null;
    this.rawWorker = null;
    this.workerIdleTimer = null;
  }
  static {
    this.WORKER_IDLE_TIMEOUT_MS = 3e4;
  }
  static {
    this.WORKER_SIZE_THRESHOLD_BYTES = 1e5;
  }
  /**
   * Lazy-init: detect capabilities on first call, cache forever.
   *
   * Returns main-thread capabilities IMMEDIATELY (no worker probe).
   * The worker probe runs in the background and updates caps when ready.
   * This way getCapabilities() never blocks the UI.
   *
   * Note: until the worker probe completes, the cascade may include
   * Worker paths that would fail. The cascade's automatic fallback to
   * canvas-main handles this — compression always succeeds, just may
   * be slower for the first call after page load.
   */
  getCapabilities() {
    if (this.capabilities) return Promise.resolve(this.capabilities);
    if (this.capabilitiesPromise) return this.capabilitiesPromise;
    this.capabilitiesPromise = detectCapabilities().then((caps) => {
      this.capabilities = caps;
      this.probeWorkerCapabilities().then((workerCaps) => {
        if (this.capabilities) {
          this.capabilities = __spreadProps(__spreadValues({}, this.capabilities), {
            hasOffscreenCanvasInWorker: workerCaps?.hasOffscreenCanvas ?? false,
            hasWebCodecsInWorker: workerCaps?.hasWebCodecs ?? false,
            hasCreateImageBitmapInWorker: workerCaps?.hasCreateImageBitmap ?? false,
            // `roundtripOk` is the result of the actual decode→draw→encode
            // test in the worker. If false, the cascade skips Worker paths
            // (Chrome bitmap detach bug, broken transferToImageBitmap, etc.).
            // workerCaps is null on probe timeout — treat as "reliable" (default)
            // so a slow probe doesn't break the cascade.
            workerPathsReliable: workerCaps ? workerCaps.roundtripOk : true
          });
        }
      }).catch((err) => {
        console.warn("[ImageCompression] background worker probe failed:", err);
        if (this.capabilities) {
          this.capabilities = __spreadProps(__spreadValues({}, this.capabilities), {
            hasOffscreenCanvasInWorker: false,
            hasWebCodecsInWorker: false,
            hasCreateImageBitmapInWorker: false,
            // Probe threw — assume paths are reliable (default) and let
            // the cascade's try/catch fallback handle any actual runtime
            // failure. Being too aggressive here would disable Worker
            // paths on transient errors.
            workerPathsReliable: true
          });
        }
      });
      return caps;
    }).catch((err) => {
      console.warn("[ImageCompression] capability detection failed:", err);
      const fallback = {
        hasWebCodecs: false,
        hasImageDecoder: false,
        hasVideoEncoder: false,
        hasOffscreenCanvas: false,
        hasWorker: false,
        hasCreateImageBitmap: false,
        hasCanvas2D: typeof HTMLCanvasElement !== "undefined",
        supportsHEIC: false,
        hardwareConcurrency: 2,
        deviceMemory: 0,
        saveData: false,
        effectiveType: "4g",
        tier: "low"
      };
      this.capabilities = fallback;
      return fallback;
    });
    return this.capabilitiesPromise;
  }
  /**
   * Lazy-init: create Worker on first call, reuse for all subsequent calls.
   * Returns null if Worker cannot be created.
   */
  getWorker() {
    return __async(this, null, function* () {
      if (this.worker) {
        this.resetWorkerIdleTimer();
        return Promise.resolve(this.worker);
      }
      if (this.workerPromise) return this.workerPromise;
      this.workerPromise = this.createWorker().then((w) => {
        this.worker = w;
        if (w) this.resetWorkerIdleTimer();
        return w;
      }).catch((err) => {
        console.warn("[ImageCompression] worker creation failed:", err);
        return null;
      });
      return this.workerPromise;
    });
  }
  /**
   * Schedule worker termination after WORKER_IDLE_TIMEOUT_MS of inactivity.
   * Prevents zombie workers in long-lived SPAs that call compress() once
   * and never again. Reset on every compress() call.
   */
  resetWorkerIdleTimer() {
    if (this.workerIdleTimer) clearTimeout(this.workerIdleTimer);
    if (_ImageCompression.WORKER_IDLE_TIMEOUT_MS <= 0) return;
    this.workerIdleTimer = setTimeout(() => {
      this.terminate();
    }, _ImageCompression.WORKER_IDLE_TIMEOUT_MS);
  }
  createWorker() {
    return __async(this, null, function* () {
      if (typeof Worker === "undefined") return null;
      try {
        const worker = yield resolveWorker();
        if (!worker) return null;
        this.rawWorker = worker;
        return wrap(worker);
      } catch (err) {
        console.warn("[ImageCompression] failed to spawn worker:", err);
        return null;
      }
    });
  }
  /**
   * Query the Web Worker for its own runtime capabilities AND a roundtrip
   * probe. Returns null if the worker can't be created or probed.
   *
   * Two probes run together (each in parallel, bounded by a 1s timeout):
   * 1. `getWorkerCapabilities()` — fast static checks (OffscreenCanvas,
   *    WebCodecs, createImageBitmap). Used to detect false positives where
   *    main-thread has the API but Worker context doesn't (Safari iOS).
   * 2. `probeWorkerPath()` — actual decode→draw→encode roundtrip. Catches
   *    environment-specific bugs that simple feature detection misses
   *    (Chrome "image source is detached", Firefox broken transferToImageBitmap,
   *    etc.). Used to auto-skip Worker paths in broken environments.
   */
  probeWorkerCapabilities() {
    return __async(this, null, function* () {
      try {
        const probePromise = (() => __async(this, null, function* () {
          const worker = yield this.getWorker();
          if (!worker) return null;
          const [caps, roundtripOk] = yield Promise.all([
            worker.getWorkerCapabilities(),
            worker.probeWorkerPath().catch(() => false)
          ]);
          return __spreadProps(__spreadValues({}, caps), { roundtripOk });
        }))();
        const timeoutPromise = new Promise(
          (resolve) => setTimeout(() => resolve(null), 1e3)
        );
        return (yield Promise.race([probePromise, timeoutPromise])) ?? null;
      } catch (err) {
        console.warn("[ImageCompression] worker capability probe failed:", err);
        return null;
      }
    });
  }
  /**
   * Main entry: compress an image with progressive enhancement.
   * Returns a CompressionResult regardless of which path was used.
   * Never throws — falls back to server-fallback (returns original).
   *
   * Pass `options.onProgress` to receive stage-based progress updates:
   *   - 'detecting' (5%) — checking device capabilities
   *   - 'loading-worker' (10%) — initializing Worker
   *   - 'decoding' (20-30%) — decoding source image
   *   - 'resizing' (50-70%) — resizing to maxWidthOrHeight
   *   - 'encoding' (95%) — encoding to target format
   *   - 'done' (100%) — completed
   *   - 'fallback' — cascading to next path
   */
  compress(_0) {
    return __async(this, arguments, function* (file2, options = {}) {
      const start = performance.now();
      const onProgress = options.onProgress;
      let totalPaths;
      const emit = (p) => {
        if (totalPaths !== void 0 && p.totalPaths === void 0) {
          p.totalPaths = totalPaths;
        }
        onProgress?.(p);
      };
      emit({ stage: "detecting", percent: 5, message: "Checking device capabilities..." });
      const caps = yield this.getCapabilities();
      this.checkAborted(options.signal);
      const originalSize = file2.size;
      const name = file2 instanceof File ? file2.name : "image";
      const targetFormat = options.format ?? "image/jpeg";
      if (options.passThroughUnderBytes !== void 0 && originalSize <= options.passThroughUnderBytes && // Match target format. Note: 'image/jpg' alias is treated as 'image/jpeg'.
      (file2.type === targetFormat || targetFormat === "image/jpeg" && file2.type === "image/jpg")) {
        emit({
          stage: "fallback",
          percent: 100,
          path: "passthrough",
          message: `File already ${targetFormat} and ${(originalSize / 1024).toFixed(0)}KB (≤ ${(options.passThroughUnderBytes / 1024).toFixed(0)}KB) — skipping compression`
        });
        return _ImageCompression.buildResult(
          file2,
          originalSize,
          "passthrough",
          caps.tier,
          performance.now() - start,
          0,
          0,
          targetFormat,
          file2
        );
      }
      if (options.forceServer) {
        emit({ stage: "fallback", percent: 100, path: "server-fallback", message: "Server-side processing" });
        return this.makeServerResult(file2, caps.tier, start, originalSize);
      }
      if (this.isHEICFile(file2)) {
        emit({ stage: "decoding", percent: 10, message: "Decoding HEIC (may load WASM decoder)..." });
        const decoded = yield tryDecodeHEICLazy(file2);
        this.checkAborted(options.signal);
        if (decoded) {
          file2 = decoded;
          emit({ stage: "decoding", percent: 20, message: "HEIC decoded, continuing cascade" });
        } else if (options.forcePath) {
          throw new CompressionError(
            "HEIC_UNSUPPORTED",
            "HEIC decode failed (no native ImageDecoder, heic2any failed)",
            { tried: [options.forcePath] }
          );
        } else {
          emit({ stage: "fallback", percent: 10, message: "HEIC decode failed, will use server fallback" });
        }
      }
      if (options.forcePath !== void 0) {
        return yield this.executeForcedPath(
          options.forcePath,
          file2,
          options,
          caps,
          start,
          originalSize,
          emit
        );
      }
      const tried = [];
      const paths = this.selectPaths(caps, __spreadProps(__spreadValues({}, options), {
        originalSize
      }));
      totalPaths = paths.length;
      for (let i = 0; i < paths.length; i++) {
        const path = paths[i];
        tried.push(path);
        const attempt = i + 1;
        try {
          emit({ stage: "decoding", percent: 20, path, attempt, message: `Trying ${path} (attempt ${attempt})` });
          const result2 = yield this.executePath(path, file2, options, caps);
          this.checkAborted(options.signal);
          if (result2) {
            const baseResult = _ImageCompression.buildResult(
              result2.blob,
              originalSize,
              path,
              caps.tier,
              performance.now() - start,
              result2.width,
              result2.height,
              result2.mimeType,
              file2
            );
            const finalResult = yield _ImageCompression.applyTransformsIfRequested(baseResult, options);
            this.checkAborted(options.signal);
            emit({ stage: "done", percent: 100, path: finalResult.path, attempt, message: "Compression complete" });
            return finalResult;
          }
        } catch (err) {
          const errMsg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
          console.warn(`[ImageCompression] path ${path} failed:`, err);
          if (i < paths.length - 1) {
            const nextPath = paths[i + 1];
            emit({
              stage: "fallback",
              percent: 0,
              path,
              attempt,
              totalPaths: paths.length,
              // Show the actual error message so users can debug without DevTools
              message: `${path} failed (${errMsg}) → trying ${nextPath} (${attempt + 1}/${paths.length})`
            });
          }
        }
      }
      emit({ stage: "error", percent: 100, path: "server-fallback", message: "All paths failed, using original" });
      return this.makeServerResult(file2, caps.tier, start, originalSize, tried);
    });
  }
  /**
   * Batch compression: process multiple files with bounded concurrency.
   *
   * Results are returned in the same order as input. If any file fails, the
   * entire batch rejects with the first error (use `compress()` individually
   * for partial-success scenarios).
   *
   * @param files Array of files to compress
   * @param options Shared options (same as `compress()`)
   * @param maxConcurrent Max files processed in parallel (default 2 for mobile).
   *                     Set to 0 or negative to mean Infinity (unlimited).
   *                     Recommended: 2-3 for mobile, 4-8 for desktop.
   */
  compressAll(_0) {
    return __async(this, arguments, function* (files, options = {}, maxConcurrent = 2) {
      if (files.length === 0) return [];
      return new Promise((resolve, reject) => {
        const results = new Array(files.length).fill(null);
        const errors = new Array(files.length).fill(null);
        let nextIndex = 0;
        let activeCount = 0;
        let completedCount = 0;
        let errored = null;
        const continueOnError = options.continueOnError === true;
        const launchNext = () => {
          if (errored) return;
          while (nextIndex < files.length && (maxConcurrent <= 0 || activeCount < maxConcurrent)) {
            const fileIndex = nextIndex++;
            activeCount++;
            const file2 = files[fileIndex];
            const wrappedOnProgress = options.onProgress ? (e) => {
              options.onProgress(e, fileIndex);
            } : void 0;
            this.compress(file2, __spreadProps(__spreadValues({}, options), { onProgress: wrappedOnProgress })).then((result2) => {
              if (errored && !continueOnError) return;
              results[fileIndex] = result2;
            }).catch((err) => {
              if (errored && !continueOnError) return;
              const wrapped = err instanceof CompressionError ? err : new CompressionError(
                "UNKNOWN",
                err instanceof Error ? err.message : String(err)
              );
              errors[fileIndex] = wrapped;
              if (!continueOnError) {
                errored = wrapped;
              }
            }).finally(() => {
              activeCount--;
              completedCount++;
              if (errored && !continueOnError) {
                reject(errored);
              } else if (completedCount === files.length) {
                if (errored) {
                  reject(errored);
                } else {
                  resolve(results);
                }
              } else {
                launchNext();
              }
            });
          }
        };
        launchNext();
      });
    });
  }
  /**
   * Decide which paths to try and in what order.
   * Returns an ordered array of CompressionPath.
   *
   * **v0.10.0 change (Worker-first default)**: Paths are ordered with Worker
   * first, falling back to main thread. This matches the behavior of the
   * v0.5.7 Angular wrapper.
   *
   /**
    * Decide which paths to try and in what order.
    * Returns an ordered array of CompressionPath.
    *
    * v0.10.4: Reverted path-selection logic to match v0.5.7. The v0.10.0
    * gating on `*InWorker` flags was too strict — when the background
    * probe returned null (timeout) or reported `false` for any flag, the
    * cascade skipped Worker paths entirely, falling through to `canvas-main`
    * even when the Worker would have worked. This broke the v0.5.7
    * UX of "webcodecs-worker attempt #1" on Safari iOS, mobile Chrome, and
    * slow-probe environments.
    *
    * The fix: trust main-thread capabilities for path selection. The
    * cascade's try/catch fallback handles actual runtime failures
    * gracefully (e.g., if OffscreenCanvas doesn't work in Worker context
    * at runtime, we fall back to canvas-main without losing the user).
    *
    * The 100KB size threshold is kept as a perf optimization (Worker
    * spawn overhead > savings for tiny files). The background probe
    * is kept for `workerPathsReliable` flag (currently unused but available
    * for future tuning).
    */
  selectPaths(caps, options) {
    const paths = [];
    const hasTransformRequest = options.rotate !== void 0 || options.mirror !== void 0 || options.width !== void 0 || options.height !== void 0;
    const skipWorker = hasTransformRequest;
    const fileSize = options.originalSize ?? Infinity;
    const smallFile = fileSize < _ImageCompression.WORKER_SIZE_THRESHOLD_BYTES;
    if (!skipWorker && !smallFile && caps.hasWebCodecs && caps.hasOffscreenCanvas && caps.hasWorker) {
      paths.push("webcodecs-worker");
    }
    if (!skipWorker && !smallFile && caps.hasOffscreenCanvas && caps.hasWorker) {
      paths.push("offscreen-worker");
    }
    if (caps.hasCanvas2D) {
      paths.push("canvas-main");
    }
    return paths;
  }
  /**
   * Execute a specific compression path. Returns null on failure.
   */
  executePath(path, file2, options, caps) {
    return __async(this, null, function* () {
      const optionsWithPath = __spreadProps(__spreadValues({}, options), { __path: path });
      switch (path) {
        case "webcodecs-worker":
        case "offscreen-worker":
          return this.executeWorkerPath(file2, optionsWithPath, path);
        case "canvas-main":
          return this.executeCanvasMainPath(file2, options, caps);
        case "server-fallback":
          return null;
        default:
          return null;
      }
    });
  }
  /**
   * Path 1 & 2: Compress via Web Worker.
   */
  executeWorkerPath(file2, options, path) {
    return __async(this, null, function* () {
      const _a = options, { onProgress } = _a, optionsOnly = __objRest(_a, ["onProgress"]);
      const workerOptions = optionsOnly;
      if (!this.worker) {
        onProgress?.({ stage: "loading-worker", percent: 10, path, message: `Loading worker (${path})...` });
      }
      const worker = yield this.getWorker();
      if (!worker) return null;
      const progressProxy = onProgress ? proxy(onProgress) : void 0;
      const { blob, width, height, mimeType } = yield worker.compress(
        file2,
        workerOptions,
        progressProxy
      );
      return { blob, compressedSize: blob.size, width, height, mimeType };
    });
  }
  /**
   * Path 3: Compress on main thread using Canvas2D.
   * May block UI briefly. Last resort before server fallback.
   */
  executeCanvasMainPath(file2, options, caps) {
    return __async(this, null, function* () {
      const {
        maxWidthOrHeight = 2048,
        quality = 0.85,
        format = "image/jpeg",
        width,
        height,
        keepAspectRatio,
        rotate,
        mirror
      } = options;
      const onProgress = options.onProgress;
      let bitmap = null;
      if (caps.hasCreateImageBitmap) {
        try {
          bitmap = yield createImageBitmap(file2);
        } catch {
          bitmap = null;
        }
      }
      if (!bitmap) {
        const url = URL.createObjectURL(file2);
        let img = null;
        try {
          img = yield this.loadImage(url);
          bitmap = yield createImageBitmap(img);
        } finally {
          if (img) img.src = "";
          URL.revokeObjectURL(url);
        }
      }
      if (!bitmap) {
        throw new Error("Failed to decode image for canvas-main path");
      }
      onProgress?.({ stage: "decoding", percent: 30, path: "canvas-main", message: "Decoding image..." });
      let outWidth = bitmap.width;
      let outHeight = bitmap.height;
      if (rotate === void 0) {
        const { readExifOrientation: readExifOrientation2, applyExifOrientation: applyExifOrientation3 } = yield Promise.resolve().then(() => (init_worker_helpers(), worker_helpers_exports));
        const orientation = yield readExifOrientation2(file2);
        if (orientation !== 1) {
          const rotated = applyExifOrientation3(bitmap, orientation);
          bitmap.close();
          bitmap = rotated.bitmap;
          outWidth = rotated.width;
          outHeight = rotated.height;
          onProgress?.({ stage: "resizing", percent: 55, path: "canvas-main", message: "Auto-rotated via EXIF" });
        }
      }
      if (rotate !== void 0 || mirror !== void 0) {
        const rotated = applyRotation(
          bitmap,
          rotate ?? 0,
          mirror
        );
        bitmap.close();
        bitmap = rotated.bitmap;
        outWidth = rotated.width;
        outHeight = rotated.height;
        onProgress?.({ stage: "resizing", percent: 65, path: "canvas-main", message: "Rotating..." });
      }
      onProgress?.({ stage: "resizing", percent: 70, path: "canvas-main", message: "Resizing..." });
      let targetW = outWidth;
      let targetH = outHeight;
      let needsResize = false;
      if (width !== void 0 || height !== void 0) {
        if (width !== void 0 && height !== void 0 && !keepAspectRatio) {
          targetW = width;
          targetH = height;
        } else if (width !== void 0 && height === void 0) {
          targetW = width;
          targetH = Math.round(width * outHeight / outWidth);
        } else if (height !== void 0 && width === void 0) {
          targetH = height;
          targetW = Math.round(height * outWidth / outHeight);
        } else if (keepAspectRatio) {
          const ratio = outWidth / outHeight;
          if (width / height > ratio) {
            targetH = height;
            targetW = Math.round(height * ratio);
          } else {
            targetW = width;
            targetH = Math.round(width / ratio);
          }
        }
        needsResize = targetW !== outWidth || targetH !== outHeight;
      } else if (outWidth > maxWidthOrHeight || outHeight > maxWidthOrHeight) {
        const ratio = outWidth / outHeight;
        if (outWidth >= outHeight) {
          targetW = Math.min(maxWidthOrHeight, outWidth);
          targetH = Math.round(targetW / ratio);
        } else {
          targetH = Math.min(maxWidthOrHeight, outHeight);
          targetW = Math.round(targetH * ratio);
        }
        needsResize = true;
      }
      if (needsResize) {
        outWidth = targetW;
        outHeight = targetH;
        needsResize = true;
        onProgress?.({ stage: "resizing", percent: 80, path: "canvas-main", message: "Resized" });
      }
      onProgress?.({ stage: "encoding", percent: 90, path: "canvas-main", message: "Encoding..." });
      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas2D context unavailable");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      if (needsResize) {
        ctx.drawImage(bitmap, 0, 0, targetW, targetH);
      } else {
        ctx.drawImage(bitmap, 0, 0);
      }
      bitmap.close();
      const blob = yield new Promise((resolve) => {
        canvas.toBlob((b) => resolve(b), format, quality);
      });
      if (!blob) throw new Error("toBlob returned null");
      return {
        blob,
        compressedSize: blob.size,
        width: targetW,
        height: targetH,
        mimeType: format
      };
    });
  }
  loadImage(src, timeoutMs = 15e3) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Image load timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        img.onload = null;
        img.onerror = null;
      };
      img.onload = () => {
        cleanup();
        resolve(img);
      };
      img.onerror = () => {
        cleanup();
        reject(new Error("Image load failed"));
      };
      img.src = src;
    });
  }
  /**
   * v0.10.9: Compress-then-Transform stage.
   *
   * If the caller requested manual transforms (`rotate`, `mirror`, exact
   * `width`/`height`), apply them to the compressed result ON THE MAIN THREAD.
   * The Worker path intentionally does NOT apply these (it would re-introduce
   * the v0.10.6 module-worker bitmap detach race). This helper fills the gap:
   *   1. Decode the compressed blob with `createImageBitmap` (HW-accelerated)
   *   2. Apply combined rotate+mirror+exact-resize in a single OffscreenCanvas draw
   *   3. Re-encode with `canvas.toBlob` (preserves the caller's quality/format)
   *
   * **No-op conditions** (returns input unchanged):
   *   - No transform options set
   *   - Source path is 'passthrough' (no decode happened)
   *   - Source path is 'server-fallback' (caller wants raw file)
   *   - Source blob has 0×0 dimensions (placeholder)
   *
   * **Performance**: Adds 1 extra decode + 1 extra encode round-trip.
   * Since the input is the *compressed* output (already resized by Worker),
   * this is fast even on large original files. The trade-off: we keep
   * Worker's resize+encode speed (Stage 1) AND get correct transforms
   * (Stage 2) — without the worker detach risk of v0.10.6.
   *
   * @param result  Compression result from the cascade or forced-path
   * @param options Caller's options (only `rotate`/`mirror`/`width`/`height` are used)
   * @returns New result with transforms applied, or input unchanged if no-op
   *
   * Exposed (named export) for direct unit testing — see
   * `applyTransformsIfRequested.spec.ts`.
   */
  static applyTransformsIfRequested(result2, options) {
    return __async(this, null, function* () {
      const { rotate, mirror, width, height, keepAspectRatio } = options;
      const hasManualTransform = rotate !== void 0 || mirror !== void 0 || width !== void 0 || height !== void 0;
      if (!hasManualTransform) return result2;
      if (result2.path === "passthrough" || result2.path === "server-fallback") return result2;
      if (result2.path === "canvas-main") return result2;
      if (result2.width === 0 || result2.height === 0) return result2;
      const format = result2.mimeType || "image/jpeg";
      const quality = options.quality ?? 0.85;
      let bitmap;
      try {
        bitmap = yield createImageBitmap(result2.blob);
      } catch (err) {
        console.warn("[ImageCompression] applyTransforms: failed to decode output blob", err);
        return result2;
      }
      let exactW = width;
      let exactH = height;
      if (exactW !== void 0 && exactH === void 0) {
        exactH = keepAspectRatio === false ? Math.round(exactW * bitmap.height / bitmap.width) : bitmap.height;
      } else if (exactH !== void 0 && exactW === void 0) {
        exactW = keepAspectRatio === false ? Math.round(exactH * bitmap.width / bitmap.height) : bitmap.width;
      } else if ((width !== void 0 || height !== void 0) && keepAspectRatio !== false && // BOTH set: skip this branch (we want exact resize)
      !(width !== void 0 && height !== void 0)) {
        exactW = void 0;
        exactH = void 0;
      }
      const hasTransform = rotate !== void 0 || mirror !== void 0 || exactW !== void 0 && exactH !== void 0;
      const swap = rotate === 90 || rotate === 270;
      const afterRotateW = swap ? bitmap.height : bitmap.width;
      const afterRotateH = swap ? bitmap.width : bitmap.height;
      const hasExactResize = exactW !== void 0 && exactH !== void 0;
      const finalW = hasExactResize ? exactW : afterRotateW;
      const finalH = hasExactResize ? exactH : afterRotateH;
      const canvas = document.createElement("canvas");
      canvas.width = finalW;
      canvas.height = finalH;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        bitmap.close();
        console.warn("[ImageCompression] applyTransforms: Canvas2D context unavailable");
        return result2;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      if (hasTransform) {
        ctx.translate(finalW / 2, finalH / 2);
        if (rotate !== void 0 && rotate !== 0) {
          ctx.rotate(rotate * Math.PI / 180);
        }
        if (mirror === "horizontal") ctx.scale(-1, 1);
        else if (mirror === "vertical") ctx.scale(1, -1);
        ctx.translate(-bitmap.width / 2, -bitmap.height / 2);
        if (hasExactResize) {
          ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
        } else {
          ctx.drawImage(bitmap, 0, 0);
        }
      } else {
        ctx.drawImage(bitmap, 0, 0, finalW, finalH);
      }
      bitmap.close();
      const newBlob = yield new Promise((resolve) => {
        canvas.toBlob((b) => resolve(b), format, quality);
      });
      if (!newBlob) {
        console.warn("[ImageCompression] applyTransforms: toBlob returned null");
        return result2;
      }
      const newResult = _ImageCompression.buildResult(
        newBlob,
        result2.originalSize,
        result2.path,
        result2.tier,
        result2.durationMs,
        finalW,
        finalH,
        format,
        result2.file
      );
      return newResult;
    });
  }
  /**
   * Execute a single forced path (no cascade). Used when `forcePath` is set.
   * Validates the path, then either returns the result or throws CompressionError.
   */
  executeForcedPath(forcedPath, file2, options, caps, start, originalSize, emit) {
    return __async(this, null, function* () {
      const KNOWN_PATHS = [
        "webcodecs-worker",
        "offscreen-worker",
        "canvas-main",
        "server-fallback"
      ];
      if (!KNOWN_PATHS.includes(forcedPath)) {
        throw new CompressionError(
          "INVALID_OPTIONS",
          `forcePath must be one of: ${KNOWN_PATHS.join(", ")}. Got: ${String(forcedPath)}`,
          { path: forcedPath, tried: [forcedPath] }
        );
      }
      if (forcedPath === "server-fallback") {
        emit({
          stage: "fallback",
          percent: 100,
          path: "server-fallback",
          message: "Server-side processing (forced)"
        });
        return this.makeServerResult(file2, caps.tier, start, originalSize, [forcedPath]);
      }
      emit({
        stage: "decoding",
        percent: 20,
        path: forcedPath,
        attempt: 1,
        message: `Forced path: ${forcedPath}`
      });
      try {
        const result2 = yield this.executePath(forcedPath, file2, options, caps);
        this.checkAborted(options.signal);
        if (result2) {
          const baseResult = _ImageCompression.buildResult(
            result2.blob,
            originalSize,
            forcedPath,
            caps.tier,
            performance.now() - start,
            result2.width,
            result2.height,
            result2.mimeType,
            file2
          );
          const finalResult = yield _ImageCompression.applyTransformsIfRequested(baseResult, options);
          this.checkAborted(options.signal);
          emit({
            stage: "done",
            percent: 100,
            path: finalResult.path,
            attempt: 1,
            message: "Compression complete (forced path)"
          });
          return finalResult;
        }
        throw new CompressionError(
          "ALL_PATHS_FAILED",
          `Forced path '${forcedPath}' is not viable on this device`,
          { path: forcedPath, tried: [forcedPath] }
        );
      } catch (err) {
        if (err instanceof CompressionError) throw err;
        throw new CompressionError(
          "ALL_PATHS_FAILED",
          `Forced path '${forcedPath}' failed: ${err instanceof Error ? err.message : String(err)}`,
          { path: forcedPath, tried: [forcedPath], cause: err }
        );
      }
    });
  }
  /**
   * Check if the AbortSignal has been triggered. Throws CompressionError(ABORTED)
   * if so. Call after each major await point to keep cancellation responsive.
   */
  checkAborted(signal) {
    if (signal?.aborted) {
      throw new CompressionError(
        "ABORTED",
        "Compression aborted by caller",
        { cause: signal.reason }
      );
    }
  }
  /**
   * Detect HEIC/HEIF files by extension or MIME type.
   * Used to trigger the HEIC pre-decode path before the cascade.
   */
  isHEICFile(file2) {
    if (file2 instanceof File && /\.(heic|heif)$/i.test(file2.name)) return true;
    return file2.type === "image/heic" || file2.type === "image/heif";
  }
  /**
   * Wrap a Blob/File in a proper CompressionResult with:
   * - `file`: File with preserved name + corrected extension (based on mimeType)
   * - `name`: file.name (same as file.name, for convenience)
   * - `blob`: same reference as file (File extends Blob, so this is backward-compatible)
   *
   * If the input is already a File, the name is reused (with extension replaced
   * to match the new mimeType). If it's a Blob without a name, 'image.{ext}' is used.
   *
   * **Memory optimization:** if the input blob is already a File with a matching
   * type AND the extension is already correct (no rename needed), the original
   * File is returned as-is (no copy, no allocation). This preserves the original
   * reference for tests/debugging and saves a Blob allocation.
   *
   * @param preserveOriginalName If true, the original filename is kept unchanged
   *   (no extension replacement). Used by server-fallback paths where the
   *   server is expected to handle any extension based on mime type.
   */
  static buildResult(blob, originalSize, path, tier, durationMs, width, height, mimeType, originalFile, preserveOriginalName = false) {
    if (blob instanceof File && blob.type === mimeType) {
      const needsRename = !preserveOriginalName && originalFile instanceof File && originalFile.name.replace(/\.[^./\\]+$/, "") + extensionForMimeType(mimeType) !== blob.name;
      if (!needsRename) {
        return {
          blob,
          file: blob,
          name: blob.name,
          originalSize,
          compressedSize: blob.size,
          width,
          height,
          mimeType,
          path,
          durationMs,
          tier
        };
      }
    }
    let name;
    if (preserveOriginalName && originalFile instanceof File) {
      name = originalFile.name;
    } else if (originalFile instanceof File) {
      const baseName = originalFile.name.replace(/\.[^./\\]+$/, "");
      name = baseName + extensionForMimeType(mimeType);
    } else {
      name = "image" + extensionForMimeType(mimeType);
    }
    const file2 = new File(
      [blob],
      name,
      {
        type: mimeType,
        lastModified: originalFile instanceof File ? originalFile.lastModified : Date.now()
      }
    );
    return {
      blob: file2,
      file: file2,
      name: file2.name,
      originalSize,
      compressedSize: blob.size,
      width,
      height,
      mimeType,
      path,
      durationMs,
      tier
    };
  }
  makeServerResult(file2, tier, start, originalSize, _tried) {
    return _ImageCompression.buildResult(
      file2,
      originalSize,
      "server-fallback",
      tier,
      performance.now() - start,
      0,
      0,
      file2.type || "application/octet-stream",
      file2,
      true
      // preserveOriginalName — server handles any extension
    );
  }
  /**
   * Terminate the Worker (cleanup). Call on service destroy if needed.
   * Actually kills the underlying OS worker — releases memory immediately.
   * Safe to call multiple times.
   */
  terminate() {
    if (this.workerIdleTimer) {
      clearTimeout(this.workerIdleTimer);
      this.workerIdleTimer = null;
    }
    if (this.rawWorker) {
      this.rawWorker.terminate();
      this.rawWorker = null;
    }
    this.worker = null;
    this.workerPromise = null;
  }
  /**
   * Release resources. Call when the service is no longer needed.
   * Terminates the Web Worker and clears cached state.
   * Safe to call multiple times.
   */
  dispose() {
    this.terminate();
  }
};
function compress$(file2, options = {}, svc) {
  return {
    [Symbol.asyncIterator]() {
      const opts = __spreadProps(__spreadValues({}, options), {
        onProgress: options.onProgress
        // preserve user's callback if set
      });
      const queue = [];
      let pendingResolve = null;
      let isDone = false;
      let error = null;
      const push = (evt) => {
        if (pendingResolve) {
          const r = pendingResolve;
          pendingResolve = null;
          r({ value: evt, done: false });
        } else {
          queue.push(evt);
        }
      };
      const wrappedOpts = __spreadProps(__spreadValues({}, opts), {
        onProgress: (e) => {
          push(e);
          opts.onProgress?.(e);
        }
      });
      const promise = svc.compress(file2, wrappedOpts).then((result2) => {
        push(result2);
        isDone = true;
      }).catch((err) => {
        error = err;
        isDone = true;
        if (pendingResolve) {
          const r = pendingResolve;
          pendingResolve = null;
          r({ value: void 0, done: false });
        }
      });
      return {
        next() {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift(), done: false });
          }
          if (error !== null) {
            return Promise.reject(error);
          }
          if (isDone) {
            return Promise.resolve({ value: void 0, done: true });
          }
          return new Promise((resolve) => {
            pendingResolve = resolve;
          });
        },
        return() {
          isDone = true;
          return Promise.resolve({ value: void 0, done: true });
        }
      };
    }
  };
}
function compressAll$(files, options = {}, maxConcurrent = 2, svc) {
  return {
    [Symbol.asyncIterator]() {
      if (files.length === 0) {
        let emitted = false;
        const emptyIter = {
          next() {
            if (!emitted) {
              emitted = true;
              return Promise.resolve({ value: [], done: false });
            }
            return Promise.resolve({ value: void 0, done: true });
          }
        };
        return emptyIter;
      }
      const queue = [];
      let pendingResolve = null;
      let isDone = false;
      let error = null;
      const push = (evt) => {
        if (pendingResolve) {
          const r = pendingResolve;
          pendingResolve = null;
          r({ value: evt, done: false });
        } else {
          queue.push(evt);
        }
      };
      const results = new Array(files.length).fill(null);
      let completedCount = 0;
      let errored = false;
      let nextIndex = 0;
      let activeCount = 0;
      const launchNext = () => {
        if (errored) return;
        while (nextIndex < files.length && (maxConcurrent <= 0 || activeCount < maxConcurrent)) {
          const fileIndex = nextIndex++;
          activeCount++;
          const file2 = files[fileIndex];
          const wrappedOpts = __spreadProps(__spreadValues({}, options), {
            onProgress: (e) => {
              push({ fileIndex, progress: e });
              options.onProgress?.(e);
            }
          });
          svc.compress(file2, wrappedOpts).then((result2) => {
            if (errored) return;
            results[fileIndex] = result2;
          }).catch((err) => {
            if (errored) return;
            errored = true;
            error = err;
            isDone = true;
            if (pendingResolve) {
              const r = pendingResolve;
              pendingResolve = null;
              r({ value: void 0, done: false });
            }
          }).finally(() => {
            activeCount--;
            completedCount++;
            if (!errored && completedCount === files.length) {
              push(results);
              isDone = true;
            } else if (!errored) {
              launchNext();
            }
            if (pendingResolve) {
              const r = pendingResolve;
              pendingResolve = null;
              r({ value: void 0, done: false });
            }
          });
        }
      };
      launchNext();
      return {
        next() {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift(), done: false });
          }
          if (error !== null) {
            return Promise.reject(error);
          }
          if (isDone) {
            return Promise.resolve({ value: void 0, done: true });
          }
          return new Promise((resolve) => {
            pendingResolve = resolve;
          });
        },
        return() {
          isDone = true;
          if (pendingResolve) {
            const r = pendingResolve;
            pendingResolve = null;
            r({ value: void 0, done: true });
          }
          return Promise.resolve({ value: void 0, done: true });
        }
      };
    }
  };
}
init_exif();
init_worker_helpers();
export {
  CompressionError,
  ImageCompression,
  applyExifOrientation,
  applyRotation,
  applyTransforms,
  calculateTier,
  compress$,
  compressAll$,
  detectCapabilities,
  extensionForMimeType,
  isBatchResult,
  isCompressionResult,
  readExifOrientation,
  resizeExact,
  resolveWorker,
  tryDecodeHEICLazy
};
/*! Bundled license information:

comlink/dist/esm/comlink.mjs:
  (**
   * @license
   * Copyright 2019 Google LLC
   * SPDX-License-Identifier: Apache-2.0
   *)
*/
//# sourceMappingURL=@GKz_image-compression.js.map
