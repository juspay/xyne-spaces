import { describe, it, expect, afterEach } from "vitest";
import { providerBaseUrlError } from "./provider-base-url.js";

const ORIGINAL_ENV = process.env["NODE_ENV"];
afterEach(() => {
  process.env["NODE_ENV"] = ORIGINAL_ENV;
});

describe("providerBaseUrlError", () => {
  it("accepts a public https literal", async () => {
    expect(await providerBaseUrlError("https://93.184.216.34/v1")).toBeNull();
  });

  it("rejects plain http to a public host", async () => {
    expect(await providerBaseUrlError("http://93.184.216.34/v1")).toBe("must use https");
  });

  it("rejects non-URLs and other schemes", async () => {
    expect(await providerBaseUrlError("not a url")).toBe("must be an absolute https URL");
    expect(await providerBaseUrlError("ftp://93.184.216.34/")).toBe("must use https");
  });

  it("rejects metadata, RFC1918, v4-mapped and ULA targets over https", async () => {
    for (const url of ["https://169.254.169.254/", "https://10.0.0.1/", "https://[::ffff:169.254.169.254]/", "https://[fd00::1]/"]) {
      expect(await providerBaseUrlError(url), url).toBe("must be a public https endpoint");
    }
  });

  it("allows http loopback outside production only", async () => {
    process.env["NODE_ENV"] = "development";
    expect(await providerBaseUrlError("http://127.0.0.1:4000")).toBeNull();
    process.env["NODE_ENV"] = "production";
    expect(await providerBaseUrlError("http://127.0.0.1:4000")).toBe("must use https");
    expect(await providerBaseUrlError("https://127.0.0.1:4000")).toBe("must be a public https endpoint");
  });
});
