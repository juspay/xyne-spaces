import { extractFirstUrl, extractUrls } from './urlUtils';

describe('extractFirstUrl', () => {
  it('returns a normal body URL', () => {
    const input = '<p>See <a href="https://docs.example.com/page">https://docs.example.com/page</a></p>';
    expect(extractFirstUrl(input)).toBe('https://docs.example.com/page');
  });

  it('ignores URLs inside <pre><code> blocks', () => {
    const input = '<pre><code>https://wrong-site.com/config</code></pre>';
    expect(extractFirstUrl(input)).toBeNull();
  });

  it('ignores URLs inside inline <code>', () => {
    const input = '<p>Use <code>https://old.api.com</code> but prefer <a href="https://new.api.com">https://new.api.com</a></p>';
    expect(extractFirstUrl(input)).toBe('https://new.api.com');
  });

  it('returns body URL when a code-block URL appears first', () => {
    const input = '<p>Config:</p><pre><code>https://wrong-site.com/legacy-config</code></pre><p>Docs: <a href="https://docs.example.com/new">https://docs.example.com/new</a></p>';
    expect(extractFirstUrl(input)).toBe('https://docs.example.com/new');
  });

  it('returns first non-code URL when the earliest URL is inside inline code', () => {
    const input = '<p>Old: <code>https://a.com</code> New: https://b.com Other: https://c.com</p>';
    expect(extractFirstUrl(input)).toBe('https://b.com');
  });

  it('returns null when the only URL is inside a nested code block', () => {
    const input = '<pre class="language-typescript"><code class="language-typescript">const url = "https://only-here.dev";</code></pre>';
    expect(extractFirstUrl(input)).toBeNull();
  });
});

describe('extractUrls', () => {
  it('dedupes URLs and preserves first-occurrence order outside code blocks', () => {
    const input = '<p><a href="https://example.com/a">https://example.com/a</a> and <code>https://example.com/a</code> and https://example.com/b</p>';
    expect(extractUrls(input)).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('excludes URLs that appear only inside code blocks', () => {
    const input = '<pre><code>https://internal.dev</code></pre><p>Public docs: https://docs.dev.com</p>';
    expect(extractUrls(input)).toEqual(['https://docs.dev.com']);
  });
});
