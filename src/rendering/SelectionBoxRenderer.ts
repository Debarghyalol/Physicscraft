import * as THREE from 'three';

/**
 * 3D Holographic Selection Box Renderer for the Physics Maker (Create / Aeronautics style)
 * Highlights the 3D bounding box selected by Corner A and Corner B:
 * - Glowing semi-transparent cyan bounding volume
 * - High-contrast animated wireframe edges
 * - 3D Corner Markers for Corner A (Cyan) and Corner B (Amber)
 */
export class SelectionBoxRenderer {
  public scene: THREE.Scene;
  public group: THREE.Group;

  public boxMesh: THREE.Mesh;
  public wireframeMesh: THREE.LineSegments;
  public cornerAMesh: THREE.Mesh;
  public cornerBMesh: THREE.Mesh;

  public cornerA: THREE.Vector3 | null = null;
  public cornerB: THREE.Vector3 | null = null;

  private animPhase: number = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.visible = false;
    this.scene.add(this.group);

    // 1. Semi-transparent glowing cyan box
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const boxMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.boxMesh = new THREE.Mesh(boxGeo, boxMat);
    this.group.add(this.boxMesh);

    // 2. High-contrast wireframe outline
    const wireGeo = new THREE.EdgesGeometry(boxGeo);
    const wireMat = new THREE.LineBasicMaterial({
      color: 0x00f0ff,
      linewidth: 2,
      transparent: true,
      opacity: 0.9,
    });
    this.wireframeMesh = new THREE.LineSegments(wireGeo, wireMat);
    this.group.add(this.wireframeMesh);

    // 3. Corner A Marker (Cyan glowing sphere/box)
    const markerGeoA = new THREE.BoxGeometry(1.08, 1.08, 1.08);
    const markerMatA = new THREE.MeshBasicMaterial({
      color: 0x06b6d4,
      wireframe: true,
    });
    this.cornerAMesh = new THREE.Mesh(markerGeoA, markerMatA);
    this.cornerAMesh.visible = false;
    this.scene.add(this.cornerAMesh);

    // 4. Corner B Marker (Amber glowing sphere/box)
    const markerGeoB = new THREE.BoxGeometry(1.08, 1.08, 1.08);
    const markerMatB = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      wireframe: true,
    });
    this.cornerBMesh = new THREE.Mesh(markerGeoB, markerMatB);
    this.cornerBMesh.visible = false;
    this.scene.add(this.cornerBMesh);
  }

  public setCornerA(pos: THREE.Vector3 | null) {
    if (pos) {
      this.cornerA = new THREE.Vector3(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
      this.cornerAMesh.position.set(this.cornerA.x + 0.5, this.cornerA.y + 0.5, this.cornerA.z + 0.5);
      this.cornerAMesh.visible = true;
    } else {
      this.cornerA = null;
      this.cornerAMesh.visible = false;
    }
    this.updateBox();
  }

  public setCornerB(pos: THREE.Vector3 | null) {
    if (pos) {
      this.cornerB = new THREE.Vector3(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
      this.cornerBMesh.position.set(this.cornerB.x + 0.5, this.cornerB.y + 0.5, this.cornerB.z + 0.5);
      this.cornerBMesh.visible = true;
    } else {
      this.cornerB = null;
      this.cornerBMesh.visible = false;
    }
    this.updateBox();
  }

  public clear() {
    this.cornerA = null;
    this.cornerB = null;
    this.cornerAMesh.visible = false;
    this.cornerBMesh.visible = false;
    this.group.visible = false;
  }

  public getBounds(): {
    min: THREE.Vector3;
    max: THREE.Vector3;
    size: THREE.Vector3;
    blockCountArea: number;
  } | null {
    if (!this.cornerA) return null;

    const b = this.cornerB || this.cornerA;
    const minX = Math.min(this.cornerA.x, b.x);
    const maxX = Math.max(this.cornerA.x, b.x);
    const minY = Math.min(this.cornerA.y, b.y);
    const maxY = Math.max(this.cornerA.y, b.y);
    const minZ = Math.min(this.cornerA.z, b.z);
    const maxZ = Math.max(this.cornerA.z, b.z);

    const sizeX = maxX - minX + 1;
    const sizeY = maxY - minY + 1;
    const sizeZ = maxZ - minZ + 1;

    return {
      min: new THREE.Vector3(minX, minY, minZ),
      max: new THREE.Vector3(maxX, maxY, maxZ),
      size: new THREE.Vector3(sizeX, sizeY, sizeZ),
      blockCountArea: sizeX * sizeY * sizeZ,
    };
  }

  private updateBox() {
    const bounds = this.getBounds();
    if (!bounds) {
      this.group.visible = false;
      return;
    }

    const { min, size } = bounds;
    this.group.visible = true;

    // Center of volume
    const centerX = min.x + size.x / 2;
    const centerY = min.y + size.y / 2;
    const centerZ = min.z + size.z / 2;

    this.boxMesh.position.set(centerX, centerY, centerZ);
    this.boxMesh.scale.set(size.x + 0.02, size.y + 0.02, size.z + 0.02);

    this.wireframeMesh.position.set(centerX, centerY, centerZ);
    this.wireframeMesh.scale.set(size.x + 0.03, size.y + 0.03, size.z + 0.03);
  }

  public update(delta: number) {
    this.animPhase += delta * 3.5;
    const pulse = 0.2 + Math.sin(this.animPhase) * 0.08;
    (this.boxMesh.material as THREE.MeshBasicMaterial).opacity = pulse;

    if (this.cornerAMesh.visible) {
      this.cornerAMesh.rotation.y += delta * 1.5;
    }
    if (this.cornerBMesh.visible) {
      this.cornerBMesh.rotation.y -= delta * 1.5;
    }
  }

  public dispose() {
    this.scene.remove(this.group);
    this.scene.remove(this.cornerAMesh);
    this.scene.remove(this.cornerBMesh);
    this.boxMesh.geometry.dispose();
    (this.boxMesh.material as THREE.Material).dispose();
    this.wireframeMesh.geometry.dispose();
    (this.wireframeMesh.material as THREE.Material).dispose();
    this.cornerAMesh.geometry.dispose();
    (this.cornerAMesh.material as THREE.Material).dispose();
    this.cornerBMesh.geometry.dispose();
    (this.cornerBMesh.material as THREE.Material).dispose();
  }
}
