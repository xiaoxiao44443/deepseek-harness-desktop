import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync, inflateSync } from 'node:zlib'

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const sourceIcon = join(projectRoot, 'app-icon.png')
const buildDirectory = join(projectRoot, 'build')
const iconsetDirectory = join(buildDirectory, 'app-icon.iconset')
const outputIcon = join(buildDirectory, 'app-icon.icns')
const macIconScale = 0.8
const macIconCornerRadius = 0.22

const iconLayers = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_48x48.png', 48],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024]
]

const pngIcnsChunks = [
  ['ic07', 'icon_128x128.png'],
  ['ic08', 'icon_256x256.png'],
  ['ic09', 'icon_512x512.png'],
  ['ic10', 'icon_512x512@2x.png'],
  ['ic11', 'icon_16x16@2x.png'],
  ['ic12', 'icon_32x32@2x.png'],
  ['ic13', 'icon_128x128@2x.png'],
  ['ic14', 'icon_256x256@2x.png']
]

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' })

    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`${command} exited with ${signal ?? `code ${code}`}`))
    })
  })
}

function stripPngMetadata(image) {
  const parts = [image.subarray(0, 8)]
  let offset = 8

  while (offset < image.length) {
    const dataLength = image.readUInt32BE(offset)
    const chunkLength = dataLength + 12
    const type = image.toString('ascii', offset + 4, offset + 8)

    if (['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(type)) {
      parts.push(image.subarray(offset, offset + chunkLength))
    }

    offset += chunkLength
  }

  return Buffer.concat(parts)
}

function paethPredictor(left, above, upperLeft) {
  const estimate = left + above - upperLeft
  const leftDistance = Math.abs(estimate - left)
  const aboveDistance = Math.abs(estimate - above)
  const upperLeftDistance = Math.abs(estimate - upperLeft)

  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) {
    return left
  }

  return aboveDistance <= upperLeftDistance ? above : upperLeft
}

function decodePng(image) {
  const width = image.readUInt32BE(16)
  const height = image.readUInt32BE(20)
  const bitDepth = image[24]
  const colorType = image[25]
  const interlaceMethod = image[28]

  if (bitDepth !== 8 || colorType !== 6 || interlaceMethod !== 0) {
    throw new Error('Expected an 8-bit, non-interlaced RGBA PNG.')
  }

  const idatChunks = []
  let offset = 8

  while (offset < image.length) {
    const dataLength = image.readUInt32BE(offset)
    const type = image.toString('ascii', offset + 4, offset + 8)

    if (type === 'IDAT') {
      idatChunks.push(image.subarray(offset + 8, offset + 8 + dataLength))
    }

    offset += dataLength + 12
  }

  const filtered = inflateSync(Buffer.concat(idatChunks))
  const bytesPerPixel = 4
  const stride = width * bytesPerPixel
  const pixels = Buffer.alloc(stride * height)
  let inputOffset = 0

  for (let row = 0; row < height; row += 1) {
    const filter = filtered[inputOffset]
    inputOffset += 1

    for (let column = 0; column < stride; column += 1) {
      const raw = filtered[inputOffset]
      inputOffset += 1
      const outputOffset = row * stride + column
      const left = column >= bytesPerPixel
        ? pixels[outputOffset - bytesPerPixel]
        : 0
      const above = row > 0 ? pixels[outputOffset - stride] : 0
      const upperLeft = row > 0 && column >= bytesPerPixel
        ? pixels[outputOffset - stride - bytesPerPixel]
        : 0

      let value
      switch (filter) {
        case 0:
          value = raw
          break
        case 1:
          value = raw + left
          break
        case 2:
          value = raw + above
          break
        case 3:
          value = raw + Math.floor((left + above) / 2)
          break
        case 4:
          value = raw + paethPredictor(left, above, upperLeft)
          break
        default:
          throw new Error(`Unsupported PNG filter: ${filter}`)
      }

      pixels[outputOffset] = value & 0xff
    }
  }

  return { width, height, pixels }
}

const crcTable = new Uint32Array(256)
for (let value = 0; value < crcTable.length; value += 1) {
  let crc = value
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 1
      ? 0xedb88320 ^ (crc >>> 1)
      : crc >>> 1
  }
  crcTable[value] = crc >>> 0
}

function crc32(data) {
  let crc = 0xffffffff

  for (const byte of data) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }

  return (crc ^ 0xffffffff) >>> 0
}

function createPngChunk(type, data = Buffer.alloc(0)) {
  const typeData = Buffer.from(type, 'ascii')
  const chunk = Buffer.alloc(data.length + 12)
  chunk.writeUInt32BE(data.length, 0)
  typeData.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([typeData, data])), data.length + 8)
  return chunk
}

function encodePng(width, height, pixels) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6

  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)

  for (let row = 0; row < height; row += 1) {
    const outputOffset = row * (stride + 1)
    raw[outputOffset] = 0
    pixels.copy(raw, outputOffset + 1, row * stride, (row + 1) * stride)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    createPngChunk('IHDR', header),
    createPngChunk('IDAT', deflateSync(raw, { level: 9 })),
    createPngChunk('IEND')
  ])
}

function createMacIconLayer(image, canvasSize) {
  const { width, height, pixels } = decodePng(image)

  if (width !== height || width > canvasSize) {
    throw new Error('Expected a square PNG that fits inside the icon canvas.')
  }

  const canvas = Buffer.alloc(canvasSize * canvasSize * 4)
  const left = Math.floor((canvasSize - width) / 2)
  const top = Math.floor((canvasSize - height) / 2)
  const radius = width * macIconCornerRadius

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const horizontalDistance = Math.max(
        radius - (x + 0.5),
        0,
        x + 0.5 - (width - radius)
      )
      const verticalDistance = Math.max(
        radius - (y + 0.5),
        0,
        y + 0.5 - (height - radius)
      )
      const edgeDistance = Math.hypot(horizontalDistance, verticalDistance)
      const coverage = Math.max(0, Math.min(1, radius - edgeDistance + 0.5))
      const sourceOffset = (y * width + x) * 4
      const targetOffset = ((top + y) * canvasSize + left + x) * 4

      canvas[targetOffset] = pixels[sourceOffset]
      canvas[targetOffset + 1] = pixels[sourceOffset + 1]
      canvas[targetOffset + 2] = pixels[sourceOffset + 2]
      canvas[targetOffset + 3] = Math.round(
        pixels[sourceOffset + 3] * coverage
      )
    }
  }

  return encodePng(canvasSize, canvasSize, canvas)
}

function encodeIcnsColorChannel(pixels, channel) {
  const values = Buffer.alloc(pixels.length / 4)

  for (let pixel = 0; pixel < values.length; pixel += 1) {
    values[pixel] = pixels[pixel * 4 + channel]
  }

  const parts = []
  for (let offset = 0; offset < values.length; offset += 128) {
    const data = values.subarray(offset, Math.min(offset + 128, values.length))
    parts.push(Buffer.from([data.length - 1]), data)
  }

  return Buffer.concat(parts)
}

function encodeLegacyIcnsIcon(image) {
  const { pixels } = decodePng(image)
  const color = Buffer.concat([
    encodeIcnsColorChannel(pixels, 0),
    encodeIcnsColorChannel(pixels, 1),
    encodeIcnsColorChannel(pixels, 2)
  ])
  const alpha = Buffer.alloc(pixels.length / 4)

  for (let pixel = 0; pixel < alpha.length; pixel += 1) {
    alpha[pixel] = pixels[pixel * 4 + 3]
  }

  return { color, alpha }
}

function createIcnsChunk(type, data) {
  const header = Buffer.alloc(8)
  header.write(type, 0, 4, 'ascii')
  header.writeUInt32BE(data.length + header.length, 4)
  return Buffer.concat([header, data])
}

if (process.platform !== 'darwin') {
  throw new Error('The macOS app icon can only be generated on macOS.')
}

await rm(iconsetDirectory, { recursive: true, force: true })
await mkdir(iconsetDirectory, { recursive: true })

for (const [fileName, size] of iconLayers) {
  const layerPath = join(iconsetDirectory, fileName)
  const innerSize = Math.max(1, Math.round(size * macIconScale))
  await run('/usr/bin/sips', [
    '-z',
    String(innerSize),
    String(innerSize),
    sourceIcon,
    '--out',
    layerPath
  ])
  const resized = await readFile(layerPath)
  await writeFile(layerPath, createMacIconLayer(resized, size))
}

const chunks = []

for (const [size, colorType, alphaType] of [
  [16, 'is32', 's8mk'],
  [32, 'il32', 'l8mk'],
  [48, 'ih32', 'h8mk']
]) {
  const image = await readFile(
    join(iconsetDirectory, `icon_${size}x${size}.png`)
  )
  const { color, alpha } = encodeLegacyIcnsIcon(image)
  chunks.push(createIcnsChunk(colorType, color))
  chunks.push(createIcnsChunk(alphaType, alpha))
}

for (const [type, fileName] of pngIcnsChunks) {
  const image = stripPngMetadata(
    await readFile(join(iconsetDirectory, fileName))
  )
  chunks.push(createIcnsChunk(type, image))
}

const body = Buffer.concat(chunks)
const header = Buffer.alloc(8)
header.write('icns', 0, 4, 'ascii')
header.writeUInt32BE(body.length + header.length, 4)

await writeFile(outputIcon, Buffer.concat([header, body]))

console.log(`Prepared macOS icon: ${outputIcon}`)
