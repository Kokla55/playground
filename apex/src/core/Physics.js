import RAPIER from '@dimforge/rapier3d-compat';

/**
 * Tynn innpakning rundt Rapier. Holder også rede på hvilket underlag hver
 * collider representerer, slik at dekkene kan spørre om grep uten å kjenne
 * til fysikkmotoren.
 */
export class Physics {
  static async create(options = {}) {
    await RAPIER.init();
    return new Physics(options);
  }

  constructor({ gravity = -9.81, timestep = 1 / 120 } = {}) {
    this.RAPIER = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: gravity, z: 0 });
    this.world.timestep = timestep;
    this.timestep = timestep;
    this._surfaces = new Map();
  }

  /** Registrerer en statisk kropp og merker colliderne med et underlag. */
  addStatic(colliderDescs, { surface = 'asphalt', position, rotation } = {}) {
    const desc = RAPIER.RigidBodyDesc.fixed();
    if (position) desc.setTranslation(position.x, position.y, position.z);
    if (rotation) desc.setRotation(rotation);
    const body = this.world.createRigidBody(desc);

    const list = Array.isArray(colliderDescs) ? colliderDescs : [colliderDescs];
    const colliders = list.map((cd) => {
      const collider = this.world.createCollider(cd, body);
      this._surfaces.set(collider.handle, surface);
      return collider;
    });
    return { body, colliders };
  }

  surfaceOf(handle) {
    return this._surfaces.get(handle) ?? 'asphalt';
  }

  step() {
    this.world.step();
  }
}
