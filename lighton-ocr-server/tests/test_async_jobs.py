import asyncio
import io
import json
import unittest
from types import SimpleNamespace

from fastapi import UploadFile

from async_jobs import AsyncOcrJobRunner
from job_tracker import JobTracker
from redis_events import RedisResultPublisher


class FakeRedis:
    def __init__(self):
        self.setex_calls = []
        self.xadd_calls = []

    async def setex(self, key, ttl, payload):
        self.setex_calls.append((key, ttl, payload))
        return True

    async def xadd(self, name, fields, **kwargs):
        self.xadd_calls.append((name, fields, kwargs.get("id", "*")))
        return "1-0"


class FakeAdmission:
    def __init__(self, *, accepted=True, duplicate=False, retry_after_seconds=180):
        self.accepted = accepted
        self.duplicate = duplicate
        self.retry_after_seconds = retry_after_seconds
        self.acquire_calls = []
        self.release_calls = []

    async def acquire(self, **kwargs):
        self.acquire_calls.append(kwargs)
        return SimpleNamespace(
            accepted=self.accepted,
            duplicate=self.duplicate,
            retry_after_seconds=self.retry_after_seconds,
        )

    async def release(self, job_id):
        self.release_calls.append(job_id)


def make_upload(filename="document.pdf", body=b"%PDF-1.4\n"):
    return UploadFile(file=io.BytesIO(body), filename=filename)


async def wait_for_state(runner, job_id, expected_state):
    for _ in range(100):
        job = await runner.get_job(job_id)
        if job and job.get("state") == expected_state:
            return job
        await asyncio.sleep(0.01)
    raise AssertionError(f"job {job_id} did not reach {expected_state}")


class AsyncOcrJobRunnerTest(unittest.TestCase):
    def test_success_stores_result_and_publishes_event(self):
        async def run():
            async def process_document(_tmp_path, *, filename, doc_id, set_stage):
                set_stage("done_processing")
                return {
                    "metadata": {"doc_id": doc_id, "filename": filename},
                    "toc": {"entries": []},
                    "chunks": [],
                    "image_chunks": [],
                    "images": {},
                }

            redis = FakeRedis()
            runner = AsyncOcrJobRunner(
                publisher=RedisResultPublisher(
                    results_stream="ocr:results",
                    result_key_prefix="ocr:result",
                    client=redis,
                ),
                tracker=JobTracker(),
                processor_func=process_document,
                global_admission=None,
            )

            result = await runner.submit_upload(
                upload_file=make_upload(),
                job_id="job-1",
                file_id="file-1",
                doc_id="doc-1",
                vespa_doc_id=None,
                app_state=SimpleNamespace(),
            )

            assert result.accepted
            await wait_for_state(runner, "job-1", "done")
            assert redis.setex_calls[0][0] == "ocr:result:job-1"
            assert json.loads(redis.setex_calls[0][2])["metadata"]["doc_id"] == "doc-1"
            assert redis.xadd_calls[0][1]["status"] == "ok"
            assert redis.xadd_calls[0][1]["result_key"] == "ocr:result:job-1"

        asyncio.run(run())

    def test_local_duplicate_is_accepted_without_reprocessing(self):
        async def run():
            started = asyncio.Event()
            release = asyncio.Event()
            process_calls = []

            async def process_document(tmp_path, *, filename, doc_id, set_stage):
                process_calls.append((tmp_path, filename, doc_id))
                set_stage("waiting")
                started.set()
                await release.wait()
                return {
                    "metadata": {},
                    "toc": {"entries": []},
                    "chunks": [],
                    "image_chunks": [],
                    "images": {},
                }

            runner = AsyncOcrJobRunner(
                publisher=RedisResultPublisher(client=FakeRedis()),
                tracker=JobTracker(),
                max_inflight=1,
                processor_func=process_document,
                global_admission=None,
            )

            first = await runner.submit_upload(
                upload_file=make_upload(),
                job_id="job-1",
                file_id="file-1",
                doc_id="doc-1",
                vespa_doc_id=None,
                app_state=SimpleNamespace(),
            )
            assert first.accepted
            await asyncio.wait_for(started.wait(), timeout=2)

            duplicate = await runner.submit_upload(
                upload_file=make_upload(),
                job_id="job-1",
                file_id="file-1",
                doc_id="doc-1",
                vespa_doc_id=None,
                app_state=SimpleNamespace(),
            )
            assert duplicate.accepted
            assert duplicate.duplicate
            assert len(process_calls) == 1

            release.set()
            await wait_for_state(runner, "job-1", "done")

        asyncio.run(run())

    def test_global_admission_rejects_and_positive_permit_releases(self):
        async def run():
            reject = AsyncOcrJobRunner(
                publisher=RedisResultPublisher(client=FakeRedis()),
                tracker=JobTracker(),
                processor_func=lambda *_args, **_kwargs: {},
                global_admission=FakeAdmission(accepted=False, retry_after_seconds=77),
            )
            rejected = await reject.submit_upload(
                upload_file=make_upload(),
                job_id="job-reject",
                file_id="file-1",
                doc_id="doc-1",
                vespa_doc_id=None,
                app_state=SimpleNamespace(),
            )
            assert not rejected.accepted
            assert rejected.busy
            assert rejected.retry_after_seconds == 77

            admission = FakeAdmission()

            async def process_document(*_args, **_kwargs):
                return {
                    "metadata": {},
                    "toc": {"entries": []},
                    "chunks": [],
                    "image_chunks": [],
                    "images": {},
                }

            runner = AsyncOcrJobRunner(
                publisher=RedisResultPublisher(client=FakeRedis()),
                tracker=JobTracker(),
                processor_func=process_document,
                global_admission=admission,
            )
            accepted = await runner.submit_upload(
                upload_file=make_upload(),
                job_id="job-ok",
                file_id="file-1",
                doc_id="doc-1",
                vespa_doc_id=None,
                app_state=SimpleNamespace(),
            )
            assert accepted.accepted
            await wait_for_state(runner, "job-ok", "done")
            assert admission.release_calls == ["job-ok"]

        asyncio.run(run())

    def test_global_duplicate_not_owned_locally_is_busy(self):
        async def run():
            admission = FakeAdmission(
                accepted=True,
                duplicate=True,
                retry_after_seconds=120,
            )
            tracker = JobTracker()
            runner = AsyncOcrJobRunner(
                publisher=RedisResultPublisher(client=FakeRedis()),
                tracker=tracker,
                processor_func=lambda *_args, **_kwargs: {},
                global_admission=admission,
            )

            result = await runner.submit_upload(
                upload_file=make_upload(),
                job_id="job-remote",
                file_id="file-1",
                doc_id="doc-1",
                vespa_doc_id=None,
                app_state=SimpleNamespace(),
            )

            assert not result.accepted
            assert result.busy
            assert result.retry_after_seconds == 120
            assert await runner.active_count() == 0
            assert tracker.find("doc-1") is None
            assert admission.release_calls == []

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
