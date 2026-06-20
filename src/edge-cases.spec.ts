import { ImageCompression } from './index';

describe('passThroughUnderBytes', () => {
  it('skips compression when file is small + target format matches', async () => {
    const svc = new ImageCompression();
    try {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const file = new File([bytes], 'small.jpg', { type: 'image/jpeg' });
      const result = await svc.compress(file, {
        passThroughUnderBytes: 1000,
      });
      expect(result.path).toBe('passthrough');
    } finally {
      svc.dispose();
    }
  });

  it('does NOT pass through when format mismatch', async () => {
    const svc = new ImageCompression();
    try {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const file = new File([bytes], 'image.png', { type: 'image/png' });
      const result = await svc.compress(file, {
        passThroughUnderBytes: 1000,
        format: 'image/jpeg',
        forceServer: true,
      });
      expect(result.path).toBe('server-fallback');
    } finally {
      svc.dispose();
    }
  });

  it('does NOT pass through when file too large', async () => {
    const svc = new ImageCompression();
    try {
      const bytes = new Uint8Array(2000);
      const file = new File([bytes], 'big.jpg', { type: 'image/jpeg' });
      const result = await svc.compress(file, {
        passThroughUnderBytes: 1000,
        forceServer: true,
      });
      expect(result.path).toBe('server-fallback');
    } finally {
      svc.dispose();
    }
  });
});

describe('compress() with options', () => {
  it('accepts empty options object', async () => {
    const svc = new ImageCompression();
    try {
      const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'test.jpg', { type: 'image/jpeg' });
      const result = await svc.compress(file, { forceServer: true });
      expect(result.path).toBe('server-fallback');
    } finally {
      svc.dispose();
    }
  });

  it('accepts standard options', async () => {
    const svc = new ImageCompression();
    try {
      const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'test.jpg', { type: 'image/jpeg' });
      const result = await svc.compress(file, {
        maxWidthOrHeight: 1024,
        quality: 0.7,
        format: 'image/webp',
        forceServer: true,
      });
      expect(result.path).toBe('server-fallback');
    } finally {
      svc.dispose();
    }
  });
});

describe('getCapabilities()', () => {
  it('returns same instance on repeated calls (cached)', async () => {
    const svc = new ImageCompression();
    try {
      const caps1 = await svc.getCapabilities();
      const caps2 = await svc.getCapabilities();
      expect(caps1).toBe(caps2);
    } finally {
      svc.dispose();
    }
  });

  it('returns low tier in this test env', async () => {
    const svc = new ImageCompression();
    try {
      const caps = await svc.getCapabilities();
      expect(caps.tier).toBe('low');
    } finally {
      svc.dispose();
    }
  });
});

describe('terminate() / dispose()', () => {
  it('terminate is safe to call multiple times', () => {
    const svc = new ImageCompression();
    svc.terminate();
    svc.terminate();
  });

  it('dispose is safe to call multiple times', () => {
    const svc = new ImageCompression();
    svc.dispose();
    svc.dispose();
  });

  it('dispose + terminate can be called in any order', () => {
    const svc = new ImageCompression();
    svc.dispose();
    svc.terminate();
    svc.terminate();
    svc.dispose();
  });
});
