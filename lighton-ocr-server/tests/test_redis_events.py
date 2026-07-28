import asyncio
import json
import unittest

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


class RedisResultPublisherTest(unittest.TestCase):
    def test_store_result_and_publish_success_matches_docling_fields(self):
        async def run():
            redis = FakeRedis()
            publisher = RedisResultPublisher(
                results_stream="docling:results",
                result_key_prefix="docling:result",
                result_ttl_seconds=604800,
                client=redis,
            )
            result = {
                "metadata": {"doc_id": "doc-1"},
                "toc": {"entries": []},
                "chunks": [{"text": "hello", "headings": [], "page_numbers": [1], "bbox": None}],
                "image_chunks": [],
                "images": {},
            }

            result_key = await publisher.store_result("job-1", result)
            await publisher.publish_success(
                job_id="job-1",
                file_id="file-1",
                doc_id="doc-1",
                vespa_doc_id="vespa-1",
                result_key=result_key,
            )

            assert result_key == "docling:result:job-1"
            assert redis.setex_calls[0][0] == "docling:result:job-1"
            assert redis.setex_calls[0][1] == 604800
            assert json.loads(redis.setex_calls[0][2]) == result
            assert redis.xadd_calls == [
                (
                    "docling:results",
                    {
                        "job_id": "job-1",
                        "file_id": "file-1",
                        "doc_id": "doc-1",
                        "vespa_doc_id": "vespa-1",
                        "status": "ok",
                        "result_key": "docling:result:job-1",
                    },
                    "*",
                )
            ]

        asyncio.run(run())

    def test_publish_failure_compacts_error(self):
        async def run():
            redis = FakeRedis()
            publisher = RedisResultPublisher(client=redis)

            await publisher.publish_failure(
                job_id="job-1",
                file_id="file-1",
                doc_id="doc-1",
                error="line one\nline two",
            )

            _, fields, _ = redis.xadd_calls[0]
            assert fields["status"] == "failed"
            assert fields["error"] == "line one line two"

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
