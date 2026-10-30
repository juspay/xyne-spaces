import path from "node:path"
import { fileURLToPath } from "node:url"
import { Worker } from "node:worker_threads"
import { logger } from "@/utils/logger"
import { config } from "@/config/env"
import type { ThreadData, ThreadReady, ThreadResponse } from "./reamConversionThread"

/**
 * worker_threads pool that converts office documents to PDF with Ream
 * (reamkit, pure JavaScript, patched in patches/reamkit@1.33.1.patch).
 *
 * Ream replaces LibreOffice, which the distroless runtime no longer ships: it
 * runs in-process, starts no other program and needs no shell. A conversion is
 * synchronous CPU work that can take a second on a large deck, so it runs on a
 * dedicated thread (reamConversionThread.ts) to keep the API's event loop free,
 * and a thread that runs too long or too large is replaced. Fonts come from the
 * folder fetched at image build (scripts/fetch-ream-fonts.mjs), never from the
 * network.
 */

export type ReamConversionFailureCode = "TIMEOUT" | "CONVERSION_FAILED"

export class ReamConversionThreadError extends Error {
    constructor(
        message: string,
        public readonly code: ReamConversionFailureCode,
    ) {
        super(message)
        this.name = "ReamConversionThreadError"
    }
}

/** A deck that has not converted by now is treated as hostile and its thread is replaced. */
const CONVERSION_TIMEOUT_MS = 60_000

/** The largest real decks measured peaked near 240 MB; the cap stops a crafted file from taking the pod with it. */
const THREAD_HEAP_LIMIT_MB = 1024

const THREAD_COUNT = config.officeConversion.maxConcurrency

/** Ream's fonts (scripts/fetch-ream-fonts.mjs), resolved once so the threads get an absolute path. */
const FONT_DIR = path.resolve(config.officeConversion.fontDir)

// The thread's entry: the sibling .ts under tsx in dev, the compiled .js in
// dist/ in production (as migration/self-serve/index.ts resolves workerMain).
// A Worker inherits the parent's execArgv, so in dev it gets tsx's loader too.
const usingTs = import.meta.url.endsWith(".ts")
const THREAD_FILE = fileURLToPath(new URL(usingTs ? "./reamConversionThread.ts" : "./reamConversionThread.js", import.meta.url))

type PendingTask = {
    bytes: Buffer
    resolve: (pdf: Buffer) => void
    reject: (err: ReamConversionThreadError) => void
}

type Slot = {
    thread: Worker
    /** Set when the thread reports it has loaded; only ready threads get work. */
    ready: boolean
    current: PendingTask | null
    timer: NodeJS.Timeout | null
    /** Replace this thread, rejecting its running conversion with `err`. */
    kill: (err: ReamConversionThreadError) => void
}

/** A thread that cannot start is retried after 1 s, 2 s, 4 s, ... up to a minute, not in a loop. */
const RESPAWN_BASE_DELAY_MS = 1_000
const RESPAWN_MAX_DELAY_MS = 60_000

let started = false
let slots: Slot[] = []
let waiting: PendingTask[] = []
/** Threads that failed to start since one last did; sets the retry delay. */
let startFailures = 0
let lastStartError = ""
let slotsToRespawn = 0
let respawnTimer: NodeJS.Timeout | null = null

const unavailable = () =>
    new ReamConversionThreadError(`Ream conversion is unavailable: ${lastStartError}`, "CONVERSION_FAILED")

function rejectWaiting(err: ReamConversionThreadError): void {
    const queued = waiting
    waiting = []
    for (const task of queued) task.reject(err)
}

function scheduleRespawn(): void {
    slotsToRespawn++
    if (respawnTimer) return
    // The whole pool tends to fail together, so the delay grows per round of
    // THREAD_COUNT failures, not per thread.
    const rounds = Math.ceil(startFailures / THREAD_COUNT)
    const delay = Math.min(RESPAWN_MAX_DELAY_MS, RESPAWN_BASE_DELAY_MS * 2 ** (rounds - 1))
    respawnTimer = setTimeout(() => {
        respawnTimer = null
        const count = slotsToRespawn
        slotsToRespawn = 0
        if (!started) return
        for (let i = 0; i < count; i++) slots.push(spawnSlot())
    }, delay)
    respawnTimer.unref()
}

function spawnSlot(): Slot {
    const thread = new Worker(THREAD_FILE, {
        workerData: { fontDir: FONT_DIR } satisfies ThreadData,
        // Conversion needs no configuration, so the thread gets none of the
        // backend's environment (database URLs, keys).
        env: {},
        resourceLimits: { maxOldGenerationSizeMb: THREAD_HEAP_LIMIT_MB },
    })
    const slot: Slot = { thread, ready: false, current: null, timer: null, kill: () => {} }

    const finish = (): PendingTask | null => {
        if (slot.timer) clearTimeout(slot.timer)
        slot.timer = null
        const task = slot.current
        slot.current = null
        return task
    }

    thread.on("message", (msg: ThreadResponse | ThreadReady) => {
        if ("ready" in msg) {
            slot.ready = true
            startFailures = 0
            dispatch()
            return
        }
        const task = finish()
        if (task) {
            if (msg.ok) task.resolve(Buffer.from(msg.pdf))
            else task.reject(new ReamConversionThreadError(msg.message, "CONVERSION_FAILED"))
        }
        dispatch()
    })

    // Killed mid-conversion (timeout, crash on a hostile document): replace it
    // at once, so one bad document does not drain capacity.
    slot.kill = (err: ReamConversionThreadError) => {
        slots = slots.filter(s => s !== slot)
        void thread.terminate().catch(() => {})
        const task = finish()
        if (task) task.reject(err)
        if (started) slots.push(spawnSlot())
        dispatch()
    }

    // Never got going (thread file missing, reamkit failing to load): replacing
    // it at once would fail the same way in a tight loop, so retry with backoff,
    // and fail queued conversions now rather than leave them waiting.
    const failedToStart = (reason: string) => {
        slots = slots.filter(s => s !== slot)
        void thread.terminate().catch(() => {})
        startFailures++
        lastStartError = reason
        logger.error("[OfficeConversion] Ream conversion thread failed to start", { reason, startFailures })
        if (!slots.some(s => s.ready)) rejectWaiting(unavailable())
        if (started) scheduleRespawn()
    }

    thread.on("error", err => {
        if (!slot.ready) failedToStart(err.message)
        else slot.kill(new ReamConversionThreadError(`Ream conversion thread error: ${err.message}`, "CONVERSION_FAILED"))
    })
    thread.on("exit", code => {
        if (!slots.includes(slot)) return
        if (!slot.ready) failedToStart(`thread exited with code ${code} before it was ready`)
        else slot.kill(new ReamConversionThreadError(`Ream conversion thread exited (code ${code})`, "CONVERSION_FAILED"))
    })
    return slot
}

function dispatch(): void {
    for (const slot of slots) {
        if (!slot.ready || slot.current) continue
        const task = waiting.shift()
        if (!task) return
        slot.current = task
        slot.timer = setTimeout(
            () => slot.kill(new ReamConversionThreadError("Ream conversion timed out", "TIMEOUT")),
            CONVERSION_TIMEOUT_MS,
        )
        slot.thread.postMessage({ bytes: task.bytes })
    }
}

/**
 * Convert an office document's bytes to PDF on a worker thread. Rejects with
 * ReamConversionThreadError carrying TIMEOUT or CONVERSION_FAILED; fails at
 * once while no thread can start.
 */
export function convertWithReam(bytes: Buffer): Promise<Buffer> {
    if (!started) {
        started = true
        for (let i = 0; i < THREAD_COUNT; i++) slots.push(spawnSlot())
        logger.info("[OfficeConversion] Spawned Ream conversion thread pool", { threads: THREAD_COUNT })
    }
    if (startFailures > 0 && !slots.some(s => s.ready)) return Promise.reject(unavailable())
    return new Promise((resolve, reject) => {
        waiting.push({ bytes, resolve, reject })
        dispatch()
    })
}

/** Terminate all conversion threads; running and queued conversions reject. */
export async function shutdownReamConversionPool(): Promise<void> {
    started = false
    if (respawnTimer) clearTimeout(respawnTimer)
    respawnTimer = null
    slotsToRespawn = 0
    startFailures = 0
    const gone = slots
    slots = []
    for (const slot of gone) {
        if (slot.timer) clearTimeout(slot.timer)
        slot.current?.reject(new ReamConversionThreadError("Ream conversion pool shut down", "CONVERSION_FAILED"))
    }
    rejectWaiting(new ReamConversionThreadError("Ream conversion pool shut down", "CONVERSION_FAILED"))
    await Promise.all(gone.map(s => s.thread.terminate().catch(() => {})))
}
