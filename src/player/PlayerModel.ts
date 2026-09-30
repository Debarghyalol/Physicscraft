import * as THREE from 'three';

/**
 * Authentic Minecraft Steve Humanoid Player Model
 * Head with face texture, blue t-shirt torso, jeans legs, and swinging arms with held tool.
 */
export class PlayerModel {
  public root: THREE.Group;
  public head: THREE.Group;
  public torso: THREE.Mesh;
  public leftArm: THREE.Group;
  public rightArm: THREE.Group;
  public leftLeg: THREE.Group;
  public rightLeg: THREE.Group;
  public heldItem: THREE.Group;

  private materials: THREE.Material[] = [];
  private textures: THREE.Texture[] = [];
  public walkCycle: number = 0;
  public swingAnimation: number = 0;

  constructor(scene: THREE.Scene) {
    this.root = new THREE.Group();

    // 1. Create Procedural Pixel-Art Textures for Steve
    const faceTex = this.createFaceTexture();
    const shirtTex = this.createShirtTexture();
    const skinTex = this.createSkinTexture();
    const pantsTex = this.createPantsTexture();

    const skinMat = new THREE.MeshStandardMaterial({ map: skinTex, roughness: 0.8 });
    const shirtMat = new THREE.MeshStandardMaterial({ map: shirtTex, roughness: 0.85 });
    const pantsMat = new THREE.MeshStandardMaterial({ map: pantsTex, roughness: 0.9 });
    this.materials.push(skinMat, shirtMat, pantsMat);

    // 2. Torso (0.5m wide, 0.75m high, 0.25m deep)
    const torsoGeo = new THREE.BoxGeometry(0.5, 0.75, 0.25);
    this.torso = new THREE.Mesh(torsoGeo, shirtMat);
    this.torso.position.y = 1.05;
    this.torso.castShadow = true;
    this.torso.receiveShadow = true;
    this.root.add(this.torso);

    // 3. Head (0.45m cube) with Steve face
    this.head = new THREE.Group();
    this.head.position.y = 1.55;

    const headGeo = new THREE.BoxGeometry(0.44, 0.44, 0.44);
    // Box face materials: [Right, Left, Top, Bottom, Front, Back]
    const headMats = [
      skinMat, // Right
      skinMat, // Left
      new THREE.MeshStandardMaterial({ color: 0x4a3728, roughness: 0.8 }), // Top hair
      skinMat, // Bottom
      new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.8 }), // Front face
      new THREE.MeshStandardMaterial({ color: 0x4a3728, roughness: 0.8 }), // Back hair
    ];
    this.materials.push(...headMats);

    const headMesh = new THREE.Mesh(headGeo, headMats);
    headMesh.position.y = 0.22;
    headMesh.castShadow = true;
    this.head.add(headMesh);
    this.root.add(this.head);

    // 4. Arms (Pivoting at shoulders at y=1.35)
    // Left Arm
    this.leftArm = new THREE.Group();
    this.leftArm.position.set(-0.38, 1.35, 0);
    const armGeo = new THREE.BoxGeometry(0.22, 0.72, 0.22);
    armGeo.translate(0, -0.32, 0); // pivot at shoulder top

    const leftArmMesh = new THREE.Mesh(armGeo, skinMat);
    leftArmMesh.castShadow = true;
    this.leftArm.add(leftArmMesh);
    this.root.add(this.leftArm);

    // Right Arm (holds tool/block)
    this.rightArm = new THREE.Group();
    this.rightArm.position.set(0.38, 1.35, 0);

    const rightArmMesh = new THREE.Mesh(armGeo, skinMat);
    rightArmMesh.castShadow = true;
    this.rightArm.add(rightArmMesh);

    // Held Pickaxe / Item in Right Hand
    this.heldItem = this.createPickaxeModel();
    this.heldItem.position.set(0, -0.65, 0.15);
    this.heldItem.rotation.set(Math.PI / 4, 0, 0);
    this.rightArm.add(this.heldItem);
    this.root.add(this.rightArm);

    // 5. Legs (Pivoting at hips at y=0.7)
    const legGeo = new THREE.BoxGeometry(0.24, 0.72, 0.24);
    legGeo.translate(0, -0.36, 0); // pivot at hip top

    // Left Leg
    this.leftLeg = new THREE.Group();
    this.leftLeg.position.set(-0.13, 0.7, 0);
    const leftLegMesh = new THREE.Mesh(legGeo, pantsMat);
    leftLegMesh.castShadow = true;
    this.leftLeg.add(leftLegMesh);
    this.root.add(this.leftLeg);

    // Right Leg
    this.rightLeg = new THREE.Group();
    this.rightLeg.position.set(0.13, 0.7, 0);
    const rightLegMesh = new THREE.Mesh(legGeo, pantsMat);
    rightLegMesh.castShadow = true;
    this.rightLeg.add(rightLegMesh);
    this.root.add(this.rightLeg);

    scene.add(this.root);
  }

  private createFaceTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    const ctx = c.getContext('2d')!;

    // Skin tone base
    ctx.fillStyle = '#c48f6c';
    ctx.fillRect(0, 0, 16, 16);

    // Brown hair top fringe
    ctx.fillStyle = '#4a321e';
    ctx.fillRect(0, 0, 16, 4);
    ctx.fillRect(0, 4, 3, 3);
    ctx.fillRect(13, 4, 3, 3);

    // Eyes
    // Left eye (white + indigo blue)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(3, 7, 3, 2);
    ctx.fillStyle = '#3a4b9c';
    ctx.fillRect(4, 7, 2, 2);

    // Right eye
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(10, 7, 3, 2);
    ctx.fillStyle = '#3a4b9c';
    ctx.fillRect(10, 7, 2, 2);

    // Nose
    ctx.fillStyle = '#a66d48';
    ctx.fillRect(7, 9, 2, 2);

    // Beard / Mouth
    ctx.fillStyle = '#5c381c';
    ctx.fillRect(5, 12, 6, 2);

    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    this.textures.push(tex);
    return tex;
  }

  private createShirtTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    const ctx = c.getContext('2d')!;

    // Steve Cyan/Teal shirt
    ctx.fillStyle = '#00a8a8';
    ctx.fillRect(0, 0, 16, 16);

    // Pixel shading
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 16; y++) {
        if ((x + y * 3) % 4 === 0) {
          ctx.fillStyle = '#008b8b';
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }

    // Collar V-neck
    ctx.fillStyle = '#c48f6c';
    ctx.fillRect(6, 0, 4, 3);
    ctx.fillRect(7, 3, 2, 2);

    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    this.textures.push(tex);
    return tex;
  }

  private createSkinTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    const ctx = c.getContext('2d')!;

    ctx.fillStyle = '#c48f6c';
    ctx.fillRect(0, 0, 16, 16);

    // Pixel variance
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 16; y++) {
        if ((x * 5 + y) % 3 === 0) {
          ctx.fillStyle = '#b77f5c';
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }

    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    this.textures.push(tex);
    return tex;
  }

  private createPantsTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    const ctx = c.getContext('2d')!;

    // Blue denim jeans
    ctx.fillStyle = '#2b3f8e';
    ctx.fillRect(0, 0, 16, 16);

    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 16; y++) {
        if ((x + y) % 4 === 0) {
          ctx.fillStyle = '#213175';
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }

    // Gray boots bottom
    ctx.fillStyle = '#6b6b6b';
    ctx.fillRect(0, 13, 16, 3);

    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    this.textures.push(tex);
    return tex;
  }

  private createPickaxeModel(): THREE.Group {
    const group = new THREE.Group();

    // Wooden handle
    const handleGeo = new THREE.BoxGeometry(0.06, 0.65, 0.06);
    const handleMat = new THREE.MeshStandardMaterial({ color: 0x6e4a28, roughness: 0.9 });
    const handle = new THREE.Mesh(handleGeo, handleMat);
    handle.position.y = 0.25;
    group.add(handle);

    // Iron pickaxe head
    const headGeo = new THREE.BoxGeometry(0.48, 0.1, 0.08);
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xcccccc,
      metalness: 0.7,
      roughness: 0.3,
    });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 0.55;
    group.add(head);

    this.materials.push(handleMat, headMat);
    return group;
  }

  /**
   * Set visibility mode (in 1st person, full body is hidden or only hand is visible)
   */
  public setFirstPersonMode(isFirstPerson: boolean) {
    this.head.visible = !isFirstPerson;
    this.torso.visible = !isFirstPerson;
    this.leftArm.visible = !isFirstPerson;
    this.leftLeg.visible = !isFirstPerson;
    this.rightLeg.visible = !isFirstPerson;

    if (isFirstPerson) {
      // In 1st person, adjust right arm position to look like classic Minecraft hand
      this.rightArm.position.set(0.35, 1.45, -0.4);
      this.rightArm.rotation.set(-Math.PI / 6, Math.PI / 8, 0);
    } else {
      this.rightArm.position.set(0.38, 1.35, 0);
      this.rightArm.rotation.set(0, 0, 0);
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
    this.root.rotation.y = yaw;

    // Head pitch look up/down
    this.head.rotation.x = Math.max(-1.2, Math.min(1.2, pitch));

    if (speed > 0.1 && isGrounded) {
      this.walkCycle += delta * speed * 4.5;
      const legAngle = Math.sin(this.walkCycle) * 0.65;
      const armAngle = Math.sin(this.walkCycle) * 0.65;

      this.leftLeg.rotation.x = legAngle;
      this.rightLeg.rotation.x = -legAngle;
      this.leftArm.rotation.x = -armAngle;

      if (this.swingAnimation <= 0) {
        this.rightArm.rotation.x = armAngle;
      }
    } else {
      // Smooth return to rest stance
      this.walkCycle = 0;
      this.leftLeg.rotation.x = THREE.MathUtils.lerp(this.leftLeg.rotation.x, 0, delta * 8);
      this.rightLeg.rotation.x = THREE.MathUtils.lerp(this.rightLeg.rotation.x, 0, delta * 8);
      this.leftArm.rotation.x = THREE.MathUtils.lerp(this.leftArm.rotation.x, 0, delta * 8);

      if (this.swingAnimation <= 0) {
        this.rightArm.rotation.x = THREE.MathUtils.lerp(this.rightArm.rotation.x, 0, delta * 8);
      }
    }

    // Mining / Attacking Arm Swing Punch Animation
    if (this.swingAnimation > 0) {
      this.swingAnimation = Math.max(0, this.swingAnimation - delta * 4.0);
      const swingT = Math.sin(this.swingAnimation * Math.PI);
      this.rightArm.rotation.x = -0.9 * swingT;
      this.rightArm.rotation.y = 0.4 * swingT;
      this.rightArm.rotation.z = -0.3 * swingT;
    }
  }

  public dispose() {
    this.materials.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
  }
}
