import json
import unittest

import httpx
from PIL import Image

from lighton_client import LightOnClient, LightOnClientConfig, _truncate_repetition


class LightOnClientTest(unittest.IsolatedAsyncioTestCase):
    async def test_openai_compatible_payload_uses_image_url_data_uri(self):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["headers"] = dict(request.headers)
            seen["payload"] = json.loads(request.content.decode("utf-8"))
            return httpx.Response(
                200,
                json={"choices": [{"message": {"content": "# OCR"}}]},
            )

        client = LightOnClient(
            LightOnClientConfig(
                endpoint_url="https://lighton.example/v1/chat/completions",
                model="lightonai/LightOnOCR-2-1B-bbox",
                token="secret",
                timeout_seconds=10,
                max_output_tokens=123,
                temperature=0.0,
                concurrency=2,
                retries=0,
                ssl_verify=True,
                image_max_dim=64,
                jpeg_quality=80,
            )
        )
        await client._client.aclose()
        client._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        try:
            text = await client.ocr_image(Image.new("RGB", (10, 10), "white"), "Prompt")
        finally:
            await client.close()

        assert text == "# OCR"
        assert seen["headers"]["authorization"] == "Bearer secret"
        payload = seen["payload"]
        assert payload["model"] == "lightonai/LightOnOCR-2-1B-bbox"
        assert payload["max_tokens"] == 123
        content = payload["messages"][0]["content"]
        assert content[0] == {"type": "text", "text": "Prompt"}
        assert content[1]["image_url"]["url"].startswith("data:image/jpeg;base64,")

    async def test_repeated_crop_blocks_are_collapsed(self):
        repeated = (
            "The following text is not part of the image.\n"
            "It is received in an in-principle approval letter dated 1993.\n\n"
        )

        cleaned = _truncate_repetition(repeated * 20)

        assert cleaned.count("The following text is not part of the image.") == 1

    async def test_repeated_token_loop_is_capped(self):
        cleaned = _truncate_repetition("approved " * 20 + "done")

        assert cleaned == "approved approved approved done"


if __name__ == "__main__":
    unittest.main()
