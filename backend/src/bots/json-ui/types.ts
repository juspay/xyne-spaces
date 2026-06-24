import { z } from 'zod';

/**
 * Base component schema - all UI components extend this
 */
export const BaseComponentSchema = z.object({
  type: z.string(),
  props: z.record(z.any()).optional(),
});

/**
 * Single Line Text Component
 */
export const SingleLineTextSchema = z.object({
  type: z.literal('singleLineText'),
  props: z.object({
    text: z.string(),
    weight: z.enum(['normal', 'medium', 'semibold', 'bold']).default('normal'),
    size: z.enum(['xs', 'sm', 'md', 'lg', 'xl']).default('md'),
    color: z.string().optional(),
  }),
});

/**
 * Multi Line Text Component
 */
export const MultiLineTextSchema = z.object({
  type: z.literal('multiLineText'),
  props: z.object({
    text: z.string(),
    maxLines: z.number().min(1).optional(),
    weight: z.enum(['normal', 'medium', 'semibold', 'bold']).default('normal'),
    size: z.enum(['xs', 'sm', 'md', 'lg', 'xl']).default('md'),
    color: z.string().optional(),
  }),
});

/**
 * Icon Component
 */
export const IconSchema = z.object({
  type: z.literal('icon'),
  props: z.object({
    name: z.string(),
    size: z.number().default(24),
    color: z.string().optional(),
  }),
});

/**
 * Tag Component
 */
export const TagSchema = z.object({
  type: z.literal('tag'),
  props: z.object({
    text: z.string(),
    variant: z.enum(['subtle', 'attentive', 'noFill']).default('subtle'),
    color: z.enum(['success', 'warning', 'error', 'info', 'neutral']).default('neutral'),
    size: z.enum(['sm', 'md', 'lg']).default('md'),
  }),
});

/**
 * SplitTag Component
 */
export const SplitTagSchema = z.object({
  type: z.literal('splitTag'),
  props: z.object({
    primaryText: z.string(),
    secondaryText: z.string(),
    variant: z.enum(['subtle', 'attentive', 'noFill']).optional(),
    color: z.enum(['success', 'warning', 'error', 'info', 'neutral']).default('neutral'),
    size: z.enum(['sm', 'md', 'lg']).default('md'),
    shape: z.enum(['rounded', 'squarical']).default('squarical'),
  }),
});

/**
 * Image Component
 */
export const ImageSchema = z.object({
  type: z.literal('image'),
  props: z.object({
    src: z.string(),
    alt: z.string().optional(),
    width: z.union([z.number(), z.string()]).optional(),
    height: z.union([z.number(), z.string()]).optional(),
    objectFit: z.enum(['contain', 'cover', 'fill', 'none', 'scale-down']).default('cover'),
  }),
});

/**
 * KeyValue Component
 */
export const KeyValueSchema = z.object({
  type: z.literal('keyValue'),
  props: z.object({
    keyString: z.string(),
    value: z.string(),
    keyWeight: z.enum(['normal', 'medium', 'semibold', 'bold']).default('semibold'),
    valueWeight: z.enum(['normal', 'medium', 'semibold', 'bold']).default('normal'),
    keySize: z.enum(['xs', 'sm', 'md', 'lg', 'xl']).default('sm'),
    valueSize: z.enum(['xs', 'sm', 'md', 'lg', 'xl']).default('sm'),
  }),
});

/**
 * AvatarGroup Component
 */
export const AvatarGroupSchema = z.object({
  type: z.literal('avatarGroup'),
  props: z.object({
    avatars: z.array(z.object({
      name: z.string(),
      picture: z.string().optional(),
    })),
    size: z.enum(['xs', 'sm', 'md', 'lg', 'xl']).default('md'),
    maxVisible: z.number().optional(),
  }),
});

/**
 * Dropdown Component
 */
export const DropdownSchema = z.object({
  type: z.literal('dropdown'),
  props: z.object({
    label: z.string().optional(),
    subLabel: z.string().optional(),
    placeholder: z.string(),
    items: z.array(z.object({
      groupLabel: z.string().optional(),
      items: z.array(z.object({
        value: z.string(),
        label: z.string(),
        subLabel: z.string().optional(),
        disabled: z.boolean().optional(),
      })),
      showSeparator: z.boolean().optional(),
    })),
    selected: z.string().optional(),
    disabled: z.boolean().default(false),
    required: z.boolean().default(false),
    fullWidth: z.boolean().default(false),
    enableSearch: z.boolean().default(false),
    error: z.boolean().default(false),
    errorMessage: z.string().optional(),
  }),
});

/**
 * Base schemas for leaf components (no recursion)
 */
const BaseFlexLayoutSchema = z.object({
  type: z.literal('flex'),
  props: z.object({
    direction: z.enum(['row', 'column']).default('column'),
    justify: z.enum(['start', 'center', 'end', 'between', 'around']).default('start'),
    align: z.enum(['start', 'center', 'end', 'stretch']).default('start'),
    gap: z.number().min(0).default(8),
    wrap: z.boolean().default(false),
    padding: z.number().min(0).optional(),
    background: z.string().optional(),
    backgroundSize: z.string().optional(),
    backgroundPosition: z.string().optional(),
    backgroundRepeat: z.string().optional(),
    borderRadius: z.number().min(0).optional(),
    width: z.string().optional(),
    height: z.string().optional(),
    minHeight: z.string().optional(),
  }).optional(),
});

/**
 * TypeScript types (defined first to avoid circular issues)
 */
export type SingleLineText = {
  type: 'singleLineText';
  props: {
    text: string;
    weight?: 'normal' | 'medium' | 'semibold' | 'bold';
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
    color?: string;
  };
};

export type MultiLineText = {
  type: 'multiLineText';
  props: {
    text: string;
    maxLines?: number;
    weight?: 'normal' | 'medium' | 'semibold' | 'bold';
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
    color?: string;
  };
};

export type Icon = {
  type: 'icon';
  props: {
    name: string;
    size?: number;
    color?: string;
  };
};

export type Tag = {
  type: 'tag';
  props: {
    text: string;
    variant?: 'subtle' | 'attentive' | 'noFill';
    color?: 'success' | 'warning' | 'error' | 'info' | 'neutral';
    size?: 'sm' | 'md' | 'lg';
  };
};

export type SplitTag = {
  type: 'splitTag';
  props: {
    primaryText: string;
    secondaryText: string;
    variant?: 'subtle' | 'attentive' | 'noFill';
    color?: 'success' | 'warning' | 'error' | 'info' | 'neutral';
    size?: 'sm' | 'md' | 'lg';
    shape?: 'rounded' | 'squarical';
  };
};

export type Image = {
  type: 'image';
  props: {
    src: string;
    alt?: string;
    width?: number | string;
    height?: number | string;
    objectFit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
  };
};

export type KeyValue = {
  type: 'keyValue';
  props: {
    keyString: string;
    value: string;
    keyWeight?: 'normal' | 'medium' | 'semibold' | 'bold';
    valueWeight?: 'normal' | 'medium' | 'semibold' | 'bold';
    keySize?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
    valueSize?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  };
};

export type AvatarGroup = {
  type: 'avatarGroup';
  props: {
    avatars: Array<{
      name: string;
      picture?: string;
    }>;
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
    maxVisible?: number;
  };
};

export type Dropdown = {
  type: 'dropdown';
  props: {
    label?: string;
    subLabel?: string;
    placeholder: string;
    items: Array<{
      groupLabel?: string;
      items: Array<{
        value: string;
        label: string;
        subLabel?: string;
        disabled?: boolean;
      }>;
      showSeparator?: boolean;
    }>;
    selected?: string;
    disabled?: boolean;
    required?: boolean;
    fullWidth?: boolean;
    enableSearch?: boolean;
    error?: boolean;
    errorMessage?: string;
  };
};

export type FlexLayout = {
  type: 'flex';
  props?: {
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
  };
  children?: Component[];
};

export type Component = SingleLineText | MultiLineText | Icon | Tag | SplitTag | Image | KeyValue | AvatarGroup | Dropdown | FlexLayout;

/**
 * Recursive component schema
 */
export const ComponentSchema: z.ZodType<Component> = z.lazy(() =>
  z.union([
    SingleLineTextSchema,
    MultiLineTextSchema,
    IconSchema,
    TagSchema,
    SplitTagSchema,
    ImageSchema,
    KeyValueSchema,
    AvatarGroupSchema,
    DropdownSchema,
    BaseFlexLayoutSchema.extend({
      children: z.array(ComponentSchema).optional(),
    }),
  ])
);
/**
 * Flow JSON structure
 */
export const FlowJsonSchema = z.object({
  version: z.string().default('1.0'),
  metadata: z.object({
    botName: z.string(),
    timestamp: z.string(),
    executionId: z.string().optional(),
    tokens: z.number().optional(),
    ticketId: z.string().optional(),
    humanReadableId: z.string().optional(),
  }).passthrough(), // Allow additional properties beyond the defined ones
  root: ComponentSchema,
});

/**
 * Additional types
 */
export type BaseComponent = z.infer<typeof BaseComponentSchema>;
export type FlowJson = z.infer<typeof FlowJsonSchema>;