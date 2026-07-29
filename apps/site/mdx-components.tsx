import type { MDXComponents } from "mdx/types";
import Image from "next/image";

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...components,
    h1: (props) => <h1 data-prose-type="heading" {...props} />,
    h2: (props) =>
      props.id === "footnote-label" ? (
        <hr />
      ) : (
        <h2 data-prose-type="heading" {...props} />
      ),
    h3: (props) => <h3 data-prose-type="heading" {...props} />,
    h4: (props) => <h4 data-prose-type="heading" {...props} />,
    h5: (props) => <h5 data-prose-type="heading" {...props} />,
    h6: (props) => <h6 data-prose-type="heading" {...props} />,
    p: (props) => <p data-prose-type="text" {...props} />,
    li: (props) => <li data-prose-type="text" {...props} />,
    ul: (props) => <ul data-prose-type="list" {...props} />,
    ol: (props) => <ol data-prose-type="list" {...props} />,
    img: (props) => (
      <Image
        alt={props.alt || ""}
        src={props.src || ""}
        width={0}
        height={0}
        sizes="100vw"
        data-prose-type="image"
      />
    ),
    video: (props) => (
      <video
        controls
        playsInline
        data-prose-type="video"
        {...props}
      />
    ),
  };
}

export const useMDXComponents = getMDXComponents;
