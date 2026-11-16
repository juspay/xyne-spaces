import type JSZip from "jszip"

export const MAX_ZIP_TOTAL_INFLATED_BYTES = 50 * 1024 * 1024
export const MAX_ZIP_ENTRY_INFLATED_BYTES = 10 * 1024 * 1024
export const MAX_ZIP_ENTRIES = 2000

type EntryWithSize = JSZip.JSZipObject & { _data?: { uncompressedSize?: number } }

export function assertZipWithinLimits(zip: JSZip, label: string): void {
    let total = 0
    let count = 0
    for (const entry of Object.values(zip.files) as EntryWithSize[]) {
        if (entry.dir) continue
        count += 1
        if (count > MAX_ZIP_ENTRIES) {
            throw new Error(`${label}: archive has more than ${MAX_ZIP_ENTRIES} entries`)
        }
        const size = entry._data?.uncompressedSize ?? 0
        if (size > MAX_ZIP_ENTRY_INFLATED_BYTES) {
            throw new Error(`${label}: entry ${entry.name} inflates to ${size} bytes (limit ${MAX_ZIP_ENTRY_INFLATED_BYTES})`)
        }
        total += size
        if (total > MAX_ZIP_TOTAL_INFLATED_BYTES) {
            throw new Error(`${label}: archive inflates past ${MAX_ZIP_TOTAL_INFLATED_BYTES} bytes`)
        }
    }
}
