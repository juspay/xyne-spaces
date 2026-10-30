// Downloads the fonts Ream draws office documents with into assets/ream-fonts,
// where reamConversionPool.ts serves them from disk, so conversion never needs
// the network at runtime. Run while building the image (see apps/backend/Dockerfile)
// or locally with `pnpm fonts:fetch`.
//
// The fonts are the open substitutes Ream asks for — Arimo (Arial), Tinos (Times
// New Roman), Cousine (Courier New), Carlito (Calibri), Caladea (Cambria) and Noto
// Sans Symbols — laid out the way Ream requests them, under its CDN base
// https://cdn.jsdelivr.net/npm/@expo-google-fonts/. Ream's own URLs carry no
// version, and jsDelivr serves several of them from the old 0.2.3 packages, so
// each file is pinned here to the version Ream actually receives and checked by
// SHA-256: any change fails the build instead of silently changing the output.
//
// Licences travel with the fonts: SIL OFL 1.1 (Arimo, Carlito, Caladea, Noto Sans
// Symbols) and Apache 2.0 (Tinos, Cousine). Each font carries its own copyright
// notice.
//
// Only Latin text and symbols are covered; other scripts draw as boxes. To add
// one, add its Noto face at the path Ream requests (SCRIPTS in reamkit's
// core/fonts/remote-fonts.js).

import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const FONT_CDN = "https://cdn.jsdelivr.net/npm/@expo-google-fonts/"
// Licence texts from SPDX's license-list-data (v3.27.0), pinned to a commit so they cannot change.
const SPDX_TEXT = "https://raw.githubusercontent.com/spdx/license-list-data/d46e94e2c78ceede1cfc63cfa0396472d2798d4c/text/"

/** [path under assets/ream-fonts, source URL, SHA-256] */
const FILES = [
  ["arimo/Arimo_400Regular.ttf", `${FONT_CDN}arimo@0.2.3/Arimo_400Regular.ttf`, "02219a6ff8456d985e2f17f60bd5555bcfb29b47c13e8bccc8362447287b74c6"],
  ["arimo/Arimo_400Regular_Italic.ttf", `${FONT_CDN}arimo@0.2.3/Arimo_400Regular_Italic.ttf`, "daf5c64af223c0be94cadb394225c27b5dd74aca31620af5e6cdf1b6b5ba9e27"],
  ["arimo/Arimo_700Bold.ttf", `${FONT_CDN}arimo@0.2.3/Arimo_700Bold.ttf`, "d6a22848ffa3c9d57aff3b3419509f0728ceafa830b71d065f0e388b678aaf1f"],
  ["arimo/Arimo_700Bold_Italic.ttf", `${FONT_CDN}arimo@0.2.3/Arimo_700Bold_Italic.ttf`, "d2035458124d168366044ff3f7f59e26d00bf25187f9ddf8c2624e44eeb49906"],
  ["caladea/Caladea_400Regular.ttf", `${FONT_CDN}caladea@0.2.3/Caladea_400Regular.ttf`, "951ac8213baf87771336e6fd5e7003c28f21a30cfa6b1ec842b02e1f380e47db"],
  ["caladea/Caladea_400Regular_Italic.ttf", `${FONT_CDN}caladea@0.2.3/Caladea_400Regular_Italic.ttf`, "2bec3661078d53f0e2570946b42f828cbacca2baf5e7b379527a3766d9043529"],
  ["caladea/Caladea_700Bold.ttf", `${FONT_CDN}caladea@0.2.3/Caladea_700Bold.ttf`, "df3d745453c019e0821bfba446fb28b77e894ce80e812012b0aaa03dbabc8f91"],
  ["caladea/Caladea_700Bold_Italic.ttf", `${FONT_CDN}caladea@0.2.3/Caladea_700Bold_Italic.ttf`, "877659e6267502e8e3e8af9ca36dfd9492e2c21c96edbec0995a6ebc45e1dda3"],
  ["carlito/400Regular/Carlito_400Regular.ttf", `${FONT_CDN}carlito@0.4.1/400Regular/Carlito_400Regular.ttf`, "ca019755404c45627a8566915df99068949dc32ee2bce48d6aeee7542d2a0a89"],
  ["carlito/400Regular_Italic/Carlito_400Regular_Italic.ttf", `${FONT_CDN}carlito@0.4.1/400Regular_Italic/Carlito_400Regular_Italic.ttf`, "074cd1b89d53765d90d0ed3b4bfe49523efaaf4f3f430c006bc3233778b0ebb5"],
  ["carlito/700Bold/Carlito_700Bold.ttf", `${FONT_CDN}carlito@0.4.1/700Bold/Carlito_700Bold.ttf`, "51edbfa32d8af939913ae1f4ad0a5173e32083499218c133384638090295f0b0"],
  ["carlito/700Bold_Italic/Carlito_700Bold_Italic.ttf", `${FONT_CDN}carlito@0.4.1/700Bold_Italic/Carlito_700Bold_Italic.ttf`, "25f5672c1985d168d6bc2973864fc5a7e374bb95fe8d0f91cff47ae17fa67691"],
  ["cousine/Cousine_400Regular.ttf", `${FONT_CDN}cousine@0.2.3/Cousine_400Regular.ttf`, "dcd526004fcfec4ec23a21ca458ea6111e1e0d4471c0ade2704927101b5dcedb"],
  ["cousine/Cousine_400Regular_Italic.ttf", `${FONT_CDN}cousine@0.2.3/Cousine_400Regular_Italic.ttf`, "dc39e44bb6ee50ea8445210ce7871f3af836632024e84eed125785d1b3f24b05"],
  ["cousine/Cousine_700Bold.ttf", `${FONT_CDN}cousine@0.2.3/Cousine_700Bold.ttf`, "30ce88d0c9d9834cde36018fa6332f87a11adf17eb48239cafebad9e21637344"],
  ["cousine/Cousine_700Bold_Italic.ttf", `${FONT_CDN}cousine@0.2.3/Cousine_700Bold_Italic.ttf`, "bc3f577ce4f0036c9f8045bfcb2f36ce8795de91915ccf127371d9e722d5e518"],
  ["noto-sans-symbols/400Regular/NotoSansSymbols_400Regular.ttf", `${FONT_CDN}noto-sans-symbols@0.4.1/400Regular/NotoSansSymbols_400Regular.ttf`, "aedeec1cd0514930aeeafc4a88a6deff83cda1e6b58086f0b9bb9c7dd0157578"],
  ["noto-sans-symbols-2/400Regular/NotoSansSymbols2_400Regular.ttf", `${FONT_CDN}noto-sans-symbols-2@0.4.1/400Regular/NotoSansSymbols2_400Regular.ttf`, "f67f40c65f929f029827ab37cfdc4897dfd9ae3c28d9e98ba46e0d52e39eb97e"],
  ["tinos/Tinos_400Regular.ttf", `${FONT_CDN}tinos@0.2.3/Tinos_400Regular.ttf`, "054f3f97a338070c3558a9ce7e302565be85c7436b10bb0a01cf6a41f0782e61"],
  ["tinos/Tinos_400Regular_Italic.ttf", `${FONT_CDN}tinos@0.2.3/Tinos_400Regular_Italic.ttf`, "80f98dbb589cd1ede7585cb1863335e9dd149e000a152dbf86f8a2325fb52b76"],
  ["tinos/Tinos_700Bold.ttf", `${FONT_CDN}tinos@0.2.3/Tinos_700Bold.ttf`, "971a3f3e6a5cb3c0973074cd9384bbea2db3d647ee54240a8a749bb43e3569e7"],
  ["tinos/Tinos_700Bold_Italic.ttf", `${FONT_CDN}tinos@0.2.3/Tinos_700Bold_Italic.ttf`, "f2f805a8dd53f97ddd680c79a43c48cea8be26e3fdec5be354c23e61942b6c9c"],
  ["OFL.txt", `${SPDX_TEXT}OFL-1.1.txt`, "8eea8287e5876b539670cadb82e99f9a7afddec6f6730811be1daf25d2e9bcfd"],
  ["LICENSE-Apache-2.0.txt", `${SPDX_TEXT}Apache-2.0.txt`, "074e6e32c86a4c0ef8b3ed25b721ca23aca83df277cd88106ef7177c354615ff"],
]

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex")

const outDir = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "../assets/ream-fonts"))

let fetched = 0
for (const [rel, url, expected] of FILES) {
  const file = path.join(outDir, rel)
  const existing = await readFile(file).catch(() => null)
  if (existing && sha256(existing) === expected) continue

  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  const actual = sha256(bytes)
  if (actual !== expected) throw new Error(`${url}: SHA-256 ${actual}, expected ${expected}`)

  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, bytes)
  fetched++
}
console.log(`ream-fonts: ${FILES.length} files in ${outDir} (${fetched} downloaded)`)
