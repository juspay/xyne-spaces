import type { SingleLineText, MultiLineText, Icon, Tag, SplitTag, Image, KeyValue, AvatarGroup, Dropdown, FlexLayout, Component } from './types';

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
 * Create an icon component
 */
export function createIcon(
  name: string,
  options?: {
    size?: number;
    color?: string;
  }
): Icon {
  return {
    type: 'icon',
    props: {
      name,
      size: options?.size || 24,
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
 * Create an image component
 */
export function createImage(
  src: string,
  options?: {
    alt?: string;
    width?: number | string;
    height?: number | string;
    objectFit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
  }
): Image {
  return {
    type: 'image',
    props: {
      src,
      ...(options?.alt && { alt: options.alt }),
      ...(options?.width && { width: options.width }),
      ...(options?.height && { height: options.height }),
      objectFit: options?.objectFit || 'cover',
    },
  };
}

/**
 * Create a key-value pair component
 */
export function createKeyValue(
  keyString: string,
  value: string,
  options?: {
    keyWeight?: 'normal' | 'medium' | 'semibold' | 'bold';
    valueWeight?: 'normal' | 'medium' | 'semibold' | 'bold';
    keySize?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
    valueSize?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  }
): KeyValue {
  return {
    type: 'keyValue',
    props: {
      keyString,
      value,
      keyWeight: options?.keyWeight || 'semibold',
      valueWeight: options?.valueWeight || 'normal',
      keySize: options?.keySize || 'sm',
      valueSize: options?.valueSize || 'sm',
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
 * Create a dropdown component
 */
export function createDropdown(
  placeholder: string,
  items: Array<{
    groupLabel?: string;
    items: Array<{
      value: string;
      label: string;
      subLabel?: string;
      disabled?: boolean;
    }>;
    showSeparator?: boolean;
  }>,
  options?: {
    label?: string;
    subLabel?: string;
    selected?: string;
    disabled?: boolean;
    required?: boolean;
    fullWidth?: boolean;
    enableSearch?: boolean;
    error?: boolean;
    errorMessage?: string;
  }
): Dropdown {
  return {
    type: 'dropdown',
    props: {
      placeholder,
      items,
      ...(options?.label !== undefined && { label: options.label }),
      ...(options?.subLabel !== undefined && { subLabel: options.subLabel }),
      selected: options?.selected || '',
      disabled: options?.disabled || false,
      required: options?.required || false,
      fullWidth: options?.fullWidth || false,
      enableSearch: options?.enableSearch || false,
      error: options?.error || false,
      ...(options?.errorMessage && { errorMessage: options.errorMessage }),
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

/**
 * Helper to create a simple text response (single component)
 */
export function createSimpleTextResponse(
  text: string,
  multiLine: boolean = false,
  options?: {
    weight?: 'normal' | 'medium' | 'semibold' | 'bold';
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
    color?: string;
    maxLines?: number;
  }
): Component {
  return multiLine 
    ? createMultiLineText(text, options)
    : createSingleLineText(text, options);
}

/**
 * Helper to create a structured response with multiple text elements
 */
export function createStructuredTextResponse(
  elements: Array<{
    text: string;
    multiLine?: boolean;
    weight?: 'normal' | 'medium' | 'semibold' | 'bold';
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
    color?: string;
    maxLines?: number;
  }>,
  layoutOptions?: {
    direction?: 'row' | 'column';
    justify?: 'start' | 'center' | 'end' | 'between' | 'around';
    align?: 'start' | 'center' | 'end' | 'stretch';
    gap?: number;
  }
): Component {
  const children: Component[] = [];

  // Create text components
  for (const element of elements) {
    const textComponent = element.multiLine
      ? createMultiLineText(element.text, element)
      : createSingleLineText(element.text, element);
    
    children.push(textComponent);
  }

  // Create flex layout
  return createFlexLayout(children, layoutOptions);
}