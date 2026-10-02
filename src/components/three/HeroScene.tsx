import { useEffect, useRef } from "react";
import * as THREE from "three";

// Scene 3D legere pour le hero : un "ruban" de vagues empilees (clin d'oeil
// au logo Selio) qui ondule doucement en wireframe degrade bleu/blanc.
// Pure CSS/WebGL, aucune dependance payante, poids reduit (three core only).
export function HeroScene({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof window === "undefined") return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 1.4, 6.2);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    const group = new THREE.Group();
    scene.add(group);

    const colors = [0xffffff, 0xbfd4e6, 0x7394ae];
    const waves: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const geometry = new THREE.PlaneGeometry(6, 1.1, 48, 6);
      const material = new THREE.MeshBasicMaterial({
        color: colors[i],
        wireframe: true,
        transparent: true,
        opacity: 0.55 - i * 0.12,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2.6;
      mesh.position.y = -i * 0.55 + 0.4;
      mesh.position.z = -i * 0.3;
      group.add(mesh);
      waves.push(mesh);
    }

    const basePositions = waves.map((m) => Float32Array.from((m.geometry.attributes.position as THREE.BufferAttribute).array));

    let frame = 0;
    let raf = 0;
    function animate() {
      frame += 0.012;
      group.rotation.y = Math.sin(frame * 0.3) * 0.08;

      waves.forEach((mesh, i) => {
        const posAttr = mesh.geometry.attributes.position as THREE.BufferAttribute;
        const base = basePositions[i];
        for (let v = 0; v < posAttr.count; v++) {
          const x = base[v * 3];
          const y = base[v * 3 + 1];
          const z = Math.sin(x * 1.1 + frame + i) * 0.18 + Math.cos(y * 2 + frame * 0.8) * 0.06;
          posAttr.setZ(v, z);
        }
        posAttr.needsUpdate = true;
      });

      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    }
    animate();

    function handleResize() {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", handleResize);
      waves.forEach((m) => {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      });
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={containerRef} className={className} aria-hidden="true" />;
}
