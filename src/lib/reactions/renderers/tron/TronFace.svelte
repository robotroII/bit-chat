<script lang="ts">
  import { onMount } from 'svelte'
  import * as THREE from 'three'
  import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
  import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
  import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
  import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
  import type { ReactionViewProps } from '../../types'
  import { resolveTronState, type TronBitState } from './mapping'

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

    // The bit: a dark octahedron body with a bright edge wireframe. The
    // edges carry the color and drive the bloom (toneMapped = false lets
    // them exceed the bloom threshold).
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
    const animate = () => {
      rafId = requestAnimationFrame(animate)
      const delta = Math.min(clock.getDelta(), 0.1)
      // Frame-rate independent smoothing toward the target state.
      const k = 1 - Math.exp(-6 * delta)
      // Edge brightness: ~1.2× color at idle, up to ~2.2× at emotional peak.
      // Values above 1 (toneMapped = false) are HDR → they exceed the bloom
      // threshold and glow, while the dark body stays below it.
      edgeColor.copy(target.color).multiplyScalar(0.8 + target.glow * 0.75)
      edgeMaterial.color.lerp(edgeColor, k)

      spinAngle += target.spin * delta
      bit.rotation.y = spinAngle
      bit.rotation.z = THREE.MathUtils.lerp(bit.rotation.z, target.tilt, k)
      bit.position.x = THREE.MathUtils.lerp(bit.position.x, target.driftX, k)
      bit.position.y = THREE.MathUtils.lerp(bit.position.y, target.driftY, k)

      // Scale: lip-sync pulse + blink squash (a bit doesn't blink — it
      // flickers vertically).
      const pulseScale = 1 + target.pulse * 0.18
      const squashScale = 1 - target.squash * 0.4
      bit.scale.set(pulseScale, pulseScale * squashScale, pulseScale)

      composer.render()
    }
    animate()

    return () => {
      cancelAnimationFrame(rafId)
      observer.disconnect()
      scene.remove(bit)
      bodyGeometry.dispose()
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
  hover drift; TTS lip-sync pulses the scale.

  The radial mask fades the canvas edges to transparent so the bloom halo
  dissolves into the page instead of hitting a hard canvas boundary (which
  reads as an uncanny glowing rectangle at high emotion brightness).
-->
<div class="transition-transform duration-500" style:transform={`scale(${reacting ? 1.08 : 1})`}>
  <!-- Larger than the other avatars: transparent canvas, so the extra room is
       invisible — it just gives the glow space to fade before the edge. -->
  <div
    bind:this={container}
    class="h-56 w-48 {bobbing && !reacting ? 'jev-bob' : ''}"
    style="-webkit-mask-image: radial-gradient(ellipse 72% 72% at center, black 55%, transparent 97%); mask-image: radial-gradient(ellipse 72% 72% at center, black 55%, transparent 97%)"
    role="img"
    aria-label={label}
  ></div>
</div>