/**
 * The 3D view of a STEP, IGES or STL output: three.js, rendered on demand (only when the camera
 * moves or the view changes, never in a loop). Loaded through a dynamic import from
 * ModelPreview, so three.js stays out of the main bundle. `dispose()` frees every geometry,
 * material and the WebGL context.
 */
import {
  AmbientLight,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Sphere,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'

import type { ModelFormat } from './childPreviewModel'
import { tessellate } from './occt'

export interface MeshData {
  positions: Float32Array
  normals: Float32Array | null
  indices: Uint32Array | null
  /** sRGB 0-1, or null for the default part colour. */
  color: [number, number, number] | null
}

export type ModelView = 'iso' | 'front' | 'top' | 'right'

export interface ModelViewer {
  triangles: number
  setView(view: ModelView): void
  setEdges(visible: boolean): void
  dispose(): void
}

const DEFAULT_COLOR = new Color(0xb4bfcc)
const EDGE_COLOR = 0x1d2733
const EDGE_ANGLE = 25

/** Triangle meshes of a model file. Throws when the file cannot be read. */
export async function parseModel(format: ModelFormat, bytes: Uint8Array): Promise<MeshData[]> {
  if (format === 'stl') {
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    const geometry = new STLLoader().parse(copy.buffer)
    const position = geometry.getAttribute('position')
    const normal = geometry.getAttribute('normal')
    const mesh: MeshData = {
      positions: new Float32Array(position.array),
      normals: normal ? new Float32Array(normal.array) : null,
      indices: null,
      color: null,
    }
    geometry.dispose()
    return position.count > 0 ? [mesh] : []
  }
  const result = await tessellate(format, bytes)
  if (!result.success) throw new Error(format === 'step' ? 'The STEP file could not be read' : 'The IGES file could not be read')
  return result.meshes
    .filter((m) => m.attributes.position.array.length > 0)
    .map((m) => ({
      positions: Float32Array.from(m.attributes.position.array),
      normals: m.attributes.normal ? Float32Array.from(m.attributes.normal.array) : null,
      indices: m.index.array.length > 0 ? Uint32Array.from(m.index.array) : null,
      color: m.color ?? null,
    }))
}

const VIEW_DIRECTIONS: Record<ModelView, { dir: Vector3; up: Vector3 }> = {
  // SOLIDWORKS exports Y up.
  iso: { dir: new Vector3(1, 0.8, 1.2).normalize(), up: new Vector3(0, 1, 0) },
  front: { dir: new Vector3(0, 0, 1), up: new Vector3(0, 1, 0) },
  top: { dir: new Vector3(0, 1, 0), up: new Vector3(0, 0, -1) },
  right: { dir: new Vector3(1, 0, 0), up: new Vector3(0, 1, 0) },
}

/** Mount a viewer in `host`. Throws when WebGL is not available. */
export function createModelViewer(host: HTMLElement, meshes: MeshData[], background: string): ModelViewer {
  const renderer = new WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setClearColor(new Color(background))
  const canvas = renderer.domElement
  canvas.style.display = 'block'
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.outline = 'none'
  host.appendChild(canvas)

  const scene = new Scene()
  const camera = new PerspectiveCamera(30, 1, 0.1, 1e6)
  scene.add(camera)
  scene.add(new AmbientLight(0xffffff, 1.1))
  const key = new DirectionalLight(0xffffff, 2.2)
  key.position.set(1, 1.5, 2)
  camera.add(key)
  const fill = new DirectionalLight(0xffffff, 0.6)
  fill.position.set(-2, -1, 1)
  camera.add(fill)

  const model = new Group()
  const edges = new Group()
  const geometries: BufferGeometry[] = []
  const materials: Array<MeshStandardMaterial | LineBasicMaterial> = []
  const edgeMaterial = new LineBasicMaterial({ color: EDGE_COLOR, transparent: true, opacity: 0.7 })
  materials.push(edgeMaterial)
  let triangles = 0

  for (const data of meshes) {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(data.positions, 3))
    if (data.indices) geometry.setIndex(new BufferAttribute(data.indices, 1))
    if (data.normals && data.normals.length === data.positions.length) {
      geometry.setAttribute('normal', new BufferAttribute(data.normals, 3))
    } else {
      geometry.computeVertexNormals()
    }
    triangles += (data.indices ? data.indices.length : data.positions.length / 3) / 3
    const material = new MeshStandardMaterial({
      color: data.color ? new Color().setRGB(data.color[0], data.color[1], data.color[2]) : DEFAULT_COLOR,
      metalness: 0.15,
      roughness: 0.55,
      side: DoubleSide,
      // Faces sit just behind their edges, so the edges never flicker through them.
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    })
    geometries.push(geometry)
    materials.push(material)
    model.add(new Mesh(geometry, material))
    const edgeGeometry = new EdgesGeometry(geometry, EDGE_ANGLE)
    geometries.push(edgeGeometry)
    edges.add(new LineSegments(edgeGeometry, edgeMaterial))
  }
  scene.add(model)
  scene.add(edges)

  const bounds = new Box3().setFromObject(model)
  const sphere = bounds.getBoundingSphere(new Sphere())
  const radius = Math.max(sphere.radius, 1e-3)
  camera.near = radius / 100
  camera.far = radius * 100
  camera.updateProjectionMatrix()

  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = false
  controls.zoomToCursor = true
  controls.screenSpacePanning = true

  let frame = 0
  const render = () => {
    frame = 0
    renderer.render(scene, camera)
  }
  const requestRender = () => {
    if (!frame) frame = requestAnimationFrame(render)
  }
  controls.addEventListener('change', requestRender)

  const resize = () => {
    const width = Math.max(1, host.clientWidth)
    const height = Math.max(1, host.clientHeight)
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    requestRender()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)

  const setView = (view: ModelView) => {
    const { dir, up } = VIEW_DIRECTIONS[view]
    const width = Math.max(1, host.clientWidth)
    const height = Math.max(1, host.clientHeight)
    const vFov = (camera.fov * Math.PI) / 180
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (width / height))
    // The bounding sphere is loose around most parts; 0.92 of it fills the view without clipping.
    const distance = (radius * 0.92) / Math.sin(Math.min(vFov, hFov) / 2)
    camera.up.copy(up)
    camera.position.copy(sphere.center).addScaledVector(dir, distance)
    camera.lookAt(sphere.center)
    controls.target.copy(sphere.center)
    controls.update()
    requestRender()
  }

  resize()
  setView('iso')

  return {
    triangles: Math.round(triangles),
    setView,
    setEdges(visible) {
      edges.visible = visible
      requestRender()
    },
    dispose() {
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
      controls.removeEventListener('change', requestRender)
      controls.dispose()
      for (const geometry of geometries) geometry.dispose()
      for (const material of materials) material.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
    },
  }
}
