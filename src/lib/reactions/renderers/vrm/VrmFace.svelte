<script lang="ts">
  import { onMount } from 'svelte'
  import * as THREE from 'three'
  import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
  import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm'
  import type { VRMExpressionPresetName } from '@pixiv/three-vrm'
  import type { ReactionViewProps } from '../../types'
  import { resolveAvatarExpression } from '../../avatar-expression'
  import { headTiltToDegrees, vrmFromAvatarExpression } from './mapping'

  let {
    result = null,
    listening = false,
    reacting = false,
    bobbing = false,
    speaking = false,
    voiceMouthOpen = 0,
  }: ReactionViewProps = $props()

  let container = $state<HTMLDivElement | null>(null)
  let model = $state<VRM | null>(null)
  let loadError = $state(false)
  // Head tilt for the render loop; written by the reactive effect below.
  let headTiltDeg = 0

  onMount(() => {
    if (!container) return

    // Renderer / scene / camera sized to the container box.
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    const resize = () => {
      const w = container!.clientWidth || 160
      const h = container!.clientHeight || 160
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20)
    // Head-and-shoulders framing (Seed-san is ~1.5 m tall, head ≈ y 1.35).
    camera.position.set(0, 1.4, 0.9)
    camera.lookAt(0, 1.32, 0)
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(container)

    const light = new THREE.DirectionalLight(0xffffff, Math.PI)
    light.position.set(1, 1, 1).normalize()
    scene.add(light)

    // Head-bone tilt pivot: rotate the neck bone from the weights.
    let disposed = false
    const loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))
    loader.load(
      '/models/Seed-san.vrm',
      (gltf) => {
        if (disposed) {
          VRMUtils.deepDispose(gltf.scene)
          return
        }
        const loaded = gltf.userData.vrm as VRM
        // Perf: strip unneeded vertices/skeletons, combine morph targets.
        VRMUtils.removeUnnecessaryVertices(gltf.scene)
        VRMUtils.combineSkeletons(gltf.scene)
        VRMUtils.combineMorphs(loaded)
        loaded.scene.traverse((obj) => {
          obj.frustumCulled = false
        })
        scene.add(loaded.scene)
        model = loaded
      },
      undefined,
      () => {
        loadError = true
      },
    )

    // Render loop: update VRM components (expressions, lookAt, humanoid).
    const clock = new THREE.Clock()
    let rafId = 0
    const animate = () => {
      rafId = requestAnimationFrame(animate)
      const delta = clock.getDelta()
      if (model) {
        const tilt = THREE.MathUtils.degToRad(headTiltDeg)
        const neck = model.humanoid.getNormalizedBoneNode('neck')
        const head = model.humanoid.getNormalizedBoneNode('head')
        if (neck) neck.rotation.z = tilt
        if (head) head.rotation.z = tilt * 0.5
        model.update(delta)
      }
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      disposed = true
      cancelAnimationFrame(rafId)
      observer.disconnect()
      if (model) {
        scene.remove(model.scene)
        VRMUtils.deepDispose(model.scene)
      }
      renderer.dispose()
      model = null
    }
  })

  // Push the unified weights into the VRM expression manager + head bones.
  $effect(() => {
    const m = model
    if (!m?.expressionManager) return
    const ax = resolveAvatarExpression({ result, listening, reacting, speaking, voiceMouthOpen })
    const map = vrmFromAvatarExpression(ax)
    for (const [name, weight] of Object.entries(map) as [VRMExpressionPresetName, number][]) {
      m.expressionManager.setValue(name, weight)
    }
    // The render loop reads this plain variable each frame.
    headTiltDeg = headTiltToDegrees(ax)
  })

  const label = $derived(
    reacting && result ? `seed-san ${result.emotion} ${result.tone}` : 'seed-san neutral',
  )
</script>

<!--
  Seed-san VRM 1.0 sample model (vrm-c/vrm-specification, by VirtualCast Inc.,
  VRM Public License 1.0) rendered with @pixiv/three-vrm (MIT). Driven by the
  unified AvatarExpression weights via the VRM expression presets.
-->
<div class="transition-transform duration-500" style:transform={`scale(${reacting ? 1.08 : 1})`}>
  <div
    bind:this={container}
    class="h-40 w-32 {bobbing && !reacting ? 'jev-bob' : ''}"
    role="img"
    aria-label={label}
  ></div>
  {#if loadError}
    <span class="text-xs text-red-400">vrm failed to load</span>
  {/if}
</div>
