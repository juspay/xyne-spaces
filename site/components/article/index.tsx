"use client";

import React, { createContext, useContext, useMemo } from "react";
import Image from "next/image";

// Types
export interface SerializablePageData {
  title: string;
  description?: string;
  date: string;
  slugs?: string[];
  url?: string;
  path?: string;
  coverImage?: string;
  tags?: string[];
}

export interface ArticleContextValue {
  page: SerializablePageData;
}

// Context
const ArticleContext = createContext<ArticleContextValue | null>(null);

function useArticleContext(componentName: string): ArticleContextValue {
  const context = useContext(ArticleContext);
  if (!context) {
    throw new Error(
      `<Article.${componentName}> must be used within <Article.Root>`,
    );
  }
  return context;
}

export function useArticle(): ArticleContextValue {
  const context = useContext(ArticleContext);
  if (!context) {
    throw new Error("useArticle must be used within <Article.Root>");
  }
  return context;
}

// Utils
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Root Component
interface RootProps {
  data: SerializablePageData;
  children: React.ReactNode;
  className?: string;
}

function Root({ data: page, children, className }: RootProps) {
  const contextValue: ArticleContextValue = useMemo(() => ({ page }), [page]);

  return (
    <ArticleContext.Provider value={contextValue}>
      <div className={className}>{children}</div>
    </ArticleContext.Provider>
  );
}

// Header Component
interface HeaderProps {
  className?: string;
}

function Header({ className }: HeaderProps) {
  const { page } = useArticleContext("Header");

  return (
    <div
      className={[
        "relative flex flex-col items-start gap-1 self-stretch mb-8",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <time
        className="text-[16px] font-medium not-italic leading-[120%] tracking-[-0.1px] text-[#0F406F]"
        dateTime={page.date}
      >
        {formatDate(page.date)}
      </time>
      <h1 className="text-[40px] font-medium not-italic leading-[120%] tracking-[-0.1px] text-[#0F406F] pt-4">
        {page.title}
      </h1>
      {page.description && (
        <p className="text-[20px] font-medium not-italic leading-[140%] text-[#777F97]">
          {page.description}
        </p>
      )}
    </div>
  );
}

// Cover Component
interface CoverProps {
  className?: string;
  priority?: boolean;
}

function Cover({ className, priority }: CoverProps) {
  const { page } = useArticleContext("Cover");

  if (!page.coverImage) return null;

  return (
    <div
      className={[
        "relative w-full overflow-hidden rounded-lg mb-8",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Image
        src={page.coverImage}
        alt=""
        width={0}
        height={0}
        sizes="100vw"
        className="w-full h-auto"
        priority={priority}
      />
    </div>
  );
}

// Tags Component
interface TagsProps {
  className?: string;
}

function Tags({ className }: TagsProps) {
  const { page } = useArticleContext("Tags");

  if (!page.tags?.length) return null;

  return (
    <div
      className={[
        "flex flex-wrap gap-3",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      role="list"
      aria-label="Article tags"
    >
      {page.tags.map((tag) => (
        <span
          key={tag}
          role="listitem"
          className="text-[#7C8698] text-[15px] not-italic font-medium tracking-[-0.15px] px-3 py-1 rounded-md bg-[#F2F4F7]"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

// Content Component
interface ContentProps {
  children: React.ReactNode;
  className?: string;
}

function Content({ children, className }: ContentProps) {
  return (
    <article className={className} data-article-content>
      {children}
    </article>
  );
}

// Exports - named exports for individual components
export {
  Root as ArticleRoot,
  Header as ArticleHeader,
  Cover as ArticleCover,
  Tags as ArticleTags,
  Content as ArticleContent,
};

// Compound component pattern - namespace export
export const Article = {
  Root,
  Header,
  Cover,
  Tags,
  Content,
} as const;
