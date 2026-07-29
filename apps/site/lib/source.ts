import { changelogDocs } from "fumadocs/server";
import { type InferPageType, loader } from "fumadocs-core/source";

export const changelogSource = loader({
  baseUrl: "/changelog",
  source: changelogDocs.toFumadocsSource(),
});

export type Page = InferPageType<typeof changelogSource>;
export type PageData = Page["data"];

export const getChangelogPageImage = (page: Page) => {
  const segments = [...page.slugs, "image.png"];
  return {
    segments,
    url: `/open-graph/changelog/${page.slugs.join("/")}/image.png`,
  };
};
