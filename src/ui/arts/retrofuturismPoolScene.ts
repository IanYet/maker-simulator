import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'

type SceneController = {
	dispose: () => void
}

type AnimatedPlanet = {
	group: THREE.Group
	body: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>
	origin: THREE.Vector3
	phase: number
	speed: number
	horizontalAmplitude: number
	verticalAmplitude: number
	depthAmplitude: number
	rotationSpeed: number
}

type SceneBuildResult = {
	waterMaterial: THREE.ShaderMaterial
	planets: AnimatedPlanet[]
	textures: THREE.Texture[]
}

type PlanetOptions = {
	position: THREE.Vector3
	radius: number
	texture: THREE.Texture
	emissive: number
	emissiveIntensity: number
	phase: number
	speed: number
	horizontalAmplitude: number
	verticalAmplitude: number
	depthAmplitude?: number
	rotationSpeed: number
	rings?: {
		innerRadius: number
		outerRadius: number
		color: number
		rotation: THREE.Euler
		emissiveIntensity?: number
	}[]
}

const WATER_VERTEX_SHADER = /* glsl */ `
	uniform float uTime;
	varying vec2 vUv;
	varying float vWave;

	void main() {
		vUv = uv;
		vec3 transformed = position;
		float broadWave = sin(position.x * 1.18 + uTime * 0.42) * 0.035;
		float crossWave = sin(position.y * 0.72 - uTime * 0.31) * 0.028;
		float fineWave = sin((position.x + position.y) * 2.4 + uTime * 0.58) * 0.009;
		vWave = broadWave + crossWave + fineWave;
		transformed.z += vWave;
		gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
	}
`

const WATER_FRAGMENT_SHADER = /* glsl */ `
	uniform float uTime;
	uniform vec3 uDeepColor;
	uniform vec3 uShallowColor;
	uniform vec3 uWarmReflection;
	varying vec2 vUv;
	varying float vWave;

	float softBand(float value, float center, float width) {
		return smoothstep(width, 0.0, abs(value - center));
	}

	void main() {
		float rippleA = sin(vUv.y * 82.0 + sin(vUv.x * 18.0) * 2.4 - uTime * 0.7);
		float rippleB = sin(vUv.x * 49.0 - vUv.y * 21.0 + uTime * 0.48);
		float ripples = rippleA * 0.5 + rippleB * 0.5;
		float depthFade = smoothstep(0.02, 0.88, vUv.y);
		vec3 color = mix(uDeepColor, uShallowColor, depthFade * 0.58 + vWave * 2.0);

		float skylight = softBand(fract(vUv.x * 2.9 + ripples * 0.012), 0.56, 0.18);
		float farGlow = smoothstep(0.5, 1.0, vUv.y) * (0.45 + ripples * 0.08);
		color += vec3(0.045, 0.13, 0.14) * (ripples * 0.5 + 0.5);
		color = mix(color, uWarmReflection, skylight * farGlow * 0.17);

		float edgeShade = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
		color *= mix(0.72, 1.0, edgeShade);
		gl_FragColor = vec4(color, 0.82);
	}
`

const RETRO_PRINT_SHADER = {
	uniforms: {
		tDiffuse: { value: null },
		uResolution: { value: new THREE.Vector2(1, 1) },
	},
	vertexShader: /* glsl */ `
		varying vec2 vUv;

		void main() {
			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
		}
	`,
	fragmentShader: /* glsl */ `
		uniform sampler2D tDiffuse;
		uniform vec2 uResolution;
		varying vec2 vUv;

		float hash21(vec2 value) {
			value = fract(value * vec2(123.34, 456.21));
			value += dot(value, value + 45.32);
			return fract(value.x * value.y);
		}

		float paperNoise(vec2 pixel) {
			float fine = hash21(floor(pixel * 0.72));
			float coarse = hash21(floor(pixel * 0.115) + 19.7);
			return (fine - 0.5) * 0.72 + (coarse - 0.5) * 0.28;
		}

		void main() {
			vec2 centered = vUv - 0.5;
			float radial = dot(centered, centered);
			vec2 separation = centered * (0.0009 + radial * 0.00135);

			vec3 color;
			color.r = texture2D(tDiffuse, vUv + separation).r;
			color.g = texture2D(tDiffuse, vUv).g;
			color.b = texture2D(tDiffuse, vUv - separation * 0.78).b;

			color = vec3(
				color.r * 1.035 + color.g * 0.022,
				color.g * 0.995 + color.b * 0.028,
				color.b * 0.965 + color.g * 0.032
			);

			float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
			float shadowLift = 1.0 - smoothstep(0.08, 0.48, luminance);
			color += vec3(0.048, 0.065, 0.067) * shadowLift;
			color = pow(max(color, 0.0), vec3(0.94));
			color = mix(vec3(dot(color, vec3(0.2126, 0.7152, 0.0722))), color, 0.9);
			color = floor(color * 96.0 + 0.5) / 96.0;

			float grain = paperNoise(gl_FragCoord.xy);
			float grainStrength = mix(0.038, 0.022, smoothstep(0.1, 0.82, luminance));
			color += grain * grainStrength;

			float dust = step(0.9978, hash21(floor(gl_FragCoord.xy * 0.42) + 7.0));
			color = mix(color, vec3(0.8, 0.7, 0.56), dust * 0.17);

			float vignette = smoothstep(0.86, 0.19, radial);
			color *= mix(0.9, 1.0, vignette);
			gl_FragColor = vec4(max(color, 0.0), 1.0);
		}
	`,
}

/**
 * 在指定容器中挂载固定机位的复古未来泳池场景。
 * 返回的控制器负责停止动画、释放 WebGL 资源并移除画布。
 */
export function mountRetrofuturismPoolScene(container: HTMLElement): SceneController {
	const renderer = new THREE.WebGLRenderer({
		antialias: true,
		powerPreference: 'high-performance',
		alpha: false,
	})
	renderer.outputColorSpace = THREE.SRGBColorSpace
	renderer.toneMapping = THREE.ACESFilmicToneMapping
	renderer.toneMappingExposure = 1.18
	renderer.shadowMap.enabled = true
	renderer.shadowMap.type = THREE.PCFShadowMap
	renderer.domElement.dataset.scene = 'retrofuturism-pool'
	container.append(renderer.domElement)

	const scene = new THREE.Scene()
	scene.background = new THREE.Color(0x173941)
	scene.fog = new THREE.FogExp2(0x244b51, 0.008)

	const referenceAspect = 1220 / 1789
	const referenceFov = 49
	const camera = new THREE.PerspectiveCamera(referenceFov, 1, 0.1, 80)
	camera.position.set(-0.2, 3.15, 13.2)
	camera.lookAt(-0.4, 4.3, -5.8)

	const buildResult = buildScene(scene, renderer.capabilities.getMaxAnisotropy())
	const composer = new EffectComposer(renderer)
	const renderPass = new RenderPass(scene, camera)
	const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.12, 0.72, 0.92)
	const printPass = new ShaderPass(RETRO_PRINT_SHADER)
	const outputPass = new OutputPass()
	composer.addPass(renderPass)
	composer.addPass(bloomPass)
	composer.addPass(printPass)
	composer.addPass(outputPass)

	const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
	let animationFrame = 0
	let disposed = false
	let startedAt = performance.now()

	const renderFrame = (elapsed: number) => {
		buildResult.waterMaterial.uniforms.uTime.value = elapsed
		for (const planet of buildResult.planets) {
			const breath = elapsed * planet.speed + planet.phase
			planet.group.position.set(
				planet.origin.x + Math.sin(breath * 0.73) * planet.horizontalAmplitude,
				planet.origin.y + Math.sin(breath) * planet.verticalAmplitude,
				planet.origin.z + Math.cos(breath * 0.61) * planet.depthAmplitude,
			)
			planet.body.rotation.y = elapsed * planet.rotationSpeed + planet.phase * 0.2
		}
		composer.render()
	}

	const animate = (now: number) => {
		if (disposed) {
			return
		}
		renderFrame((now - startedAt) / 1000)
		animationFrame = window.requestAnimationFrame(animate)
	}

	const stopAnimation = () => {
		window.cancelAnimationFrame(animationFrame)
		animationFrame = 0
	}

	const startAnimation = () => {
		stopAnimation()
		if (reducedMotionQuery.matches || document.hidden) {
			renderFrame(0)
			return
		}
		startedAt = performance.now()
		animationFrame = window.requestAnimationFrame(animate)
	}

	const resize = () => {
		const width = Math.max(1, container.clientWidth)
		const height = Math.max(1, container.clientHeight)
		const pixelRatio = Math.min(window.devicePixelRatio, 1.75)
		camera.aspect = width / height
		camera.fov =
			camera.aspect < referenceAspect
				? THREE.MathUtils.radToDeg(
						2 *
							Math.atan(
								Math.tan(THREE.MathUtils.degToRad(referenceFov) / 2) *
									(referenceAspect / camera.aspect),
							),
					)
				: referenceFov
		camera.updateProjectionMatrix()
		renderer.setPixelRatio(pixelRatio)
		renderer.setSize(width, height, false)
		composer.setPixelRatio(pixelRatio)
		composer.setSize(width, height)
		printPass.uniforms.uResolution.value.set(width * pixelRatio, height * pixelRatio)
		renderFrame(reducedMotionQuery.matches ? 0 : (performance.now() - startedAt) / 1000)
	}

	const handleVisibilityChange = () => {
		if (document.hidden) {
			stopAnimation()
			return
		}
		startAnimation()
	}

	const resizeObserver = new ResizeObserver(resize)
	resizeObserver.observe(container)
	document.addEventListener('visibilitychange', handleVisibilityChange)
	reducedMotionQuery.addEventListener('change', startAnimation)
	resize()
	startAnimation()
	container.dataset.ready = 'true'

	return {
		dispose: () => {
			if (disposed) {
				return
			}
			disposed = true
			stopAnimation()
			resizeObserver.disconnect()
			document.removeEventListener('visibilitychange', handleVisibilityChange)
			reducedMotionQuery.removeEventListener('change', startAnimation)
			disposeScene(scene, buildResult.textures)
			bloomPass.dispose()
			composer.dispose()
			renderer.dispose()
			renderer.forceContextLoss()
			renderer.domElement.remove()
			delete container.dataset.ready
		},
	}
}

function buildScene(scene: THREE.Scene, maxAnisotropy: number): SceneBuildResult {
	const textures: THREE.Texture[] = []
	const concreteTexture = createMottledTexture('#8ea4a5', ['#617f83', '#c5b59e'], 4, 512)
	const deckTexture = createMottledTexture('#cda274', ['#806351', '#ebc99e'], 9, 512)
	const tileTexture = createTileTexture()
	const navyTexture = createMottledTexture('#183b43', ['#315860', '#102c34'], 14, 512)
	const orangePlanetTexture = createPlanetTexture('orange')
	const stripedPlanetTexture = createPlanetTexture('striped')
	const palePlanetTexture = createPlanetTexture('pale')
	const rustPlanetTexture = createPlanetTexture('rust')
	const personTexture = createSwimmerSpriteTexture()
	textures.push(
		concreteTexture,
		deckTexture,
		tileTexture,
		navyTexture,
		orangePlanetTexture,
		stripedPlanetTexture,
		palePlanetTexture,
		rustPlanetTexture,
		personTexture,
	)
	for (const texture of textures) {
		texture.anisotropy = Math.min(maxAnisotropy, 8)
	}

	const concrete = new THREE.MeshStandardMaterial({
		color: 0x91a5a4,
		map: concreteTexture,
		roughness: 0.88,
		metalness: 0.03,
	})
	const darkConcrete = new THREE.MeshStandardMaterial({
		color: 0x647f80,
		map: concreteTexture,
		roughness: 0.92,
	})
	const celestialRoof = new THREE.MeshStandardMaterial({
		color: 0x21434a,
		map: navyTexture,
		roughness: 0.95,
		side: THREE.DoubleSide,
	})
	const deck = new THREE.MeshStandardMaterial({
		color: 0xcaa074,
		map: deckTexture,
		roughness: 0.91,
	})
	const poolTile = new THREE.MeshStandardMaterial({
		color: 0x83b9b8,
		map: tileTexture,
		roughness: 0.58,
		metalness: 0.04,
	})
	const deepTile = new THREE.MeshStandardMaterial({
		color: 0x356772,
		map: tileTexture,
		roughness: 0.66,
	})
	const glass = new THREE.MeshPhysicalMaterial({
		color: 0x173840,
		roughness: 0.23,
		metalness: 0.12,
		transmission: 0.08,
		transparent: true,
		opacity: 0.94,
	})
	const cream = new THREE.MeshStandardMaterial({
		color: 0xe5c093,
		roughness: 0.68,
	})
	const steel = new THREE.MeshStandardMaterial({
		color: 0x687d80,
		roughness: 0.5,
		metalness: 0.52,
	})
	const darkMetal = new THREE.MeshStandardMaterial({
		color: 0x385157,
		roughness: 0.46,
		metalness: 0.48,
	})

	addLighting(scene)
	addVault(scene, navyTexture)
	addPoolAndDeck(scene, { deck, poolTile, deepTile, cream, steel, darkMetal })
	addArchitecture(scene, { concrete, darkConcrete, celestialRoof, glass, cream })
	addStars(scene)

	const planets = addPlanets(scene, {
		orange: orangePlanetTexture,
		striped: stripedPlanetTexture,
		pale: palePlanetTexture,
		rust: rustPlanetTexture,
	})
	addSwimmer(scene, personTexture)

	const waterMaterial = new THREE.ShaderMaterial({
		uniforms: {
			uTime: { value: 0 },
			uDeepColor: { value: new THREE.Color(0x2b5d69) },
			uShallowColor: { value: new THREE.Color(0x62a2a6) },
			uWarmReflection: { value: new THREE.Color(0xe7b17c) },
		},
		vertexShader: WATER_VERTEX_SHADER,
		fragmentShader: WATER_FRAGMENT_SHADER,
		transparent: true,
		depthWrite: false,
		side: THREE.DoubleSide,
	})
	const water = new THREE.Mesh(new THREE.PlaneGeometry(6.1, 17.7, 96, 160), waterMaterial)
	water.position.set(1.4, 0.48, 0.9)
	water.rotation.x = -Math.PI / 2
	water.renderOrder = 2
	scene.add(water)

	return { waterMaterial, planets, textures }
}

function addLighting(scene: THREE.Scene) {
	const hemisphere = new THREE.HemisphereLight(0xb5d1ce, 0x735846, 2.35)
	scene.add(hemisphere)

	const skylight = new THREE.DirectionalLight(0xffd2a6, 3.15)
	skylight.position.set(-6, 13, 9)
	skylight.target.position.set(1.4, 0, -3)
	skylight.castShadow = true
	skylight.shadow.mapSize.set(2048, 2048)
	skylight.shadow.camera.near = 1
	skylight.shadow.camera.far = 36
	skylight.shadow.camera.left = -12
	skylight.shadow.camera.right = 12
	skylight.shadow.camera.top = 15
	skylight.shadow.camera.bottom = -8
	skylight.shadow.bias = -0.0004
	scene.add(skylight, skylight.target)

	const poolGlow = new THREE.PointLight(0x75c5c8, 12, 18, 1.8)
	poolGlow.position.set(1.4, 0.3, -2)
	scene.add(poolGlow)

	const planetGlow = new THREE.PointLight(0xed8258, 17, 18, 1.75)
	planetGlow.position.set(5.1, 7.1, -3)
	scene.add(planetGlow)
}

function addVault(scene: THREE.Scene, texture: THREE.Texture) {
	const vaultMaterial = new THREE.MeshStandardMaterial({
		color: 0x1a3d45,
		map: texture,
		roughness: 0.96,
		side: THREE.BackSide,
	})
	const vault = new THREE.Mesh(new THREE.SphereGeometry(29, 64, 40), vaultMaterial)
	vault.position.set(0, 3.8, -7)
	vault.scale.set(1, 0.68, 1)
	vault.receiveShadow = true
	scene.add(vault)
}

function addPoolAndDeck(
	scene: THREE.Scene,
	materials: {
		deck: THREE.Material
		poolTile: THREE.Material
		deepTile: THREE.Material
		cream: THREE.Material
		steel: THREE.Material
		darkMetal: THREE.Material
	},
) {
	const { deck, poolTile, deepTile, cream, steel, darkMetal } = materials
	addBox(scene, [5.7, 0.48, 23], [-4.55, 0.18, 1.2], deck)
	addBox(scene, [2.8, 0.48, 23], [5.9, 0.18, 1.2], deck)
	addBox(scene, [16, 0.48, 2.7], [0, 0.18, -9.4], deck)
	addBox(scene, [16, 0.48, 3], [0, 0.18, 11.25], deck)

	addBox(scene, [6.2, 0.2, 18.2], [1.4, -1.82, 0.9], deepTile)
	addBox(scene, [0.2, 2.3, 18.2], [-1.72, -0.68, 0.9], poolTile)
	addBox(scene, [0.2, 2.3, 18.2], [4.52, -0.68, 0.9], poolTile)
	addBox(scene, [6.2, 2.3, 0.2], [1.4, -0.68, -8.22], poolTile)
	addBox(scene, [6.2, 2.3, 0.2], [1.4, -0.68, 10.02], poolTile)

	addBox(scene, [0.34, 0.23, 18.3], [-1.8, 0.46, 0.9], cream)
	addBox(scene, [0.34, 0.23, 18.3], [4.6, 0.46, 0.9], cream)
	addBox(scene, [6.75, 0.23, 0.34], [1.4, 0.46, -8.3], cream)
	addBox(scene, [6.75, 0.23, 0.34], [1.4, 0.46, 10.1], cream)

	for (const x of [-0.82, 0.67, 2.17, 3.67]) {
		addBox(scene, [0.055, 0.025, 17.6], [x, -1.69, 0.9], cream, undefined, false, false)
	}

	addPoolPorthole(scene, 4.4, -0.62, -3.4, darkMetal, steel)
	addPoolPorthole(scene, 4.4, -0.62, 3.35, darkMetal, steel)
	addLadder(scene, steel)
}

function addPoolPorthole(
	scene: THREE.Scene,
	x: number,
	y: number,
	z: number,
	darkMaterial: THREE.Material,
	ringMaterial: THREE.Material,
) {
	const disk = new THREE.Mesh(new THREE.CircleGeometry(0.32, 32), darkMaterial)
	disk.position.set(x - 0.108, y, z)
	disk.rotation.y = -Math.PI / 2
	scene.add(disk)
	const ring = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.065, 10, 48), ringMaterial)
	ring.position.set(x - 0.12, y, z)
	ring.rotation.y = Math.PI / 2
	scene.add(ring)
}

function addLadder(scene: THREE.Scene, material: THREE.Material) {
	for (const x of [-0.52, -0.22]) {
		const curve = new THREE.CatmullRomCurve3([
			new THREE.Vector3(x, -0.92, 8.2),
			new THREE.Vector3(x, 0.62, 8.2),
			new THREE.Vector3(x, 1.86, 8.42),
			new THREE.Vector3(x, 1.9, 9.08),
			new THREE.Vector3(x, 0.5, 9.42),
		])
		const rail = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.052, 10, false), material)
		rail.castShadow = true
		scene.add(rail)
	}
	for (const [y, z] of [
		[-0.52, 8.19],
		[-0.08, 8.19],
		[0.36, 8.2],
	] as const) {
		addBox(scene, [0.3, 0.052, 0.09], [-0.37, y, z], material)
	}
}

function addArchitecture(
	scene: THREE.Scene,
	materials: {
		concrete: THREE.Material
		darkConcrete: THREE.Material
		celestialRoof: THREE.Material
		glass: THREE.Material
		cream: THREE.Material
	},
) {
	const { concrete, darkConcrete, celestialRoof, glass, cream } = materials
	addCurvedRoof(scene, celestialRoof)

	const ribDepths = [-8.55, -6.55, -4.55]
	for (const z of ribDepths) {
		addRoofRib(scene, z, concrete)
	}

	for (let index = 0; index < ribDepths.length - 1; index += 1) {
		const start = ribDepths[index]
		const end = ribDepths[index + 1]
		const z = (start + end) / 2
		addBox(scene, [0.3, 3.45, end - start - 0.3], [5.22, 2.2, z], darkConcrete)
	}
	addBox(scene, [0.3, 3.45, 13.9], [5.22, 2.2, 2.35], darkConcrete)

	for (const z of [-6.5, -2.4, 1.7, 5.8]) {
		const disk = new THREE.Mesh(new THREE.CircleGeometry(0.3, 32), glass)
		disk.position.set(5.05, 2.25, z)
		disk.rotation.y = -Math.PI / 2
		scene.add(disk)
		const ring = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.075, 10, 40), cream)
		ring.position.set(5.03, 2.25, z)
		ring.rotation.y = Math.PI / 2
		scene.add(ring)
	}

	const windowXs = [-5.95, -3.55, -1.15]
	for (const x of windowXs) {
		const windowPanel = addBox(scene, [2.14, 3.25, 0.18], [x, 2.2, -8.92], glass)
		windowPanel.castShadow = false
	}
	for (const x of [-7.1, -4.78, -2.38, 0.02]) {
		addBox(scene, [0.16, 3.65, 0.3], [x, 2.3, -8.77], concrete)
	}
	for (const x of [1.28, 3.78, 6.05]) {
		addBox(scene, [2.16, 3.55, 0.28], [x, 2.35, -8.86], darkConcrete)
	}
	addBox(scene, [14.1, 0.2, 0.34], [-0.05, 4.06, -8.72], concrete, [0, 0, 0.065])
	addBox(scene, [14.2, 0.16, 0.38], [-0.05, 4.38, -8.68], cream, [0, 0, 0.065])

	const skylightMaterial = new THREE.MeshStandardMaterial({
		color: 0xe7b796,
		emissive: 0xe98967,
		emissiveIntensity: 1.08,
		roughness: 0.58,
	})
	for (const x of [-6.8, -5.28, -3.76, -2.48]) {
		const rotation = Math.atan(-0.11 * x)
		addBox(scene, [1.12, 0.14, 19.2], [x, roofHeightAt(x) - 0.12, 0.15], skylightMaterial, [
			0,
			0,
			rotation,
		])
	}
	for (const x of [-6.03, -4.51, -3.01]) {
		addBox(scene, [0.18, 0.32, 19.55], [x, roofHeightAt(x) - 0.13, 0.15], darkConcrete, [
			0,
			0,
			Math.atan(-0.11 * x),
		])
	}
	for (const z of [-7.6, -2.5, 2.6, 7.7]) {
		addBox(scene, [5.7, 0.32, 0.3], [-4.72, 10.65, z], concrete, [0, 0, 0.47])
	}
	addBox(scene, [0.2, 0.34, 19.6], [-2.05, roofHeightAt(-2.05) - 0.08, 0.15], cream)
}

function addCurvedRoof(scene: THREE.Scene, material: THREE.Material) {
	const xMin = -2.05
	const xMax = 7.15
	const zMin = -9.15
	const zMax = 9.6
	const xSegments = 36
	const zSegments = 28
	const positions: number[] = []
	const uvs: number[] = []
	const indices: number[] = []

	for (let zIndex = 0; zIndex <= zSegments; zIndex += 1) {
		const zProgress = zIndex / zSegments
		const z = THREE.MathUtils.lerp(zMin, zMax, zProgress)
		for (let xIndex = 0; xIndex <= xSegments; xIndex += 1) {
			const xProgress = xIndex / xSegments
			const x = THREE.MathUtils.lerp(xMin, xMax, xProgress)
			positions.push(x, roofHeightAt(x), z)
			uvs.push(xProgress, zProgress)
		}
	}

	for (let zIndex = 0; zIndex < zSegments; zIndex += 1) {
		for (let xIndex = 0; xIndex < xSegments; xIndex += 1) {
			const row = xSegments + 1
			const first = zIndex * row + xIndex
			const second = first + row
			indices.push(first, second, first + 1, second, second + 1, first + 1)
		}
	}

	const geometry = new THREE.BufferGeometry()
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
	geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
	geometry.setIndex(indices)
	geometry.computeVertexNormals()
	const roof = new THREE.Mesh(geometry, material)
	roof.receiveShadow = true
	scene.add(roof)
}

function addRoofRib(scene: THREE.Scene, z: number, material: THREE.Material) {
	const shape = new THREE.Shape()
	shape.moveTo(5.56, 0.46)
	shape.lineTo(5.56, 4.08)
	shape.bezierCurveTo(5.56, 4.67, 4.42, 4.92, 3.35, 4.94)
	shape.bezierCurveTo(2.9, 4.95, 2.48, 4.95, 2.05, 4.95)
	shape.lineTo(2.05, 4.49)
	shape.bezierCurveTo(2.48, 4.49, 2.9, 4.49, 3.31, 4.48)
	shape.bezierCurveTo(4.18, 4.46, 5.06, 4.33, 5.06, 3.92)
	shape.lineTo(5.06, 0.46)
	shape.closePath()

	const geometry = new THREE.ExtrudeGeometry(shape, {
		depth: 0.34,
		bevelEnabled: true,
		bevelSegments: 2,
		bevelSize: 0.045,
		bevelThickness: 0.04,
	})
	geometry.translate(0, 0, -0.17)
	const rib = new THREE.Mesh(geometry, material)
	rib.position.z = z
	rib.castShadow = true
	rib.receiveShadow = true
	scene.add(rib)
}

function roofHeightAt(x: number) {
	return 12.2 - 0.055 * x * x
}

function addStars(scene: THREE.Scene) {
	const starMaterial = new THREE.MeshStandardMaterial({
		color: 0xf4d7a6,
		emissive: 0xffd7a2,
		emissiveIntensity: 0.86,
		roughness: 0.7,
	})
	const stars = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.065, 0), starMaterial, 34)
	const random = createRandom(88)
	const matrix = new THREE.Matrix4()
	for (let index = 0; index < 34; index += 1) {
		const scale = 0.45 + random() * 0.78
		const x = -1.75 + random() * 8.45
		matrix.compose(
			new THREE.Vector3(x, roofHeightAt(x) - 0.2, -7.8 + random() * 9.3),
			new THREE.Quaternion(),
			new THREE.Vector3(scale, scale, scale),
		)
		stars.setMatrixAt(index, matrix)
	}
	stars.instanceMatrix.needsUpdate = true
	scene.add(stars)

	for (const [x, y, z, scale] of [
		[-0.15, 5.78, -6.2, 0.72],
		[5.45, 9.95, -5.7, 0.64],
		[-1.45, 9.7, -6.8, 0.48],
		[2.3, 6.65, -6.6, 0.44],
	] as const) {
		const star = new THREE.Group()
		star.position.set(x, y, z)
		addBox(
			star,
			[0.05 * scale, 0.42 * scale, 0.05],
			[0, 0, 0],
			starMaterial,
			undefined,
			false,
			false,
		)
		addBox(
			star,
			[0.42 * scale, 0.05 * scale, 0.05],
			[0, 0, 0],
			starMaterial,
			undefined,
			false,
			false,
		)
		scene.add(star)
	}
}

function addPlanets(
	scene: THREE.Scene,
	textures: {
		orange: THREE.Texture
		striped: THREE.Texture
		pale: THREE.Texture
		rust: THREE.Texture
	},
) {
	const planets: AnimatedPlanet[] = []
	planets.push(
		createPlanet(scene, {
			position: new THREE.Vector3(4.373, 6.624, -1),
			radius: 2.45,
			texture: textures.orange,
			emissive: 0x5d2418,
			emissiveIntensity: 0.25,
			phase: 0.3,
			speed: 0.25,
			horizontalAmplitude: 0.06,
			verticalAmplitude: 0.08,
			depthAmplitude: 0.03,
			rotationSpeed: 0.018,
			rings: [
				{
					innerRadius: 2.64,
					outerRadius: 2.99,
					color: 0xe6c39d,
					rotation: new THREE.Euler(1.18, 0.05, -0.25),
				},
				{
					innerRadius: 3.05,
					outerRadius: 3.17,
					color: 0xd99b70,
					rotation: new THREE.Euler(1.18, 0.05, -0.25),
					emissiveIntensity: 0.12,
				},
			],
		}),
		createPlanet(scene, {
			position: new THREE.Vector3(1.994, 8.906, -1),
			radius: 0.98,
			texture: textures.pale,
			emissive: 0x3e372c,
			emissiveIntensity: 0.18,
			phase: 1.7,
			speed: 0.31,
			horizontalAmplitude: 0.05,
			verticalAmplitude: 0.07,
			depthAmplitude: 0.025,
			rotationSpeed: -0.026,
			rings: [
				{
					innerRadius: 1.1,
					outerRadius: 1.31,
					color: 0x789496,
					rotation: new THREE.Euler(1.22, 0.08, -0.2),
					emissiveIntensity: 0.08,
				},
				{
					innerRadius: 1.33,
					outerRadius: 1.48,
					color: 0xbc5c52,
					rotation: new THREE.Euler(1.22, 0.08, -0.2),
					emissiveIntensity: 0.12,
				},
				{
					innerRadius: 1.5,
					outerRadius: 1.62,
					color: 0xb2aaa0,
					rotation: new THREE.Euler(1.22, 0.08, -0.2),
					emissiveIntensity: 0.07,
				},
			],
		}),
		createPlanet(scene, {
			position: new THREE.Vector3(-0.67, 8.3, -7),
			radius: 0.67,
			texture: textures.orange,
			emissive: 0x9b3d1e,
			emissiveIntensity: 0.52,
			phase: 3.1,
			speed: 0.38,
			horizontalAmplitude: 0.07,
			verticalAmplitude: 0.11,
			depthAmplitude: 0.035,
			rotationSpeed: 0.034,
		}),
		createPlanet(scene, {
			position: new THREE.Vector3(-3.32, 5.68, -7),
			radius: 1.45,
			texture: textures.striped,
			emissive: 0x334b4c,
			emissiveIntensity: 0.2,
			phase: 4.4,
			speed: 0.29,
			horizontalAmplitude: 0.08,
			verticalAmplitude: 0.1,
			depthAmplitude: 0.04,
			rotationSpeed: -0.022,
		}),
		createPlanet(scene, {
			position: new THREE.Vector3(-1.81, 6.23, -7),
			radius: 0.29,
			texture: textures.pale,
			emissive: 0x405052,
			emissiveIntensity: 0.18,
			phase: 2.4,
			speed: 0.41,
			horizontalAmplitude: 0.04,
			verticalAmplitude: 0.065,
			rotationSpeed: 0.04,
		}),
		createPlanet(scene, {
			position: new THREE.Vector3(0.22, 5.86, -7),
			radius: 0.31,
			texture: textures.rust,
			emissive: 0x463325,
			emissiveIntensity: 0.18,
			phase: 5.6,
			speed: 0.35,
			horizontalAmplitude: 0.045,
			verticalAmplitude: 0.07,
			rotationSpeed: -0.038,
		}),
	)
	return planets
}

function createPlanet(scene: THREE.Scene, options: PlanetOptions): AnimatedPlanet {
	const group = new THREE.Group()
	group.position.copy(options.position)
	const material = new THREE.MeshStandardMaterial({
		map: options.texture,
		color: 0xffffff,
		emissive: options.emissive,
		emissiveIntensity: options.emissiveIntensity,
		roughness: 0.82,
		metalness: 0.01,
	})
	const body = new THREE.Mesh(new THREE.SphereGeometry(options.radius, 64, 40), material)
	body.castShadow = true
	body.receiveShadow = true
	group.add(body)

	for (const ringOptions of options.rings ?? []) {
		const ringMaterial = new THREE.MeshStandardMaterial({
			color: ringOptions.color,
			emissive: ringOptions.color,
			emissiveIntensity: ringOptions.emissiveIntensity ?? 0.16,
			roughness: 0.78,
			side: THREE.DoubleSide,
		})
		const ring = new THREE.Mesh(
			new THREE.RingGeometry(ringOptions.innerRadius, ringOptions.outerRadius, 160, 2),
			ringMaterial,
		)
		ring.rotation.copy(ringOptions.rotation)
		ring.castShadow = true
		ring.receiveShadow = true
		group.add(ring)
	}

	scene.add(group)
	return {
		group,
		body,
		origin: options.position.clone(),
		phase: options.phase,
		speed: options.speed,
		horizontalAmplitude: options.horizontalAmplitude,
		verticalAmplitude: options.verticalAmplitude,
		depthAmplitude: options.depthAmplitude ?? 0.04,
		rotationSpeed: options.rotationSpeed,
	}
}

function addSwimmer(scene: THREE.Scene, texture: THREE.Texture) {
	const material = new THREE.SpriteMaterial({
		map: texture,
		transparent: true,
		depthWrite: false,
		toneMapped: true,
	})
	const swimmer = new THREE.Sprite(material)
	swimmer.position.set(-1.7, 0.5, 3.3)
	swimmer.scale.set(0.84, 2.2, 1)
	swimmer.center.set(0.5, 0)
	scene.add(swimmer)

	const shadowMaterial = new THREE.MeshBasicMaterial({
		color: 0x10262b,
		transparent: true,
		opacity: 0.38,
	})
	const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.42, 32), shadowMaterial)
	shadow.position.set(-1.7, 0.49, 3.42)
	shadow.rotation.x = -Math.PI / 2
	shadow.scale.set(0.5, 1.25, 1)
	scene.add(shadow)
}

function createMottledTexture(
	baseColor: string,
	accentColors: string[],
	seed: number,
	size: number,
) {
	const canvas = document.createElement('canvas')
	canvas.width = size
	canvas.height = size
	const context = getCanvasContext(canvas)
	const random = createRandom(seed)
	context.fillStyle = baseColor
	context.fillRect(0, 0, size, size)
	for (let index = 0; index < 2300; index += 1) {
		context.globalAlpha = 0.025 + random() * 0.14
		context.fillStyle = accentColors[Math.floor(random() * accentColors.length)]
		const radius = 0.4 + random() * 3.6
		context.beginPath()
		context.arc(random() * size, random() * size, radius, 0, Math.PI * 2)
		context.fill()
	}
	context.globalAlpha = 0.08
	context.strokeStyle = accentColors[0]
	context.lineWidth = 0.65
	for (let index = 0; index < 18; index += 1) {
		const x = random() * size
		const y = random() * size
		context.beginPath()
		context.moveTo(x, y)
		context.bezierCurveTo(
			x + random() * 60 - 30,
			y + random() * 60 - 30,
			x + random() * 100 - 50,
			y + random() * 100 - 50,
			x + random() * 150 - 75,
			y + random() * 150 - 75,
		)
		context.stroke()
	}
	context.globalAlpha = 1
	const texture = new THREE.CanvasTexture(canvas)
	texture.colorSpace = THREE.SRGBColorSpace
	texture.wrapS = THREE.RepeatWrapping
	texture.wrapT = THREE.RepeatWrapping
	texture.repeat.set(2.4, 2.4)
	return texture
}

function createTileTexture() {
	const size = 512
	const canvas = document.createElement('canvas')
	canvas.width = size
	canvas.height = size
	const context = getCanvasContext(canvas)
	context.fillStyle = '#69aeb4'
	context.fillRect(0, 0, size, size)
	context.strokeStyle = 'rgba(22, 69, 79, 0.42)'
	context.lineWidth = 5
	const tileSize = 64
	for (let value = 0; value <= size; value += tileSize) {
		context.beginPath()
		context.moveTo(value, 0)
		context.lineTo(value, size)
		context.stroke()
		context.beginPath()
		context.moveTo(0, value)
		context.lineTo(size, value)
		context.stroke()
	}
	const random = createRandom(29)
	for (let index = 0; index < 1200; index += 1) {
		context.fillStyle = `rgba(229, 207, 164, ${0.02 + random() * 0.09})`
		context.fillRect(random() * size, random() * size, 1 + random() * 3, 1 + random() * 3)
	}
	const texture = new THREE.CanvasTexture(canvas)
	texture.colorSpace = THREE.SRGBColorSpace
	texture.wrapS = THREE.RepeatWrapping
	texture.wrapT = THREE.RepeatWrapping
	texture.repeat.set(2, 5)
	return texture
}

function createPlanetTexture(kind: 'orange' | 'striped' | 'pale' | 'rust') {
	const canvas = document.createElement('canvas')
	canvas.width = 1024
	canvas.height = 512
	const context = getCanvasContext(canvas)
	const palettes = {
		orange: ['#d43e1d', '#f46b27', '#ef994c', '#b92d21'],
		striped: ['#86a6a3', '#e88c4a', '#477f86', '#f2b06a'],
		pale: ['#c9bea2', '#85999a', '#dbc18e', '#738d91'],
		rust: ['#8b654a', '#c28c5f', '#6d4b3c', '#aa7755'],
	} as const
	const palette = palettes[kind]
	const gradient = context.createLinearGradient(0, 0, 1024, 512)
	gradient.addColorStop(0, palette[0])
	gradient.addColorStop(0.48, palette[1])
	gradient.addColorStop(1, palette[2])
	context.fillStyle = gradient
	context.fillRect(0, 0, 1024, 512)
	const random = createRandom(kind.length * 41)
	const bandCount = kind === 'striped' ? 13 : 22
	for (let index = 0; index < bandCount; index += 1) {
		const y = (index / bandCount) * 512 + random() * 22 - 11
		context.globalAlpha = kind === 'striped' ? 0.82 : 0.16 + random() * 0.17
		context.strokeStyle = palette[(index + 1) % palette.length]
		context.lineWidth = (kind === 'striped' ? 20 : 6) + random() * (kind === 'striped' ? 20 : 18)
		context.beginPath()
		context.moveTo(-30, y)
		for (let x = 0; x <= 1050; x += 70) {
			context.lineTo(x, y + Math.sin(x * 0.016 + index) * (7 + random() * 7))
		}
		context.stroke()
	}
	for (let index = 0; index < 2600; index += 1) {
		context.globalAlpha = 0.025 + random() * 0.12
		context.fillStyle = random() > 0.5 ? '#fff0cb' : palette[3]
		const radius = 0.35 + random() * 2.5
		context.beginPath()
		context.arc(random() * 1024, random() * 512, radius, 0, Math.PI * 2)
		context.fill()
	}
	context.globalAlpha = 1
	const texture = new THREE.CanvasTexture(canvas)
	texture.colorSpace = THREE.SRGBColorSpace
	texture.wrapS = THREE.RepeatWrapping
	texture.wrapT = THREE.ClampToEdgeWrapping
	return texture
}

function createSwimmerSpriteTexture() {
	const canvas = document.createElement('canvas')
	canvas.width = 256
	canvas.height = 640
	const context = getCanvasContext(canvas)
	context.clearRect(0, 0, 256, 640)
	context.lineCap = 'round'
	context.lineJoin = 'round'

	context.fillStyle = '#a9a18f'
	context.beginPath()
	context.ellipse(128, 83, 34, 45, 0, 0, Math.PI * 2)
	context.fill()
	context.fillStyle = '#b7a98f'
	context.fillRect(114, 116, 28, 38)

	context.fillStyle = '#61635e'
	context.beginPath()
	context.arc(128, 72, 35, Math.PI, Math.PI * 2)
	context.lineTo(161, 89)
	context.quadraticCurveTo(149, 69, 128, 62)
	context.quadraticCurveTo(107, 69, 95, 89)
	context.closePath()
	context.fill()

	context.fillStyle = '#b94231'
	context.beginPath()
	context.moveTo(99, 145)
	context.quadraticCurveTo(128, 132, 157, 145)
	context.lineTo(169, 285)
	context.quadraticCurveTo(152, 313, 128, 309)
	context.quadraticCurveTo(104, 313, 87, 285)
	context.closePath()
	context.fill()
	context.strokeStyle = '#7f2c27'
	context.lineWidth = 8
	context.beginPath()
	context.moveTo(101, 145)
	context.quadraticCurveTo(128, 173, 155, 145)
	context.stroke()

	context.strokeStyle = '#b19d83'
	context.lineWidth = 22
	context.beginPath()
	context.moveTo(95, 157)
	context.quadraticCurveTo(74, 250, 74, 335)
	context.stroke()
	context.beginPath()
	context.moveTo(160, 157)
	context.quadraticCurveTo(181, 250, 184, 335)
	context.stroke()

	context.strokeStyle = '#ad997f'
	context.lineWidth = 23
	context.beginPath()
	context.moveTo(111, 302)
	context.quadraticCurveTo(104, 420, 103, 574)
	context.stroke()
	context.beginPath()
	context.moveTo(145, 302)
	context.quadraticCurveTo(151, 420, 153, 574)
	context.stroke()

	context.strokeStyle = '#806f61'
	context.lineWidth = 7
	context.beginPath()
	context.moveTo(88, 337)
	context.lineTo(68, 342)
	context.stroke()
	context.beginPath()
	context.moveTo(170, 337)
	context.lineTo(191, 342)
	context.stroke()
	context.beginPath()
	context.moveTo(88, 582)
	context.lineTo(113, 582)
	context.stroke()
	context.beginPath()
	context.moveTo(143, 582)
	context.lineTo(169, 582)
	context.stroke()

	const texture = new THREE.CanvasTexture(canvas)
	texture.colorSpace = THREE.SRGBColorSpace
	texture.minFilter = THREE.LinearMipmapLinearFilter
	texture.magFilter = THREE.LinearFilter
	return texture
}

function addBox(
	parent: THREE.Object3D,
	size: readonly [number, number, number],
	position: readonly [number, number, number],
	material: THREE.Material,
	rotation?: readonly [number, number, number],
	castShadow = true,
	receiveShadow = true,
) {
	const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material)
	mesh.position.set(...position)
	if (rotation) {
		mesh.rotation.set(...rotation)
	}
	mesh.castShadow = castShadow
	mesh.receiveShadow = receiveShadow
	parent.add(mesh)
	return mesh
}

function getCanvasContext(canvas: HTMLCanvasElement) {
	const context = canvas.getContext('2d')
	if (!context) {
		throw new Error('浏览器无法创建场景所需的 Canvas 2D 上下文。')
	}
	return context
}

function createRandom(seed: number) {
	let state = seed >>> 0
	return () => {
		state += 0x6d2b79f5
		let value = state
		value = Math.imul(value ^ (value >>> 15), value | 1)
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296
	}
}

function disposeScene(scene: THREE.Scene, textures: THREE.Texture[]) {
	const geometries = new Set<THREE.BufferGeometry>()
	const materials = new Set<THREE.Material>()
	scene.traverse((object) => {
		if (object instanceof THREE.Mesh || object instanceof THREE.InstancedMesh) {
			geometries.add(object.geometry)
			const objectMaterials = Array.isArray(object.material) ? object.material : [object.material]
			for (const material of objectMaterials) {
				materials.add(material)
			}
		}
		if (object instanceof THREE.Sprite) {
			materials.add(object.material)
		}
	})
	for (const geometry of geometries) {
		geometry.dispose()
	}
	for (const material of materials) {
		material.dispose()
	}
	for (const texture of textures) {
		texture.dispose()
	}
}
