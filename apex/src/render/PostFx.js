import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * Etterbehandling: fartsuskarphet og vignett.
 *
 * Dette ble utsatt fra fase 3 fordi et tidligere forsøk vasket ut hele bildet.
 * Årsaken var fargerommet, og rekkefølgen her er det som gjør det riktig:
 *
 *   RenderPass  → tegner scenen til et flyttallsmål. three slår AV både
 *                 tonemapping og sRGB-konvertering når det tegnes til et mål
 *                 og ikke til skjermen, så det som ligger der er lineært lys.
 *   ShaderPass  → uskarpheten regnes på lineære verdier, slik den skal.
 *   OutputPass  → gjør tonemapping og sRGB til slutt, én gang.
 *
 * Gjør man tonemappingen selv i tillegg, eller lar målet være i sRGB, skjer
 * konverteringen to ganger og bildet blir flatt og lyst. Det er nøyaktig det
 * som skjedde sist, og derfor måler testene at etterbehandlet og direkte
 * rendret bilde har samme farge når uskarpheten er null.
 *
 * Under terskelfarten kobles hele kjeden ut og bildet tegnes rett til skjermen.
 * Da koster effekten ingenting når man står stille eller triller i pit.
 */

const BlurShader = {
  name: 'FartsuskarphetShader',
  uniforms: {
    tDiffuse: { value: null },
    strength: { value: 0 },
    vignette: { value: 0.14 },
    centre: { value: new THREE.Vector2(0.5, 0.5) },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    #define SAMPLES 8
    uniform sampler2D tDiffuse;
    uniform float strength;
    uniform float vignette;
    uniform vec2 centre;
    varying vec2 vUv;

    void main() {
      vec2 dir = vUv - centre;
      float r = length(dir);

      // Midt i bildet — der bilen og veien du sikter mot er — skal være skarpt.
      // Uskarpheten bygger seg opp mot kantene, slik synet ditt gjør i fart.
      float amount = strength * smoothstep(0.14, 0.68, r);

      vec3 sum = vec3(0.0);
      for (int i = 0; i < SAMPLES; i++) {
        float t = float(i) / float(SAMPLES - 1);
        sum += texture2D(tDiffuse, vUv - dir * amount * t).rgb;
      }
      vec3 col = sum / float(SAMPLES);

      col *= 1.0 - vignette * smoothstep(0.25, 0.95, r);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class PostFx {
  /**
   * @param {number} maxStrength hvor kraftig uskarpheten blir på toppfart
   * @param {number} fullSpeed farten i m/s der uskarpheten er på sitt sterkeste
   */
  constructor(renderer, scene, camera, { maxStrength = 0.16, fullSpeed = 78 } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.maxStrength = maxStrength;
    this.fullSpeed = fullSpeed;
    this.enabled = true;
    this.strength = 0;

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.blur = new ShaderPass(BlurShader);
    this.composer.addPass(this.blur);
    this.composer.addPass(new OutputPass());
  }

  setSize(width, height) {
    this.composer.setSize(width, height);
  }

  /** Uskarpheten begynner først godt over bykjøring og vokser med farten. */
  strengthFor(speed) {
    const t = THREE.MathUtils.clamp((speed - 24) / (this.fullSpeed - 24), 0, 1);
    return t * t * this.maxStrength;
  }

  render(speed = 0) {
    this.strength = this.enabled ? this.strengthFor(speed) : 0;
    if (this.strength < 0.004) {
      // Ingenting å tjene på å gå gjennom kjeden — tegn rett til skjermen.
      this.renderer.render(this.scene, this.camera);
      return false;
    }
    this.blur.uniforms.strength.value = this.strength;
    this.composer.render();
    return true;
  }

  dispose() {
    this.composer.dispose();
  }
}
