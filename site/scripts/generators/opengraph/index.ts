import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import satori from "satori";
import sharp from "sharp";
import { type GeneratedFile, Generator } from "../../lib/generator-base";

const PUBLIC_DIR = path.join(process.cwd(), "public");
const OPEN_GRAPH_DIR = path.join(PUBLIC_DIR, "open-graph");

const FONT_PATH = path.join(PUBLIC_DIR, "fonts/inter/semi-bold.ttf");

const CHANGELOG_DIR = path.join(process.cwd(), "content/changelog");

interface Page {
  title: string;
  slug: string[];
  date?: string;
}

async function renderOpenGraphPng({
  title,
  fontData,
  outputPath,
  footerLabel = "changelog",
  footerDate,
}: {
  title: string;
  fontData: Buffer;
  outputPath: string;
  footerLabel?: string;
  footerDate?: string;
}) {
  const svg = await satori(
    {
      type: "div",
      props: {
        style: {
          background: "#fcfcfc",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "space-between",
          padding: 96,
          fontFamily: "Inter",
        },
        children: [
          title.trim().length > 0
            ? {
                type: "div",
                props: {
                  style: {
                    fontSize: getTitleFontSize(title),
                    fontWeight: 600,
                    color: "#202020",
                    letterSpacing: "-1.4px",
                    lineHeight: 1.08,
                    maxWidth: 1008,
                    whiteSpace: "pre-wrap",
                  },
                  children: title,
                },
              }
            : {
                // Keep the footer pinned to the bottom (space-between),
                // while rendering "no title".
                type: "div",
                props: { style: { height: 1 }, children: "" },
              },
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 10,
              },
              children: [
                {
                  type: "div",
                  props: {
                    style: {
                      fontSize: 34,
                      fontWeight: 600,
                      color: "#202020",
                      letterSpacing: "-0.8px",
                      lineHeight: 1,
                    },
                    children: footerLabel,
                  },
                },
                ...(footerDate
                  ? [
                      {
                        type: "div",
                        props: {
                          style: {
                            fontSize: 24,
                            fontWeight: 600,
                            color: "#5a5a5a",
                            letterSpacing: "-0.4px",
                            lineHeight: 1,
                          },
                          children: footerDate,
                        },
                      },
                    ]
                  : []),
              ],
            },
          },
        ],
      },
    } as ReactNode,
    {
      width: 1200,
      height: 630,
      fonts: [
        {
          name: "Inter",
          data: fontData,
          style: "normal",
          weight: 600,
        },
      ],
    },
  );

  await sharp(Buffer.from(svg)).png().toFile(outputPath);
}

function getTitleFontSize(title: string) {
  const len = title.trim().length;
  if (len > 80) return 48;
  if (len > 60) return 54;
  if (len > 40) return 60;
  return 66;
}

function extractFrontmatter(
  content: string,
): { title: string; date?: string } | null {
  const frontmatterRegex = /^---\n([\s\S]+?)\n---/;
  const match = content.match(frontmatterRegex);

  if (!match) return null;

  const frontmatter = match[1];
  const titleMatch = frontmatter.match(/title:\s*["'](.+?)["']/);

  if (!titleMatch) return null;

  const dateMatch = frontmatter.match(/date:\s*["'](.+?)["']/);

  return {
    title: titleMatch[1],
    date: dateMatch ? dateMatch[1] : undefined,
  };
}

function formatChangelogDate(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function findMDXFiles(dir: string, prefix: string[] = []): Page[] {
  const pages: Page[] = [];

  function walk(currentDir: string, slugParts: string[] = []) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory() && entry.name !== "demos") {
        walk(fullPath, [...slugParts, entry.name]);
      } else if (entry.name === "index.mdx") {
        const content = fs.readFileSync(fullPath, "utf-8");
        const frontmatter = extractFrontmatter(content);

        if (frontmatter) {
          pages.push({
            title: frontmatter.title,
            slug: [...prefix, ...slugParts],
            date: frontmatter.date,
          });
        }
      }
    }
  }

  walk(dir);
  return pages;
}

export class OpenGraphGenerator extends Generator {
  constructor() {
    super({ name: "images", label: "open graph" });
  }

  protected async generate(): Promise<GeneratedFile[]> {
    if (!fs.existsSync(OPEN_GRAPH_DIR)) {
      fs.mkdirSync(OPEN_GRAPH_DIR, { recursive: true });
    }

    const fontData = fs.readFileSync(FONT_PATH);
    const files: GeneratedFile[] = [];

    // Default OG image (used as a site-wide fallback).
    const defaultOutputPath = path.join(OPEN_GRAPH_DIR, "default.png");
    await renderOpenGraphPng({
      title: "",
      fontData,
      outputPath: defaultOutputPath,
    });
    {
      const stats = fs.statSync(defaultOutputPath);
      files.push({
        name: "default",
        path: defaultOutputPath,
        size: stats.size,
      });
    }

    const pages = [...findMDXFiles(CHANGELOG_DIR, ["changelog"])];

    for (const page of pages) {
      const slugPath = page.slug.join("/");
      const outputDir = path.join(OPEN_GRAPH_DIR, slugPath);
      const outputPath = path.join(outputDir, "image.png");

      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      await renderOpenGraphPng({
        title: page.title,
        fontData,
        outputPath,
        footerLabel: "Changelog",
        footerDate: page.date ? formatChangelogDate(page.date) : undefined,
      });

      const stats = fs.statSync(outputPath);
      files.push({
        name: slugPath,
        path: outputPath,
        size: stats.size,
      });
    }

    return files;
  }
}
