import { describe, expect, it, vi } from "vitest";

const mockGetAppBasePath = vi.hoisted(() => vi.fn(() => ""));
const mockGetDb = vi.hoisted(() => vi.fn());
const mockGetMethod = vi.hoisted(() => vi.fn(() => "GET"));
const mockGetRequestURL = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  getAppBasePath: () => mockGetAppBasePath(),
}));

vi.mock("h3", () => ({
  getMethod: () => mockGetMethod(),
  getRequestURL: () => mockGetRequestURL(),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
}));

vi.mock("../db/index.js", () => ({
  getDb: () => mockGetDb(),
  schema: {
    forms: {
      id: "forms.id",
      slug: "forms.slug",
    },
  },
}));

import {
  getPublicFormBySlugOrId,
  invalidatePublicFormCache,
  renderPublicFormHtml,
  renderPublicForm,
} from "./public-form-ssr";

function createDbWithRows(rows: unknown[]) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn((condition: { column: unknown; value: unknown }) => {
          const key = condition.column === "forms.id" ? "id" : "slug";
          return Promise.resolve(
            rows.filter(
              (row) =>
                (row as { id?: unknown; slug?: unknown })[key] ===
                condition.value,
            ),
          );
        }),
      })),
    })),
  };
}

describe("public form SSR", () => {
  it("does not emit CSP headers on direct public form HTML responses", async () => {
    mockGetRequestURL.mockReturnValue(
      new URL("https://forms.example.test/f/nope"),
    );
    mockGetDb.mockReturnValue(createDbWithRows([]));

    const response = await renderPublicForm({} as any);

    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("content-security-policy")).toBeNull();
    expect(
      response.headers.get("content-security-policy-report-only"),
    ).toBeNull();
  });

  it("emits form-specific social metadata and a versioned OG image URL", async () => {
    mockGetRequestURL.mockReturnValue(
      new URL("https://forms.example.test/f/customer-intake-123"),
    );
    mockGetDb.mockReturnValue(
      createDbWithRows([
        {
          id: "form-123",
          slug: "customer-intake-123",
          title: "Customer intake",
          description: "Tell us what you need.",
          ownerEmail: "owner@example.test",
          updatedAt: "2026-07-14T12:00:00.000Z",
          fields: "[]",
          settings: "{}",
          status: "published",
          deletedAt: null,
        },
      ]),
    );

    const response = await renderPublicForm({} as any);
    const html = await response.text();

    expect(html).toContain(
      '<meta property="og:title" content="Customer intake">',
    );
    expect(html).toContain(
      '<meta property="og:description" content="Tell us what you need.">',
    );
    expect(html).toContain(
      "/api/forms/og/customer-intake-123/og.png?v=2026-07-14T12%3A00%3A00.000Z",
    );
  });

  it("prefixes browser-facing URLs with WORKSPACE_PUBLIC_PREFIX when set", async () => {
    const rows = [
      {
        id: "form-prefix-123",
        slug: "prefix-form",
        title: "Prefixed",
        description: null,
        ownerEmail: "owner@example.test",
        updatedAt: "2026-07-14T12:00:00.000Z",
        fields: "[]",
        settings: "{}",
        status: "published",
        deletedAt: null,
      },
    ];
    mockGetDb.mockReturnValue(createDbWithRows(rows));

    const dev = await renderPublicFormHtml(
      "https://forms.example.test/f/prefix-form",
    );
    expect(dev.html).toContain('fetch("/api/submit/" + FORM_ID');
    expect(dev.html).toContain('href="/favicon.svg"');
    expect(dev.html).toContain(
      'var PUBLIC_FORM_API = "/api/forms/public/prefix-form";',
    );

    mockGetAppBasePath.mockReturnValue("/forms");
    process.env.WORKSPACE_PUBLIC_PREFIX = "/inbound";
    try {
      const prod = await renderPublicFormHtml(
        "https://forms.example.test/forms/f/prefix-form",
      );
      expect(prod.html).toContain(
        'fetch("/inbound/forms/api/submit/" + FORM_ID',
      );
      expect(prod.html).toContain('href="/inbound/forms/favicon.svg"');
      expect(prod.html).toContain(
        "/inbound/forms/api/forms/og/prefix-form/og.png?v=2026-07-14T12%3A00%3A00.000Z",
      );
      expect(prod.html).toContain(
        'var PUBLIC_FORM_API = "/inbound/forms/api/forms/public/prefix-form";',
      );
    } finally {
      delete process.env.WORKSPACE_PUBLIC_PREFIX;
      mockGetAppBasePath.mockReturnValue("");
    }
  });

  it("renders demo-fill controls only on the public talk-to-sales form", async () => {
    const rows = [
      {
        id: "form-demo-123",
        slug: "talk-to-sales",
        title: "Talk to sales",
        description: "Tell us what you're solving.",
        ownerEmail: "owner@example.test",
        updatedAt: "2026-07-20T12:00:00.000Z",
        fields: "[]",
        settings: "{}",
        status: "published",
        deletedAt: null,
      },
      {
        id: "form-standard-123",
        slug: "customer-intake",
        title: "Customer intake",
        description: null,
        ownerEmail: "owner@example.test",
        updatedAt: "2026-07-20T12:00:00.000Z",
        fields: "[]",
        settings: "{}",
        status: "published",
        deletedAt: null,
      },
    ];
    mockGetDb.mockReturnValue(createDbWithRows(rows));

    const demo = await renderPublicFormHtml(
      "https://forms.example.test/f/talk-to-sales",
    );
    const standard = await renderPublicFormHtml(
      "https://forms.example.test/f/customer-intake",
    );

    expect(demo.html).toContain("Fill sample ICP (demo)");
    expect(demo.html).toContain("Fill mid-band (demo)");
    expect(demo.html).toContain("Nothing you enter leaves this demo.");
    expect(demo.html).toContain('data-demo-fill="icp"');
    expect(standard.html).not.toContain("Fill sample ICP (demo)");
    expect(standard.html).not.toContain("Nothing you enter leaves this demo.");
  });

  it("refreshes cached forms after invalidating old and new lookup keys", async () => {
    const rows = [
      {
        id: "form-cache-123",
        slug: "old-cache-slug",
        title: "Before update",
        description: null,
        ownerEmail: "owner@example.test",
        updatedAt: "2026-07-14T12:00:00.000Z",
        fields: "[]",
        settings: "{}",
        status: "published",
        deletedAt: null,
      },
    ];
    mockGetDb.mockReturnValue(createDbWithRows(rows));

    await expect(
      getPublicFormBySlugOrId("old-cache-slug"),
    ).resolves.toMatchObject({ title: "Before update" });
    await expect(
      getPublicFormBySlugOrId("form-cache-123"),
    ).resolves.toMatchObject({ title: "Before update" });

    rows[0] = {
      ...rows[0],
      slug: "new-cache-slug",
      title: "After update",
    };
    invalidatePublicFormCache(
      { id: "form-cache-123", slug: "old-cache-slug" },
      { id: "form-cache-123", slug: "new-cache-slug" },
    );

    await expect(getPublicFormBySlugOrId("old-cache-slug")).resolves.toBeNull();
    await expect(
      getPublicFormBySlugOrId("new-cache-slug"),
    ).resolves.toMatchObject({ title: "After update", slug: "new-cache-slug" });
    await expect(
      getPublicFormBySlugOrId("form-cache-123"),
    ).resolves.toMatchObject({ title: "After update", slug: "new-cache-slug" });

    rows[0] = { ...rows[0], title: "After second update" };
    invalidatePublicFormCache({ id: "form-cache-123", slug: "new-cache-slug" });
    await expect(
      getPublicFormBySlugOrId("new-cache-slug"),
    ).resolves.toMatchObject({ title: "After second update" });
  });

  it("uses the version query in the SSR cache key and embeds revalidation", async () => {
    const rows = [
      {
        id: "form-versioned-123",
        slug: "versioned-cache-slug",
        title: "Before version bump",
        description: null,
        ownerEmail: "owner@example.test",
        updatedAt: "2026-07-14T12:00:00.000Z",
        fields: "[]",
        settings: "{}",
        status: "published",
        deletedAt: null,
      },
    ];
    mockGetDb.mockReturnValue(createDbWithRows(rows));

    const first = await renderPublicFormHtml(
      "https://forms.example.test/f/versioned-cache-slug",
    );
    expect(first.html).toContain("<title>Before version bump</title>");
    expect(first.html).toContain(
      'var FORM_VERSION = "2026-07-14T12:00:00.000Z";',
    );
    expect(first.html).toContain(
      'fetch(PUBLIC_FORM_API, { cache: "no-store" })',
    );

    rows[0] = {
      ...rows[0],
      title: "After version bump",
      updatedAt: "2026-07-14T12:01:00.000Z",
    };

    const refreshed = await renderPublicFormHtml(
      "https://forms.example.test/f/versioned-cache-slug?v=2026-07-14T12%3A01%3A00.000Z",
    );
    expect(refreshed.html).toContain("<title>After version bump</title>");
    expect(refreshed.html).toContain(
      'var FORM_VERSION = "2026-07-14T12:01:00.000Z";',
    );
  });
});
