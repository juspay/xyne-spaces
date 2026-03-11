import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  changelogSource,
  getChangelogPageImage,
  type Page,
} from "@/lib/source";
import { getMDXComponents } from "@/mdx-components";
import { PageTransition } from "@/components/page-transitions";
import {
  ArticleContent,
  ArticleCover,
  ArticleHeader,
  ArticleRoot,
  ArticleTags,
  type SerializablePageData,
} from "@/components/article";
import { SITE_MANIFEST } from "@/lib/site";

export async function generateStaticParams() {
  return changelogSource.generateParams();
}

export async function generateMetadata(props: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const params = await props.params;
  const page = changelogSource.getPage(params.slug);

  if (!page) notFound();

  const ogImageUrl = getChangelogPageImage(page).url;
  const pageUrl = `${SITE_MANIFEST.url}/changelog/${params.slug.join("/")}`;

  const metaData = {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      type: "article",
      title: page.data.title,
      description: page.data.description,
      url: pageUrl,
      siteName: SITE_MANIFEST.name,
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: page.data.title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: page.data.title,
      description: page.data.description,
      images: [ogImageUrl],
    },
  };

  return metaData;
}

function getSerializedPageData(page: Page): SerializablePageData {
  const data = page.data as Page["data"] & { coverImage?: string; tags?: string[] };
  return {
    title: page.data.title,
    description: page.data.description,
    date: page.data.date,
    slugs: page.slugs,
    url: `${SITE_MANIFEST.url}/changelog/${page.slugs.join("/")}`,
    path: page.path,
    coverImage: data.coverImage,
    tags: data.tags,
  };
}

export default async function CraftPage(props: {
  params: Promise<{ slug: string[] }>;
}) {
  const params = await props.params;
  const page = changelogSource.getPage(params.slug);

  if (!page) notFound();

  const pageData = getSerializedPageData(page);
  const MDX = page.data.body;

  return (
    <PageTransition>
      <div className="flex flex-col w-full">
        <div className="min-h-(--page-navigation-height)" />
        <ArticleRoot data={pageData}>
          <ArticleHeader />
          <ArticleCover />
          <ArticleTags className="mb-6" />
          <ArticleContent>
            <MDX components={getMDXComponents()} />
          </ArticleContent>
        </ArticleRoot>
        <div className="min-h-(--page-navigation-height)" />
      </div>
    </PageTransition>
  );
}
