"""SttEvalCollector batching against a fake NeuroLink eval endpoint.

Run from apps/backend/python-agent:  python -m unittest discover -s tests
"""
import asyncio
import unittest
from unittest import mock

import aiohttp
from aiohttp import web

from livekit.agents import stt

from modules import stt_eval
from modules.stt_eval import ShadowTranscriber, SttEvalCollector


class FakeEvalEndpoint:
    def __init__(self, statuses):
        self.statuses = list(statuses)  # response status per request; 200 once exhausted
        self.requests = []

    async def __aenter__(self):
        app = web.Application()
        app.router.add_post("/v1/evals/stt", self._handle)
        self.runner = web.AppRunner(app)
        await self.runner.setup()
        site = web.TCPSite(self.runner, "127.0.0.1", 0)
        await site.start()
        self.url = f"ws://127.0.0.1:{site._server.sockets[0].getsockname()[1]}"
        return self

    async def __aexit__(self, *exc):
        await self.runner.cleanup()

    async def _handle(self, request):
        self.requests.append({"auth": request.headers.get("Authorization"), **(await request.json())})
        status = self.statuses.pop(0) if self.statuses else 200
        return web.json_response({}, status=status)


def add(collector, source, text):
    collector.add(source=source, participant_identity="u1", participant_name="Priya", text=text)


class SttEvalCollectorTest(unittest.IsolatedAsyncioTestCase):
    async def test_failed_batch_is_resent_with_the_same_ids_and_final_goes_once(self):
        async with FakeEvalEndpoint([503]) as endpoint, aiohttp.ClientSession() as session:
            collector = SttEvalCollector(
                base_url=endpoint.url, token="tkn", call_id="call-1", room_name="room-1",
                primary_model="google", shadow_model="neurolink", http_session=session,
            )
            add(collector, "primary", "The release goes out on Monday")
            self.assertFalse(await collector.flush())  # 503: kept

            # Backing off: a periodic flush right after a failure sends nothing
            add(collector, "shadow", "The release goes out on Monday.")
            self.assertFalse(await collector.flush())
            self.assertEqual(len(endpoint.requests), 1)

            await collector.aclose()  # the final batch is always attempted
            add(collector, "primary", "too late")
            await collector.aclose()
            await collector.flush(final=True)

        failed, final = endpoint.requests
        self.assertEqual(len(endpoint.requests), 2)
        self.assertEqual(final["auth"], "Bearer tkn")
        self.assertTrue(final["final"])
        self.assertEqual(final["models"], {"primary": "google", "shadow": "neurolink"})
        self.assertEqual([s["source"] for s in final["segments"]], ["primary", "shadow"])
        self.assertEqual(final["segments"][0]["id"], failed["segments"][0]["id"])
        self.assertEqual(final["batch"], 2)

    async def test_empty_final_batch_is_still_sent(self):
        async with FakeEvalEndpoint([]) as endpoint, aiohttp.ClientSession() as session:
            collector = SttEvalCollector(
                base_url=endpoint.url, token=None, call_id="call-2", room_name="room-2",
                primary_model="neurolink", shadow_model="google", http_session=session,
            )
            await collector.aclose()
        self.assertEqual(len(endpoint.requests), 1)
        self.assertEqual(endpoint.requests[0]["segments"], [])
        self.assertIsNone(endpoint.requests[0]["auth"])

    async def test_pending_segments_are_capped(self):
        collector = SttEvalCollector(
            base_url="http://unused.test", token=None, call_id="c", room_name="r",
            primary_model="google", shadow_model="neurolink",
        )
        original = stt_eval.MAX_PENDING_SEGMENTS
        stt_eval.MAX_PENDING_SEGMENTS = 3
        try:
            for i in range(5):
                add(collector, "primary", f"line {i}")
        finally:
            stt_eval.MAX_PENDING_SEGMENTS = original
        self.assertEqual([s.text for s in collector._pending], ["line 2", "line 3", "line 4"])


class _ScriptedStream:
    """Yields an interim, then the final `final_after` seconds later; records aclose()."""

    def __init__(self, final_after):
        self.final_after = final_after
        self.closed = False

    def push_frame(self, frame):
        pass

    def __aiter__(self):
        return self._events()

    async def _events(self):
        def event(kind, text):
            return stt.SpeechEvent(type=kind, alternatives=[stt.SpeechData(text=text, language="")])

        yield event(stt.SpeechEventType.INTERIM_TRANSCRIPT, "the release goes")
        await asyncio.sleep(self.final_after)
        yield event(stt.SpeechEventType.FINAL_TRANSCRIPT, "The release goes out on Monday.")
        await asyncio.Event().wait()  # the realtime stream stays open until closed

    async def aclose(self):
        self.closed = True


class _NoAudio:
    def __aiter__(self):
        return self

    async def __anext__(self):
        await asyncio.Event().wait()

    async def aclose(self):
        pass


class ShadowTranscriberTest(unittest.IsolatedAsyncioTestCase):
    async def _close_after_interim(self, final_after, timeout):
        stream = _ScriptedStream(final_after)
        fake_stt = mock.Mock()
        fake_stt.stream.return_value = stream
        finals = []
        with mock.patch.object(stt_eval.rtc.AudioStream, "from_track", return_value=_NoAudio()):
            shadow = ShadowTranscriber(
                stt_instance=fake_stt, track=None, participant_identity="u1",
                on_final=lambda text, *_: finals.append(text),
            )
            shadow.start()
            await asyncio.sleep(0.05)  # interim received
            await shadow.aclose(timeout=timeout)
        self.assertTrue(stream.closed)
        return finals

    async def test_close_waits_for_the_final_still_owed(self):
        self.assertEqual(await self._close_after_interim(0.2, timeout=2), ["The release goes out on Monday."])

    async def test_close_gives_up_after_the_timeout(self):
        self.assertEqual(await self._close_after_interim(1.0, timeout=0.1), [])


if __name__ == "__main__":
    unittest.main()
