<script lang="ts">
  import { onMount } from 'svelte'
  import * as THREE from 'three'
  import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
  import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
  import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
  import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
  import type { ReactionViewProps } from '../../types'
import { resolveTronState, type BitShape, type TronBitState } from './mapping'
  let {
    result = null,
    listening = false,
    reacting = false,
    bobbing = false,
    speaking = false,
    voiceMouthOpen = 0,
  }: ReactionViewProps = $props()

  let container = $state<HTMLDivElement | null>(null)

  // Render-loop targets, written by the reactive effect below and read
  // non-reactively each frame (same pattern as the VRM head tilt).
  let target: TronBitState = {
    color: new THREE.Color(0x0891b2),
    glow: 0.4,
    spin: 0.6,
    tilt: 0,
    driftX: 0,
    driftY: 0,
    pulse: 0,
    squash: 0,
    shape: 'octa',
    jitter: 0,
    bob: 0,
    bobHz: 0,
    sink: 0,
    lean: 0,
    flicker: 0,
    wander: 0,
    wanderHz: 0,
  }

  onMount(() => {
    if (!container) return

    // Renderer / scene / camera sized to the container box. The Tron world
    // is self-lit (MeshBasicMaterial everywhere) — no lights needed. The
    // canvas is transparent so the bit floats over the page background.
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setClearColor(0x000000, 0)
    renderer.setPixelRatio(window.devicePixelRatio)
    const resize = () => {
      const w = container!.clientWidth || 160
      const h = container!.clientHeight || 160
      renderer.setSize(w, h)
      composer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    // No scene.background: the clear alpha survives the bloom chain, so the
    // backdrop stays transparent while the glow composites over the page.
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 20)
    // Pulled back so the bit fills only ~half the canvas — the bloom halo
    // needs margin to fade out before the edge, or the cutoff looks uncanny.
    camera.position.set(0, 0, 7)
    camera.lookAt(0, 0, 0)

    // The bit: a dark body with a bright edge wireframe. The edges carry
    // the color and drive the bloom (toneMapped = false lets them exceed
    // the bloom threshold). Three geometries = the movie's yes/no morphs:
    // octahedron (default), tetrahedron (YES), flattened octahedron (NO).
    const bit = new THREE.Group()
    const bodyGeometry = new THREE.OctahedronGeometry(0.9)
    const bodyMaterial = new THREE.MeshBasicMaterial({
      color: 0x05070d,
      transparent: true,
      opacity: 0.92,
    })
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial)
    const edgeGeometry = new THREE.EdgesGeometry(bodyGeometry)
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: target.color.clone().multiplyScalar(0.6),
      toneMapped: false,
      transparent: true,
      opacity: 0.95,
    })
    const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial)
    bit.add(body, edges)
    scene.add(bit)

    // Morph targets: tetra (YES) and disc (NO). The disc is the octa scaled
    // flat on y; the tetra is a separate geometry. Both share the materials.
    const tetraGeometry = new THREE.TetrahedronGeometry(1.05)
    const tetraEdges = new THREE.EdgesGeometry(tetraGeometry)
    const tetraBody = new THREE.Mesh(tetraGeometry, bodyMaterial)
    const tetraWire = new THREE.LineSegments(tetraEdges, edgeMaterial)
    const tetra = new THREE.Group()
    tetra.add(tetraBody, tetraWire)
    tetra.visible = false
    scene.add(tetra)

    const discBody = new THREE.Mesh(bodyGeometry, bodyMaterial)
    const discWire = new THREE.LineSegments(edgeGeometry, edgeMaterial)
    const disc = new THREE.Group()
    disc.add(discBody, discWire)
    disc.scale.set(1.25, 0.22, 1.25)
    disc.visible = false
    scene.add(disc)

    // All three shapes, keyed for switching. The active one is visible and
    // driven by the loop; the others hide. Base scales are per-shape (the
    // disc is the octa flattened on y) — the loop multiplies them in, it
    // must not overwrite them.
    const shapes: Record<BitShape, THREE.Group> = { octa: bit, tetra, disc }
    const shapeBaseScale: Record<BitShape, [number, number, number]> = {
      octa: [1, 1, 1],
      tetra: [1, 1, 1],
      disc: [1.25, 0.22, 1.25],
    }
    let activeShape: BitShape = 'octa'

    // Neon glow: real bloom postprocessing (ships with three). Threshold
    // keeps the dark body from blooming; the small radius makes the glow
    // fade out before the canvas edge so no rectangle shows against the page.
    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    const bloom = new UnrealBloomPass(new THREE.Vector2(160, 160), 0.8, 0.3, 0.12)
    composer.addPass(bloom)
    composer.addPass(new OutputPass())
    composer.setPixelRatio(window.devicePixelRatio)

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(container)

    // Render loop: smooth-lerp toward the target state, spin, pulse.
    const clock = new THREE.Clock()
    const edgeColor = new THREE.Color()
    let rafId = 0
    let spinAngle = 0
    let motionTime = 0
    // Pop-on-change: a quick scale bump whenever the shape (and thus the
    // emotion signature) changes, so transitions read at a glance.
    let popT = 1 // 0..1, 1 = settled
    const animate = () => {
      rafId = requestAnimationFrame(animate)
      const delta = Math.min(clock.getDelta(), 0.1)
      motionTime += delta
      // Frame-rate independent smoothing toward the target state (faster
      // than before so emotion changes land with a snap).
      const k = 1 - Math.exp(-9 * delta)
      // Edge brightness: ~1.2× color at idle, up to ~2.2× at emotional peak.
      // Values above 1 (toneMapped = false) are HDR → they exceed the bloom
      // threshold and glow, while the dark body stays below it. Flicker
      // (terrified) modulates the brightness with a fast double-sine wave.
      const flickerMul =
        1 - target.flicker * (0.5 + 0.5 * Math.sin(motionTime * 31)) * (0.5 + 0.5 * Math.sin(motionTime * 7.3))
      edgeColor.copy(target.color).multiplyScalar((0.8 + target.glow * 0.75) * flickerMul)
      edgeMaterial.color.lerp(edgeColor, k)

      // Shape switching with a pop: when the target shape differs, swap
      // visibility and bump the pop timer.
      if (target.shape !== activeShape) {
        shapes[activeShape].visible = false
        activeShape = target.shape
        shapes[activeShape].visible = true
        popT = 0
      }
      popT = Math.min(1, popT + delta * 3.5)
      // Overshooting ease-out: 1 → 1.6 → 1 over ~0.3s.
      const pop = 1 + 0.6 * Math.sin(Math.min(1, popT) * Math.PI)

      // Motion engine: bob (excitement/YES hop), jitter (anger/panic),
      // sink (sadness), wander (left↔right patrol across the landscape
      // canvas while responding), plus gaze drift and lip-sync pulse.
      const bobY = target.bobHz > 0 ? Math.sin(motionTime * target.bobHz * Math.PI * 2) * target.bob : 0
      const wanderX = target.wanderHz > 0 ? Math.sin(motionTime * target.wanderHz * Math.PI * 2) * target.wander : 0
      const jitterX = target.jitter > 0 ? (Math.random() - 0.5) * 2 * target.jitter : 0
      const jitterY = target.jitter > 0 ? (Math.random() - 0.5) * 2 * target.jitter : 0

      const active = shapes[activeShape]
      spinAngle += target.spin * delta
      active.rotation.y = spinAngle
      active.rotation.z = THREE.MathUtils.lerp(active.rotation.z, target.tilt, k)
      active.rotation.x = THREE.MathUtils.lerp(active.rotation.x, target.lean, k)
      active.position.x = THREE.MathUtils.lerp(active.position.x, target.driftX + wanderX + jitterX, k)
      active.position.y = THREE.MathUtils.lerp(active.position.y, target.driftY + bobY - target.sink + jitterY, k)

      // Scale: per-shape base (disc is flattened) × pop bump × lip-sync
      // pulse × blink squash (a bit doesn't blink — it flickers hard).
      const [bx, by, bz] = shapeBaseScale[activeShape]
      const pulseScale = pop * (1 + target.pulse * 0.3)
      const squashScale = 1 - target.squash * 0.6
      active.scale.set(pulseScale * bx, pulseScale * by * squashScale, pulseScale * bz)

      composer.render()
    }
    animate()

    return () => {
      cancelAnimationFrame(rafId)
      observer.disconnect()
      scene.remove(bit, tetra, disc)
      bodyGeometry.dispose()
      tetraGeometry.dispose()
      tetraEdges.dispose()
      bodyMaterial.dispose()
      edgeGeometry.dispose()
      edgeMaterial.dispose()
      bloom.dispose()
      composer.dispose()
      renderer.dispose()
    }
  })

  // Push the unified weights into the render-loop targets.
  $effect(() => {
    target = resolveTronState({ result, listening, reacting, speaking, voiceMouthOpen })
  })

  const label = $derived(
    reacting && result ? `tron bit ${result.emotion} ${result.tone}` : 'tron bit neutral',
  )
</script>

<!--
  Tron Bit (1982) — a floating glowing octahedron program, plain three.js.
  Emotion is expressed through color, glow, spin speed, posture tilt and
  hover drift; TTS lip-sync pulses the scale. While responding, the bit
  patrols the landscape canvas left ↔ right (wander).

  The radial mask fades the canvas edges to transparent so the bloom halo
  dissolves into the page instead of hitting a hard canvas boundary (which
  reads as an uncanny glowing rectangle at high emotion brightness).
-->
<div class="transition-transform duration-500" style:transform={`scale(${reacting ? 1.08 : 1})`}>
  <!-- Landscape format: extra width is invisible (transparent canvas) — it
       gives the glow margin AND room for the left↔right wander patrol. -->
  <div
    bind:this={container}
    class="h-44 w-72 {bobbing && !reacting ? 'jev-bob' : ''}"
    style="-webkit-mask-image: radial-gradient(ellipse 78% 82% at center, black 52%, transparent 98%); mask-image: radial-gradient(ellipse 78% 82% at center, black 52%, transparent 98%)"
    role="img"
    aria-label={label}
  ></div>
</div>