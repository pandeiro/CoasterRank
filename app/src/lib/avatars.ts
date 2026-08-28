import defaultAvatarUrl from '../assets/profile_default.jpg'

const PASTEL_COLORS = [
  { name: 'Coral', r: 245, g: 180, b: 170 },
  { name: 'Teal', r: 170, g: 220, b: 225 },
  { name: 'Lavender', r: 200, g: 185, b: 225 },
  { name: 'Mint', r: 175, g: 220, b: 195 },
  { name: 'Peach', r: 245, g: 205, b: 175 },
  { name: 'Sky', r: 175, g: 210, b: 235 },
] as const

const SIZE = 512
const cache = new Map<string, string>()

function hashCode(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

let baseImage: HTMLImageElement | null = null
let imageLoadPromise: Promise<HTMLImageElement> | null = null

function loadBaseImage(): Promise<HTMLImageElement> {
  if (baseImage) return Promise.resolve(baseImage)
  if (imageLoadPromise) return imageLoadPromise

  imageLoadPromise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      baseImage = img
      resolve(img)
    }
    img.onerror = reject
    img.src = defaultAvatarUrl
  })
  return imageLoadPromise
}

function tintImage(source: HTMLImageElement, color: (typeof PASTEL_COLORS)[number]): string {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')!

  // Draw the source image cropped to square (center crop)
  const srcSize = Math.min(source.width, source.height)
  const sx = (source.width - srcSize) / 2
  const sy = (source.height - srcSize) / 2
  ctx.drawImage(source, sx, sy, srcSize, srcSize, 0, 0, SIZE, SIZE)

  // Apply color tint at reduced opacity for a softer pastel effect
  ctx.globalCompositeOperation = 'multiply'
  ctx.globalAlpha = 0.6
  ctx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`
  ctx.fillRect(0, 0, SIZE, SIZE)
  ctx.globalAlpha = 1.0
  ctx.globalCompositeOperation = 'source-over'

  return canvas.toDataURL('image/jpeg', 0.85)
}

export async function getDefaultAvatar(userId: string): Promise<string> {
  if (cache.has(userId)) return cache.get(userId)!

  const img = await loadBaseImage()
  const colorIndex = hashCode(userId) % PASTEL_COLORS.length
  const dataUrl = tintImage(img, PASTEL_COLORS[colorIndex])
  cache.set(userId, dataUrl)
  return dataUrl
}

export function getAvatarUrl(
  avatarUrl: string | null | undefined,
  userId: string,
): string | Promise<string> {
  if (avatarUrl) return avatarUrl
  return getDefaultAvatar(userId)
}
