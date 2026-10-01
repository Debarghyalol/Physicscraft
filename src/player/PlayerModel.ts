import * as THREE from 'three';

/**
 * Helper to compute authentic Minecraft 64x64 skin UV coordinates
 * Exact formula from Minecraft Java Edition / skinview3d
 */
function setSkinUVs(
  box: THREE.BoxGeometry,
  u: number,
  v: number,
  width: number,
  height: number,
  depth: number
) {
  const textureWidth = 64;
  const textureHeight = 64;
  const toFaceVertices = (x1: number, y1: number, x2: number, y2: number) => [
    new THREE.Vector2(x1 / textureWidth, 1.0 - y2 / textureHeight),
    new THREE.Vector2(x2 / textureWidth, 1.0 - y2 / textureHeight),
    new THREE.Vector2(x2 / textureWidth, 1.0 - y1 / textureHeight),
    new THREE.Vector2(x1 / textureWidth, 1.0 - y1 / textureHeight),
  ];

  const top = toFaceVertices(u + depth, v, u + width + depth, v + depth);
  const bottom = toFaceVertices(u + width + depth, v, u + width * 2 + depth, v + depth);
  const left = toFaceVertices(u, v + depth, u + depth, v + depth + height);
  const front = toFaceVertices(u + depth, v + depth, u + width + depth, v + depth + height);
  const right = toFaceVertices(u + width + depth, v + depth, u + width + depth * 2, v + height + depth);
  const back = toFaceVertices(u + width + depth * 2, v + depth, u + width * 2 + depth * 2, v + height + depth);

  const uvAttr = box.attributes.uv;
  const uvRight = [right[3], right[2], right[0], right[1]];
  const uvLeft = [left[3], left[2], left[0], left[1]];
  const uvTop = [top[3], top[2], top[0], top[1]];
  const uvBottom = [bottom[0], bottom[1], bottom[3], bottom[2]];
  const uvFront = [front[3], front[2], front[0], front[1]];
  const uvBack = [back[3], back[2], back[0], back[1]];

  const newUVData: number[] = [];
  for (const uvArray of [uvRight, uvLeft, uvTop, uvBottom, uvFront, uvBack]) {
    for (const uv of uvArray) {
      newUVData.push(uv.x, uv.y);
    }
  }
  (uvAttr as THREE.BufferAttribute).set(new Float32Array(newUVData));
  uvAttr.needsUpdate = true;
}

/**
 * Authentic Native Minecraft Steve Player Model (Built directly with Three.js 0.186)
 * - Dual layer (Layer 1 Skin + Layer 2 3D Outer Jacket/Hat/Sleeves/Pants)
 * - Exact connected joints: shoulders at y=1.5, hips at y=0.75, neck at y=1.5
 * - Zero gaps between torso, head, arms, and legs
 * - 100% native Three.js 0.186 classes (eliminates foreign prototype / culling errors)
 */
export class PlayerModel {
  public root: THREE.Group;
  public headGroup: THREE.Group;
  public torsoGroup: THREE.Group;
  public leftArmGroup: THREE.Group;
  public rightArmGroup: THREE.Group;
  public leftLegGroup: THREE.Group;
  public rightLegGroup: THREE.Group;
  private skinTexture: THREE.Texture;
  private layer1Material: THREE.MeshBasicMaterial;
  private layer2Material: THREE.MeshBasicMaterial;

  public walkCycle: number = 0;
  public swingAnimation: number = 0;
  public isFirstPerson: boolean = false;

  constructor(scene: THREE.Scene) {
    this.root = new THREE.Group();

    // 1. Load authentic Minecraft Steve skin texture
    const textureLoader = new THREE.TextureLoader();
    this.skinTexture = textureLoader.load('/textures/entity/steve.png');
    this.skinTexture.magFilter = THREE.NearestFilter;
    this.skinTexture.minFilter = THREE.NearestFilter;
    this.skinTexture.generateMipmaps = false;

    // Layer 1: Solid base skin
    this.layer1Material = new THREE.MeshBasicMaterial({
      map: this.skinTexture,
      side: THREE.FrontSide,
    });

    // Layer 2: 3D Outer layer (jacket, sleeves, hat, pants) with transparency
    this.layer2Material = new THREE.MeshBasicMaterial({
      map: this.skinTexture,
      side: THREE.DoubleSide,
      transparent: true,
      alphaTest: 0.1,
    });

    const px = 0.0625; // 1 pixel = 1/16 meter = 0.0625m

    // 2. Torso / Body (8 x 12 x 4 px = 0.5 x 0.75 x 0.25 m)
    // Sits directly from y = 0.75 to y = 1.50
    this.torsoGroup = new THREE.Group();
    this.torsoGroup.position.set(0, 1.125, 0);

    const torsoGeo1 = new THREE.BoxGeometry(8 * px, 12 * px, 4 * px);
    setSkinUVs(torsoGeo1, 16, 16, 8, 12, 4);
    const torsoMesh1 = new THREE.Mesh(torsoGeo1, this.layer1Material);
    this.torsoGroup.add(torsoMesh1);

    const torsoGeo2 = new THREE.BoxGeometry(8.5 * px, 12.5 * px, 4.5 * px);
    setSkinUVs(torsoGeo2, 16, 32, 8, 12, 4);
    const torsoMesh2 = new THREE.Mesh(torsoGeo2, this.layer2Material);
    this.torsoGroup.add(torsoMesh2);

    this.root.add(this.torsoGroup);

    // 3. Head (8 x 8 x 8 px = 0.5 x 0.5 x 0.5 m)
    // Neck pivot at y = 1.50; head extends upwards from y = 1.50 to y = 2.00
    this.headGroup = new THREE.Group();
    this.headGroup.position.set(0, 1.5, 0);

    const headGeo1 = new THREE.BoxGeometry(8 * px, 8 * px, 8 * px);
    headGeo1.translate(0, 4 * px, 0); // shift center so bottom touches neck at y = 0
    setSkinUVs(headGeo1, 0, 0, 8, 8, 8);
    const headMesh1 = new THREE.Mesh(headGeo1, this.layer1Material);
    this.headGroup.add(headMesh1);

    const headGeo2 = new THREE.BoxGeometry(9 * px, 9 * px, 9 * px);
    headGeo2.translate(0, 4 * px, 0);
    setSkinUVs(headGeo2, 32, 0, 8, 8, 8);
    const headMesh2 = new THREE.Mesh(headGeo2, this.layer2Material);
    this.headGroup.add(headMesh2);

    this.root.add(this.headGroup);

    // 4. Right Arm (4 x 12 x 4 px = 0.25 x 0.75 x 0.25 m)
    // Shoulder pivot at (0.375, 1.5, 0), perfectly flush against torso right side
    this.rightArmGroup = new THREE.Group();
    this.rightArmGroup.position.set(0.375, 1.5, 0);

    const rightArmGeo1 = new THREE.BoxGeometry(4 * px, 12 * px, 4 * px);
    rightArmGeo1.translate(0, -6 * px, 0); // pivot at shoulder top
    setSkinUVs(rightArmGeo1, 40, 16, 4, 12, 4);
    const rightArmMesh1 = new THREE.Mesh(rightArmGeo1, this.layer1Material);
    this.rightArmGroup.add(rightArmMesh1);

    const rightArmGeo2 = new THREE.BoxGeometry(4.5 * px, 12.5 * px, 4.5 * px);
    rightArmGeo2.translate(0, -6 * px, 0);
    setSkinUVs(rightArmGeo2, 40, 32, 4, 12, 4);
    const rightArmMesh2 = new THREE.Mesh(rightArmGeo2, this.layer2Material);
    this.rightArmGroup.add(rightArmMesh2);

    this.root.add(this.rightArmGroup);

    // 5. Left Arm (4 x 12 x 4 px = 0.25 x 0.75 x 0.25 m)
    // Shoulder pivot at (-0.375, 1.5, 0), perfectly flush against torso left side
    this.leftArmGroup = new THREE.Group();
    this.leftArmGroup.position.set(-0.375, 1.5, 0);

    const leftArmGeo1 = new THREE.BoxGeometry(4 * px, 12 * px, 4 * px);
    leftArmGeo1.translate(0, -6 * px, 0);
    setSkinUVs(leftArmGeo1, 32, 48, 4, 12, 4);
    const leftArmMesh1 = new THREE.Mesh(leftArmGeo1, this.layer1Material);
    this.leftArmGroup.add(leftArmMesh1);

    const leftArmGeo2 = new THREE.BoxGeometry(4.5 * px, 12.5 * px, 4.5 * px);
    leftArmGeo2.translate(0, -6 * px, 0);
    setSkinUVs(leftArmGeo2, 48, 48, 4, 12, 4);
    const leftArmMesh2 = new THREE.Mesh(leftArmGeo2, this.layer2Material);
    this.leftArmGroup.add(leftArmMesh2);

    this.root.add(this.leftArmGroup);

    // 6. Right Leg (4 x 12 x 4 px = 0.25 x 0.75 x 0.25 m)
    // Hip pivot at (0.125, 0.75, 0), flush under right half of torso
    this.rightLegGroup = new THREE.Group();
    this.rightLegGroup.position.set(0.125, 0.75, 0);

    const rightLegGeo1 = new THREE.BoxGeometry(4 * px, 12 * px, 4 * px);
    rightLegGeo1.translate(0, -6 * px, 0);
    setSkinUVs(rightLegGeo1, 0, 16, 4, 12, 4);
    const rightLegMesh1 = new THREE.Mesh(rightLegGeo1, this.layer1Material);
    this.rightLegGroup.add(rightLegMesh1);

    const rightLegGeo2 = new THREE.BoxGeometry(4.5 * px, 12.5 * px, 4.5 * px);
    rightLegGeo2.translate(0, -6 * px, 0);
    setSkinUVs(rightLegGeo2, 0, 32, 4, 12, 4);
    const rightLegMesh2 = new THREE.Mesh(rightLegGeo2, this.layer2Material);
    this.rightLegGroup.add(rightLegMesh2);

    this.root.add(this.rightLegGroup);

    // 7. Left Leg (4 x 12 x 4 px = 0.25 x 0.75 x 0.25 m)
    // Hip pivot at (-0.125, 0.75, 0), flush under left half of torso
    this.leftLegGroup = new THREE.Group();
    this.leftLegGroup.position.set(-0.125, 0.75, 0);

    const leftLegGeo1 = new THREE.BoxGeometry(4 * px, 12 * px, 4 * px);
    leftLegGeo1.translate(0, -6 * px, 0);
    setSkinUVs(leftLegGeo1, 16, 48, 4, 12, 4);
    const leftLegMesh1 = new THREE.Mesh(leftLegGeo1, this.layer1Material);
    this.leftLegGroup.add(leftLegMesh1);

    const leftLegGeo2 = new THREE.BoxGeometry(4.5 * px, 12.5 * px, 4.5 * px);
    leftLegGeo2.translate(0, -6 * px, 0);
    setSkinUVs(leftLegGeo2, 0, 48, 4, 12, 4);
    const leftLegMesh2 = new THREE.Mesh(leftLegGeo2, this.layer2Material);
    this.leftLegGroup.add(leftLegMesh2);

    this.root.add(this.leftLegGroup);

    scene.add(this.root);
  }

  /**
   * Set first-person vs third-person mode
   */
  public setFirstPersonMode(isFirstPerson: boolean) {
    this.isFirstPerson = isFirstPerson;

    // In first person: hide head, body, left arm, legs to prevent camera clipping
    this.headGroup.visible = !isFirstPerson;
    this.torsoGroup.visible = !isFirstPerson;
    this.leftArmGroup.visible = !isFirstPerson;
    this.leftLegGroup.visible = !isFirstPerson;
    this.rightLegGroup.visible = !isFirstPerson;

    if (isFirstPerson) {
      // Classic Minecraft 1st person hand view
      this.rightArmGroup.position.set(0.32, 1.42, -0.42);
      this.rightArmGroup.rotation.set(-Math.PI / 6, Math.PI / 8, 0);
    } else {
      // Third person: connect shoulder joint
      this.rightArmGroup.position.set(0.375, 1.5, 0);
      this.rightArmGroup.rotation.set(0, 0, 0);
    }
  }

  public triggerSwing() {
    this.swingAnimation = 1.0;
  }

  /**
   * Update character walking limb animations and head tracking
   */
  public update(delta: number, speed: number, isGrounded: boolean, pitch: number, yaw: number) {
    // Body orientation
    this.root.rotation.y = yaw + (this.isFirstPerson ? 0 : Math.PI);

    if (this.isFirstPerson) {
      // First person mining swing
      if (this.swingAnimation > 0) {
        this.swingAnimation = Math.max(0, this.swingAnimation - delta * 4.5);
        const swingT = Math.sin(this.swingAnimation * Math.PI);
        this.rightArmGroup.rotation.x = -Math.PI / 6 - 0.7 * swingT;
        this.rightArmGroup.rotation.y = Math.PI / 8 + 0.4 * swingT;
      }
      return;
    }

    // Third-person head pitch look up/down
    this.headGroup.rotation.x = Math.max(-1.1, Math.min(1.1, -pitch));

    // Walk limb swing animation
    if (speed > 0.1 && isGrounded) {
      this.walkCycle += delta * speed * 4.2;
      const legAngle = Math.sin(this.walkCycle) * 0.7;
      const armAngle = Math.sin(this.walkCycle) * 0.7;

      this.leftLegGroup.rotation.x = legAngle;
      this.rightLegGroup.rotation.x = -legAngle;
      this.leftArmGroup.rotation.x = -armAngle;

      if (this.swingAnimation <= 0) {
        this.rightArmGroup.rotation.x = armAngle;
      }
    } else {
      // Return to rest stance
      this.walkCycle = 0;
      this.leftLegGroup.rotation.x = THREE.MathUtils.lerp(
        this.leftLegGroup.rotation.x,
        0,
        delta * 8
      );
      this.rightLegGroup.rotation.x = THREE.MathUtils.lerp(
        this.rightLegGroup.rotation.x,
        0,
        delta * 8
      );
      this.leftArmGroup.rotation.x = THREE.MathUtils.lerp(
        this.leftArmGroup.rotation.x,
        0,
        delta * 8
      );

      if (this.swingAnimation <= 0) {
        this.rightArmGroup.rotation.x = THREE.MathUtils.lerp(
          this.rightArmGroup.rotation.x,
          0,
          delta * 8
        );
      }
    }

    // Mining / Attacking Arm Swing Punch Animation
    if (this.swingAnimation > 0) {
      this.swingAnimation = Math.max(0, this.swingAnimation - delta * 4.0);
      const swingT = Math.sin(this.swingAnimation * Math.PI);
      this.rightArmGroup.rotation.x = -0.9 * swingT;
      this.rightArmGroup.rotation.y = 0.4 * swingT;
      this.rightArmGroup.rotation.z = -0.3 * swingT;
    }
  }

  public dispose() {
    this.skinTexture.dispose();
    this.layer1Material.dispose();
    this.layer2Material.dispose();
  }
}
