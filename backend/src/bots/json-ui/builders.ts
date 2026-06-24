import type { SingleLineText, MultiLineText, Tag, SplitTag, AvatarGroup, FlexLayout, Component } from './types';

/**
 * Create a single line text component
 */
export function createSingleLineText(
  text: string,
  options?: {
    weight?: 'normal' | 'medium' | 'semibold' | 'bold';
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
    color?: string;
  }
): SingleLineText {
  return {
    type: 'singleLineText',
    props: {
      text,
      weight: options?.weight || 'normal',
      size: options?.size || 'md',
      ...(options?.color && { color: options.color }),
    },
  };
}

/**
 * Create a multi line text component
 */
export function createMultiLineText(
  text: string,
  options?: {
    maxLines?: number;
    weight?: 'normal' | 'medium' | 'semibold' | 'bold';
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
    color?: string;
  }
): MultiLineText {
  return {
    type: 'multiLineText',
    props: {
      text,
      ...(options?.maxLines && { maxLines: options.maxLines }),
      weight: options?.weight || 'normal',
      size: options?.size || 'md',
      ...(options?.color && { color: options.color }),
    },
  };
}

/**
 * Create a tag component
 */
export function createTag(
  text: string,
  options?: {
    variant?: 'subtle' | 'attentive' | 'noFill';
    color?: 'success' | 'warning' | 'error' | 'info' | 'neutral';
    size?: 'sm' | 'md' | 'lg';
  }
): Tag {
  return {
    type: 'tag',
    props: {
      text,
      variant: options?.variant || 'subtle',
      color: options?.color || 'neutral',
      size: options?.size || 'md',
    },
  };
}

/**
 * Create a split tag component
 */
export function createSplitTag(
  primaryText: string,
  secondaryText: string,
  options?: {
    variant?: 'subtle' | 'attentive' | 'noFill';
    color?: 'success' | 'warning' | 'error' | 'info' | 'neutral';
    size?: 'sm' | 'md' | 'lg';
    shape?: 'rounded' | 'squarical';
  }
): SplitTag {
  return {
    type: 'splitTag',
    props: {
      primaryText,
      secondaryText,
      ...(options?.variant && { variant: options.variant }),
      color: options?.color || 'neutral',
      size: options?.size || 'md',
      shape: options?.shape || 'squarical',
    },
  };
}

/**
 * Create an avatar group component
 */
export function createAvatarGroup(
  avatars: Array<{ name: string; picture?: string }>,
  options?: {
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
    maxVisible?: number;
  }
): AvatarGroup {
  return {
    type: 'avatarGroup',
    props: {
      avatars,
      size: options?.size || 'md',
      ...(options?.maxVisible && { maxVisible: options.maxVisible }),
    },
  };
}

/**
 * Create a flex layout component
 */
export function createFlexLayout(
  children: Component[],
  options?: {
    direction?: 'row' | 'column';
    justify?: 'start' | 'center' | 'end' | 'between' | 'around';
    align?: 'start' | 'center' | 'end' | 'stretch';
    gap?: number;
    wrap?: boolean;
    padding?: number;
    background?: string;
    backgroundSize?: string;
    backgroundPosition?: string;
    backgroundRepeat?: string;
    borderRadius?: number;
    width?: string;
    height?: string;
    minHeight?: string;
  }
): FlexLayout {
  return {
    type: 'flex',
    children,
    props: {
      direction: options?.direction || 'column',
      justify: options?.justify || 'start',
      align: options?.align || 'start',
      gap: options?.gap || 8,
      wrap: options?.wrap || false,
      ...(options?.padding !== undefined && { padding: options.padding }),
      ...(options?.background && { background: options.background }),
      ...(options?.backgroundSize && { backgroundSize: options.backgroundSize }),
      ...(options?.backgroundPosition && { backgroundPosition: options.backgroundPosition }),
      ...(options?.backgroundRepeat && { backgroundRepeat: options.backgroundRepeat }),
      ...(options?.borderRadius !== undefined && { borderRadius: options.borderRadius }),
      ...(options?.width && { width: options.width }),
      ...(options?.height && { height: options.height }),
      ...(options?.minHeight && { minHeight: options.minHeight }),
    },
  };
}