import { tv } from 'tailwind-variants';
import { combineStyles } from '@/src/utils/combine-styles';

const root = tv({
  base: 'gap-3',
});

const item = tv({
  base: 'flex-row items-center justify-between gap-3',
});

export const radioGroupClassNames = combineStyles({
  root,
  item,
});
