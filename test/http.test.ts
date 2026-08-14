import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FetchError, assertPublicUrl } from "../src/http.ts";

async function expectBlocked(url: string): Promise<void> {
  await assert.rejects(
    () => assertPublicUrl(url),
    (error: unknown) => {
      assert.ok(error instanceof FetchError, `expected FetchError for ${url}`);
      assert.equal(error.code, "blocked", `expected ${url} to be blocked, got ${error.code}`);
      return true;
    },
  );
}

describe("assertPublicUrl", () => {
  const previous = process.env["RATDUCK_ALLOW_PRIVATE"];
  delete process.env["RATDUCK_ALLOW_PRIVATE"];

  it("rejects loopback and localhost", async () => {
    await expectBlocked("http://127.0.0.1/");
    await expectBlocked("http://localhost:8080/");
    await expectBlocked("http://[::1]/");
  });

  it("rejects RFC1918 and link-local addresses", async () => {
    await expectBlocked("http://10.1.2.3/");
    await expectBlocked("http://192.168.0.1/");
    await expectBlocked("http://172.16.5.4/");
    await expectBlocked("http://169.254.169.254/latest/meta-data/");
  });

  it("rejects non-http schemes", async () => {
    await assert.rejects(() => assertPublicUrl("file:///etc/passwd"), /Only http\/https/);
    await assert.rejects(() => assertPublicUrl("not a url"), /Not a valid URL/);
  });

  it("accepts a public address", async () => {
    const url = await assertPublicUrl("https://1.1.1.1/");
    assert.equal(url.hostname, "1.1.1.1");
  });

  it("can be disabled via RATDUCK_ALLOW_PRIVATE", async () => {
    process.env["RATDUCK_ALLOW_PRIVATE"] = "1";
    const url = await assertPublicUrl("http://127.0.0.1:1234/x");
    assert.equal(url.port, "1234");
    if (previous === undefined) delete process.env["RATDUCK_ALLOW_PRIVATE"];
    else process.env["RATDUCK_ALLOW_PRIVATE"] = previous;
  });
});
