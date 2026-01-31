"""
Transcription storage manager - handles local and GCS writes
"""
import asyncio
import os
import json
import logging
import queue
import threading
import time
from typing import Optional, Any

import aiofiles

logger = logging.getLogger(__name__)


class GCSStreamer:
    """
    Background thread-based GCS streaming writer.
    
    Writes transcription events to GCS in real-time via a background thread.
    Handles connection retries and ensures data is flushed on stop.
    """
    
    def __init__(self, bucket: Any, filename: str):
        self.bucket = bucket
        self.filename = filename
        
        # Bounded queue to prevent OOM if GCS is slow
        self._queue: queue.Queue = queue.Queue(maxsize=2000)
        self._stop_event = threading.Event()
        self._worker_thread: Optional[threading.Thread] = None
        
        # Idempotency for stop()
        self._stopped = False
        self._stop_lock = threading.Lock()
        
        # Metrics
        self._write_count = 0
        self._drop_count = 0
        self._flush_count = 0
        
        logger.info(f"[GCS:STREAMER] Initialized | file={filename} | queue_max_size=2000")
    
    def start(self):
        """Start the background writer thread."""
        logger.info(f"[GCS:START] Starting background writer thread for {self.filename}")
        self._worker_thread = threading.Thread(target=self._run_writer, daemon=True)
        self._worker_thread.start()
        logger.info(f"[GCS:START] Thread started | thread_id={self._worker_thread.ident}")
    
    def stop(self):
        """Stop the streamer and flush remaining data."""
        with self._stop_lock:
            if self._stopped:
                logger.info(f"[GCS:STOP] Already stopped, skipping | file={self.filename}")
                return
            self._stopped = True
        
        queue_size = self._queue.qsize()
        logger.info(
            f"[GCS:STOP] Stopping streamer | "
            f"queue_size={queue_size} | writes={self._write_count} | "
            f"drops={self._drop_count} | flushes={self._flush_count}"
        )
        self._stop_event.set()
        
        if self._worker_thread:
            logger.info("[GCS:STOP] Waiting for writer thread to drain queue (timeout=30s)...")
            join_start = time.time()
            self._worker_thread.join(timeout=30.0)
            join_elapsed = time.time() - join_start
            
            if self._worker_thread.is_alive():
                logger.error(
                    f"[GCS:STOP] Thread still alive after {join_elapsed:.1f}s | "
                    f"queue_remaining={self._queue.qsize()}"
                )
            else:
                logger.info(
                    f"[GCS:STOP] Thread exited cleanly | "
                    f"elapsed={join_elapsed:.2f}s | final_stats: writes={self._write_count}, "
                    f"drops={self._drop_count}, flushes={self._flush_count}"
                )
    
    def write(self, data: dict):
        """Queue data for writing to GCS (non-blocking)."""
        try:
            self._queue.put_nowait(data)
            self._write_count += 1
            if self._write_count % 50 == 0:
                logger.debug(f"[GCS:QUEUE] Queued item #{self._write_count} | queue_size={self._queue.qsize()}")
        except queue.Full:
            self._drop_count += 1
            logger.error(
                f"[GCS:QUEUE] Queue full! Dropping transcription | "
                f"total_drops={self._drop_count} | queue_size={self._queue.qsize()}"
            )
    
    def _run_writer(self):
        """Background thread that writes to GCS."""
        logger.info(f"[GCS:WRITER] Thread started | thread_id={threading.current_thread().ident}")
        
        blob_writer = None
        retry_count = 0
        max_retries = 5
        local_write_count = 0
        
        while retry_count < max_retries:
            try:
                if not blob_writer:
                    logger.info(f"[GCS:CONNECT] Attempting connection | attempt={retry_count + 1}/{max_retries}")
                    blob = self.bucket.blob(self.filename)
                    blob_writer = blob.open("w", content_type="application/x-ndjson")
                    logger.info(f"[GCS:CONNECT] Stream opened | gs://{self.bucket.name}/{self.filename}")
                    retry_count = 0  # Reset on success
                
                lines_since_flush = 0
                
                while True:
                    try:
                        data = self._queue.get(timeout=1.0)
                    except queue.Empty:
                        if self._stop_event.is_set():
                            logger.info(f"[GCS:WRITER] Queue empty and stop event set | total_written={local_write_count}")
                            break
                        continue
                    
                    json_line = json.dumps(data) + "\n"
                    blob_writer.write(json_line)
                    local_write_count += 1
                    lines_since_flush += 1
                    
                    if local_write_count % 100 == 0:
                        logger.info(
                            f"[GCS:WRITE] Progress | written={local_write_count} | "
                            f"queue_size={self._queue.qsize()} | pending_flush={lines_since_flush}"
                        )
                    
                    # Flush every 5 lines for durability
                    if lines_since_flush >= 5:
                        try:
                            blob_writer.flush()
                            self._flush_count += 1
                        except Exception as e:
                            logger.warning(f"[GCS:FLUSH] Flush error: {e}")
                        lines_since_flush = 0
                    
                    self._queue.task_done()
                
                # Final flush
                if lines_since_flush > 0 and blob_writer:
                    logger.info(f"[GCS:FLUSH] Final flush | pending_lines={lines_since_flush}")
                    try:
                        blob_writer.flush()
                        self._flush_count += 1
                    except Exception as e:
                        logger.error(f"[GCS:FLUSH] Final flush error: {e}")
                
                logger.info(f"[GCS:WRITER] Exiting processing loop | total_written={local_write_count}")
                break
                
            except Exception as e:
                logger.error(f"[GCS:ERROR] Stream error | retry={retry_count}/{max_retries} | error={str(e)[:200]}")
                blob_writer = None
                retry_count += 1
                
                if retry_count < max_retries:
                    backoff = min(2 ** retry_count, 30)
                    logger.warning(f"[GCS:RETRY] Retrying in {backoff}s | attempt={retry_count + 1}/{max_retries}")
                    time.sleep(backoff)
        
        if retry_count >= max_retries:
            logger.error(f"[GCS:ERROR] Max retries exceeded | written={local_write_count} | queue_remaining={self._queue.qsize()}")
        
        if blob_writer:
            try:
                logger.info(f"[GCS:CLOSE] Closing stream | total_written={local_write_count}")
                blob_writer.close()
                logger.info(f"[GCS:CLOSE] Stream closed | final_stats: writes={local_write_count}, flushes={self._flush_count}")
            except Exception as e:
                logger.error(f"[GCS:CLOSE] Error closing stream: {e}")
        
        logger.info(f"[GCS:WRITER] Thread exiting | final_write_count={local_write_count}")


class TranscriptionStorage:
    """
    Manages transcription storage to local filesystem and GCS.
    
    Supports two modes:
    - Buffered: Collect all events in memory, flush to GCS at end (development)
    - Streaming: Write directly to GCS as events arrive (production)
    """
    
    def __init__(
        self,
        call_id: str,
        safe_call_id: str,
        bucket: Optional[Any] = None,
        use_buffer: bool = False,
    ):
        """
        Initialize transcription storage.
        
        Args:
            call_id: Original call/room ID
            safe_call_id: Sanitized call ID for filesystem
            bucket: GCS bucket (None = local only)
            use_buffer: True = buffer for GCS, False = stream to GCS
        """
        self.call_id = call_id
        self.safe_call_id = safe_call_id
        self.bucket = bucket
        self.use_buffer = use_buffer
        
        # Local storage path (fallback only)
        self.local_path = f"transcriptions/{safe_call_id}.jsonl"
        
        # GCS settings
        self.gcs_filename = f"transcriptions/{safe_call_id}.jsonl" if bucket else None
        self.gcs_buffer = [] if use_buffer else None
        
        # GCS streamer for production mode (real-time streaming)
        self.gcs_streamer: Optional[GCSStreamer] = None
        if bucket and not use_buffer:
            self.gcs_streamer = GCSStreamer(bucket, self.gcs_filename)
            self.gcs_streamer.start()
        
        if use_buffer:
            logger.info("Using buffered GCS upload (development mode)")
        elif bucket:
            logger.info("Using streaming GCS upload (production mode)")
        else:
            logger.info("Using local storage only (no GCS)")
    
    async def write(self, event: dict):
        """
        Store transcription event to GCS (streaming or buffered) or local filesystem.
        
        Args:
            event: Transcription event data
        """
        # Streaming mode: write directly to GCS via background thread
        if self.gcs_streamer is not None:
            self.gcs_streamer.write(event)
            return
        
        # Buffered mode: collect in memory for later flush
        if self.gcs_buffer is not None:
            json_line = json.dumps(event) + "\n"
            self.gcs_buffer.append(json_line)
            logger.debug(f"Buffered for GCS (total: {len(self.gcs_buffer)} entries)")
            return
        
        # Local storage fallback (only when GCS is not configured)
        if self.bucket is None:
            try:
                json_line = json.dumps(event) + "\n"
                os.makedirs("transcriptions", exist_ok=True)
                async with aiofiles.open(self.local_path, "a") as f:
                    await f.write(json_line)
                logger.debug("Stored transcription locally (no GCS)")
            except Exception as e:
                logger.error(f"Error storing transcription locally: {e}")
    
    async def flush(self):
        """
        Flush/finalize transcription storage.
        
        - Streaming mode: stops the GCS streamer and drains the queue
        - Buffered mode: uploads all buffered entries to GCS
        - Local mode: no-op (already written to disk)
        
        Called during cleanup when all participants leave.
        """
        # Streaming mode: stop the streamer (will drain queue and close stream)
        if self.gcs_streamer is not None:
            logger.info("Stopping GCS streamer...")
            await asyncio.to_thread(self.gcs_streamer.stop)
            logger.info("GCS streamer stopped")
            return
        
        # Buffered mode: upload all buffered entries
        if self.gcs_buffer is not None:
            if len(self.gcs_buffer) == 0:
                logger.warning("No transcript entries to upload to GCS")
                return
            
            if self.bucket is None:
                logger.warning("Cannot flush to GCS - bucket not configured")
                return
            
            try:
                logger.info(f"Uploading {len(self.gcs_buffer)} transcript entries to GCS (buffered mode)...")
                blob = self.bucket.blob(self.gcs_filename)
                transcript_content = "".join(self.gcs_buffer)
                
                # Run blocking upload in thread pool
                await asyncio.to_thread(
                    blob.upload_from_string,
                    transcript_content,
                    content_type="application/x-ndjson"
                )
                
                logger.info(f"Successfully uploaded transcript to GCS: {self.gcs_filename}")
            except Exception as e:
                logger.error(f"Error uploading to GCS: {e}")
