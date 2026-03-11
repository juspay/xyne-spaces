// source.config.ts
import {
  defineConfig,
  defineDocs,
  frontmatterSchema
} from "fumadocs-mdx/config";
import { z } from "zod";
var changelogDocs = defineDocs({
  dir: "content/changelog",
  docs: {
    schema: frontmatterSchema.extend({
      date: z.iso.date(),
      description: z.string(),
      coverImage: z.string().optional(),
      tags: z.array(z.string()).optional()
    })
  },
  meta: {}
});
var source_config_default = defineConfig({
  mdxOptions: {
    providerImportSource: "@/mdx-components",
    remarkPlugins: [],
    rehypePlugins: [],
    rehypeCodeOptions: {
      themes: {
        light: "github-light",
        dark: "github-dark"
      }
    }
  }
});
export {
  changelogDocs,
  source_config_default as default
};
