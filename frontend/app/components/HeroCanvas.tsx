"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * Particle-network hero background. Floating nodes drift in 3D, nearby nodes
 * link with fading lines (like an embedding / knowledge graph), and the whole
 * field parallax-tilts toward the cursor. Pure three.js — no react-three-fiber,
 * so zero React 19 compat risk. Respects prefers-reduced-motion.
 */
export default function HeroCanvas() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const W = () => mount.clientWidth;
    const H = () => mount.clientHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, W() / H(), 0.1, 1000);
    camera.position.z = 48;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W(), H());
    mount.appendChild(renderer.domElement);

    // ── Nodes ──
    const COUNT = window.innerWidth < 640 ? 70 : 130;
    const SPREAD = 70;
    const positions = new Float32Array(COUNT * 3);
    const velocities: THREE.Vector3[] = [];
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * SPREAD;
      positions[i * 3 + 1] = (Math.random() - 0.5) * SPREAD * 0.6;
      positions[i * 3 + 2] = (Math.random() - 0.5) * SPREAD * 0.5;
      velocities.push(
        new THREE.Vector3(
          (Math.random() - 0.5) * 0.04,
          (Math.random() - 0.5) * 0.04,
          (Math.random() - 0.5) * 0.04,
        ),
      );
    }

    const pointsGeo = new THREE.BufferGeometry();
    pointsGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    // Soft circular sprite so points are dots, not squares
    const sprite = (() => {
      const c = document.createElement("canvas");
      c.width = c.height = 64;
      const ctx = c.getContext("2d")!;
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, "rgba(74,222,128,1)");
      g.addColorStop(0.4, "rgba(34,197,94,0.6)");
      g.addColorStop(1, "rgba(34,197,94,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();

    const pointsMat = new THREE.PointsMaterial({
      size: 1.6,
      map: sprite,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      color: 0x86efac,
    });
    const points = new THREE.Points(pointsGeo, pointsMat);
    scene.add(points);

    // ── Links ──
    const MAX_LINKS = COUNT * 6;
    const linkPositions = new Float32Array(MAX_LINKS * 6);
    const linkGeo = new THREE.BufferGeometry();
    linkGeo.setAttribute("position", new THREE.BufferAttribute(linkPositions, 3));
    const linkMat = new THREE.LineBasicMaterial({
      color: 0x22c55e,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
    });
    const links = new THREE.LineSegments(linkGeo, linkMat);
    scene.add(links);

    const LINK_DIST = 13;
    const LINK_DIST_SQ = LINK_DIST * LINK_DIST;

    // ── Pointer parallax ──
    const target = { x: 0, y: 0 };
    const current = { x: 0, y: 0 };
    function onMove(e: PointerEvent) {
      const r = mount!.getBoundingClientRect();
      target.x = ((e.clientX - r.left) / r.width - 0.5) * 2;
      target.y = ((e.clientY - r.top) / r.height - 0.5) * 2;
    }
    window.addEventListener("pointermove", onMove);

    function onResize() {
      camera.aspect = W() / H();
      camera.updateProjectionMatrix();
      renderer.setSize(W(), H());
    }
    window.addEventListener("resize", onResize);

    let raf = 0;
    const pos = pointsGeo.attributes.position.array as Float32Array;

    function frame() {
      // drift nodes
      if (!reduced) {
        for (let i = 0; i < COUNT; i++) {
          pos[i * 3] += velocities[i].x;
          pos[i * 3 + 1] += velocities[i].y;
          pos[i * 3 + 2] += velocities[i].z;
          for (let a = 0; a < 3; a++) {
            const lim = a === 0 ? SPREAD / 2 : a === 1 ? (SPREAD * 0.6) / 2 : (SPREAD * 0.5) / 2;
            if (pos[i * 3 + a] > lim || pos[i * 3 + a] < -lim) {
              velocities[i].setComponent(a, -velocities[i].getComponent(a));
            }
          }
        }
        pointsGeo.attributes.position.needsUpdate = true;
      }

      // rebuild links
      let n = 0;
      for (let i = 0; i < COUNT; i++) {
        const ix = pos[i * 3], iy = pos[i * 3 + 1], iz = pos[i * 3 + 2];
        for (let j = i + 1; j < COUNT; j++) {
          const dx = ix - pos[j * 3];
          const dy = iy - pos[j * 3 + 1];
          const dz = iz - pos[j * 3 + 2];
          const dsq = dx * dx + dy * dy + dz * dz;
          if (dsq < LINK_DIST_SQ && n < MAX_LINKS) {
            linkPositions[n * 6] = ix;
            linkPositions[n * 6 + 1] = iy;
            linkPositions[n * 6 + 2] = iz;
            linkPositions[n * 6 + 3] = pos[j * 3];
            linkPositions[n * 6 + 4] = pos[j * 3 + 1];
            linkPositions[n * 6 + 5] = pos[j * 3 + 2];
            n++;
          }
        }
      }
      linkGeo.setDrawRange(0, n * 2);
      linkGeo.attributes.position.needsUpdate = true;

      // parallax + slow auto-rotate
      current.x += (target.x - current.x) * 0.04;
      current.y += (target.y - current.y) * 0.04;
      const grp = points.parent!;
      grp.rotation.y = current.x * 0.4 + (reduced ? 0 : performance.now() * 0.00002);
      grp.rotation.x = current.y * 0.25;

      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    }
    // wrap points+links in a group for shared rotation
    const group = new THREE.Group();
    scene.add(group);
    group.add(points);
    group.add(links);
    frame();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      pointsGeo.dispose();
      linkGeo.dispose();
      pointsMat.dispose();
      linkMat.dispose();
      sprite.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={mountRef} className="absolute inset-0" style={{ pointerEvents: "none" }} />;
}
