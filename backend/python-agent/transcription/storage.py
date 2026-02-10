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

from config import set_call_id, get_logger

logger = get_logger(__name__)


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
        self._call_id = filename.replace('transcriptions/', '').replace('.jsonl', '')
        
        logger.info(f"gcs_streamer_initialized | queue_max_size=2000")
    
    def start(self):
        """Start the background writer thread."""
        self._worker_thread = threading.Thread(target=self._run_writer, daemon=True)
        self._worker_thread.start()
        logger.info(f"gcs_writer_thread_started | thread_id={self._worker_thread.ident}")
    
    def stop(self):
        """Stop the streamer and flush remaining data."""
        with self._stop_lock:
            if self._stopped:
                logger.debug(f"gcs_stop_already_called")
                return
            self._stopped = True
        
        queue_size = self._queue.qsize()
        logger.info(
            f"gcs_streamer_stopping | "
            f"queue_size={queue_size}, writes={self._write_count}, "
            f"drops={self._drop_count}, flushes={self._flush_count}"
        )
        self._stop_event.set()
        
        if self._worker_thread:
            logger.debug(f"gcs_draining_queue")
            join_start = time.time()
            self._worker_thread.join(timeout=30.0)
            join_elapsed = time.time() - join_start
            
            if self._worker_thread.is_alive():
                logger.error(
                    f"gcs_drain_timeout | "
                    f"elapsed={join_elapsed:.1f}s, queue_remaining={self._queue.qsize()}"
                )
            else:
                logger.info(
                    f"gcs_streamer_stopped | "
                    f"elapsed={join_elapsed:.2f}s, writes={self._write_count}, "
                    f"drops={self._drop_count}, flushes={self._flush_count}"
                )
    
    def write(self, data: dict):
        """Queue data for writing to GCS (non-blocking)."""
        try:
            self._queue.put_nowait(data)
            self._write_count += 1
            if self._write_count % 50 == 0:
                logger.debug(f"gcs_queue_progress | queued={self._write_count}, queue_size={self._queue.qsize()}")
        except queue.Full:
            self._drop_count += 1
            logger.error(
                f"gcs_queue_full | "
                f"total_drops={self._drop_count}, queue_size={self._queue.qsize()}"
            )
    
    def _run_writer(self):
        """Background thread that writes to GCS."""
        set_call_id(self._call_id)
        logger.debug(f"gcs_writer_thread_running")
        
        blob_writer = None
        retry_count = 0
        max_retries = 5
        local_write_count = 0
        
        while retry_count < max_retries:
            try:
                if not blob_writer:
                    logger.info(f"gcs_connect_attempt | attempt={retry_count + 1}/{max_retries}")
                    blob = self.bucket.blob(self.filename)
                    blob_writer = blob.open("w", content_type="application/x-ndjson")
                    logger.info(f"gcs_stream_opened | gcs_path=gs://{self.bucket.name}/{self.filename}")
                    retry_count = 0  # Reset on success
                
                lines_since_flush = 0
                
                while True:
                    try:
                        data = self._queue.get(timeout=1.0)
                    except queue.Empty:
                        if self._stop_event.is_set():
                            logger.debug(f"gcs_queue_drained | total_written={local_write_count}")
                            break
                        continue
                    
                    json_line = json.dumps(data) + "\n"
                    blob_writer.write(json_line)
                    local_write_count += 1
                    lines_since_flush += 1
                    
                    if local_write_count % 100 == 0:
                        logger.info(
                            f"gcs_write_progress | written={local_write_count}, "
                            f"queue_size={self._queue.qsize()}, pending_flush={lines_since_flush}"
                        )
                    
                    # Flush every 5 lines for durability
                    if lines_since_flush >= 5:
                        try:
                            blob_writer.flush()
                            self._flush_count += 1
                        except Exception as e:
                            logger.warning(f"gcs_flush_error | error={e}")
                        lines_since_flush = 0
                    
                    self._queue.task_done()
                
                # Final flush
                if lines_since_flush > 0 and blob_writer:
                    logger.debug(f"gcs_final_flush | pending_lines={lines_since_flush}")
                    try:
                        blob_writer.flush()
                        self._flush_count += 1
                    except Exception as e:
                        logger.error(f"gcs_final_flush_error | error={e}")
                
                logger.debug(f"gcs_write_loop_exiting | total_written={local_write_count}")
                break
                
            except Exception as e:
                logger.error(f"gcs_stream_error | retry={retry_count}/{max_retries}, error={str(e)[:200]}")
                blob_writer = None
                retry_count += 1
                
                if retry_count < max_retries:
                    backoff = min(2 ** retry_count, 30)
                    logger.warning(f"gcs_upload_retrying | attempt={retry_count + 1}/{max_retries}, next_retry_delay={backoff}s")
                    time.sleep(backoff)
        
        if retry_count >= max_retries:
            logger.error(f"gcs_upload_all_retries_failed | written={local_write_count}, queue_remaining={self._queue.qsize()}")
        
        if blob_writer:
            try:
                logger.info(f"gcs_stream_closing | total_written={local_write_count}")
                blob_writer.close()
                logger.info(f"gcs_stream_closed | writes={local_write_count}, flushes={self._flush_count}")
            except Exception as e:
                logger.error(f"gcs_stream_close_error | error={e}")
        
        logger.debug(f"gcs_writer_thread_exiting | final_write_count={local_write_count}")


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
            logger.info(f"storage_buffering_enabled | mode=buffered, gcs_available=true")
        elif bucket:
            logger.info(f"storage_streaming_enabled | mode=streaming, gcs_available=true")
        else:
            logger.info(f"storage_local_mode | mode=local, gcs_available=false")
    
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
            logger.debug(f"transcription_buffered | entry_count={len(self.gcs_buffer)}")
            return
        
        # Local storage fallback (only when GCS is not configured)
        if self.bucket is None:
            try:
                json_line = json.dumps(event) + "\n"
                os.makedirs("transcriptions", exist_ok=True)
                async with aiofiles.open(self.local_path, "a") as f:
                    await f.write(json_line)
                logger.debug(f"local_fallback_write | file={self.local_path}")
            except Exception as e:
                logger.error(f"local_write_failed | file={self.local_path}, error={e}")
    
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
            logger.info(f"storage_stream_closing")
            await asyncio.to_thread(self.gcs_streamer.stop)
            logger.info(f"storage_stream_closed | file={self.gcs_filename}")
            return
        
        # Buffered mode: upload all buffered entries
        if self.gcs_buffer is not None:
            if len(self.gcs_buffer) == 0:
                logger.warning(f"buffer_flush_empty")
                return
            
            if self.bucket is None:
                logger.warning(f"buffer_flush_failed | reason=no_bucket")
                return
            
            try:
                logger.info(f"gcs_upload_started | file={self.gcs_filename}, entries={len(self.gcs_buffer)}")
                blob = self.bucket.blob(self.gcs_filename)
                transcript_content = "".join(self.gcs_buffer)
                
                # Run blocking upload in thread pool
                await asyncio.to_thread(
                    blob.upload_from_string,
                    transcript_content,
                    content_type="application/x-ndjson"
                )
                
                logger.info(f"gcs_upload_completed | file={self.gcs_filename}, bytes={len(transcript_content)}")
            except Exception as e:
                logger.error(f"gcs_upload_failed | file={self.gcs_filename}, error={e}")
