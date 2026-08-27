import { mulberry32 } from "../utils/rng";

// Small dependency-free seeded 2D value-noise implementation (not full Perlin/Simplex,
// but sufficient for a gently rolling MVP heightmap). Smoothed with bilinear
// interpolation + fractal octave summation for a natural-looking terrain.
export class ValueNoise2D {
  private readonly permSize = 256;
  private readonly gradients: Float32Array;

  constructor(seed: number) {
    const rand = mulberry32(seed);
    this.gradients = new Float32Array(this.permSize * this.permSize);
    for (let i = 0; i < this.gradients.length; i++) {
      this.gradients[i] = rand() * 2 - 1;
    }
  }

  private sample(ix: number, iy: number): number {
    const x = ((ix % this.permSize) + this.permSize) % this.permSize;
    const y = ((iy % this.permSize) + this.permSize) % this.permSize;
    return this.gradients[y * this.permSize + x];
  }

  private smooth(t: number): number {
    return t * t * (3 - 2 * t);
  }

  noise2D(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = this.smooth(x - x0);
    const ty = this.smooth(y - y0);

    const v00 = this.sample(x0, y0);
    const v10 = this.sample(x0 + 1, y0);
    const v01 = this.sample(x0, y0 + 1);
    const v11 = this.sample(x0 + 1, y0 + 1);

    const a = v00 + (v10 - v00) * tx;
    const b = v01 + (v11 - v01) * tx;
    return a + (b - a) * ty;
  }

  // Fractal Brownian Motion: sum of octaves of decreasing amplitude for more
  // natural, less uniform terrain than a single frequency.
  fbm2D(x: number, y: number, octaves = 4, persistence = 0.5, scale = 0.02): number {
    let amplitude = 1;
    let frequency = scale;
    let total = 0;
    let maxAmplitude = 0;
    for (let i = 0; i < octaves; i++) {
      total += this.noise2D(x * frequency, y * frequency) * amplitude;
      maxAmplitude += amplitude;
      amplitude *= persistence;
      frequency *= 2;
    }
    return total / maxAmplitude;
  }
}
