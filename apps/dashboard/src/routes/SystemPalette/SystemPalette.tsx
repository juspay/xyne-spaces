import { ReactElement, useEffect, useState } from 'react';
import { useTheme, Theme } from '../../hooks/useTheme';
import { cn } from '../../utils/classNames';
import { CHECKERBOARD_STYLE, toCssColor } from './colorUtils';
import { TOKEN_GROUPS } from './tokenGroups';

const THEMES: Theme[] = ['classic', 'summer_breeze', 'midnight'];

const readTokenValues = (): Record<string, string> => {
  const style = getComputedStyle(document.documentElement);
  const values: Record<string, string> = {};
  for (const group of TOKEN_GROUPS) {
    for (const token of group.tokens) {
      values[token] = style.getPropertyValue(token).trim();
    }
  }
  return values;
};

const SystemPalette = (): ReactElement => {
  const { theme, changeTheme } = useTheme();
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    setValues(readTokenValues());
  }, [theme]);

  return (
    <div className='min-h-screen bg-background px-6 py-8 text-foreground'>
      <div className='mx-auto flex max-w-[1400px] flex-col gap-6'>
        <header className='flex flex-wrap items-center justify-between gap-4'>
          <div>
            <h1 className='text-xl font-semibold'>Design Token Palette</h1>
            <p className='mt-1 text-sm text-muted-foreground'>
              Every CSS custom property declared in global.css, read live from{' '}
              <code className='select-text'>getComputedStyle</code> for the active theme.
            </p>
          </div>
          <div className='flex gap-2'>
            {THEMES.map(t => (
              <button
                key={t}
                type='button'
                onClick={() => changeTheme(t)}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-sm font-medium capitalize transition-colors',
                  theme === t
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground',
                )}
                data-testid={`system-theme-btn-${t}`}
                data-track-category='SystemPalette'
                data-track-name='SelectTheme'
              >
                {t.replace('_', ' ')}
              </button>
            ))}
          </div>
        </header>

        <div className='flex flex-wrap items-center gap-4 text-xs text-muted-foreground'>
          <Legend swatch={<div className='size-4 rounded border border-border bg-foreground' />}>
            colour
          </Legend>
          <Legend swatch={<div className='size-4 rounded border border-border bg-muted' />}>
            non-colour value
          </Legend>
          <Legend swatch={<div className='size-4 rounded border border-dashed border-border' />}>
            not defined in this theme
          </Legend>
        </div>

        <div className='grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'>
          {TOKEN_GROUPS.map(group => (
            <section key={group.label} className='rounded-lg border border-border bg-card p-4'>
              <h2 className='mb-3 flex items-center justify-between text-sm font-semibold'>
                <span>{group.label}</span>
                <span className='text-xs font-normal text-muted-foreground'>
                  {group.tokens.length}
                </span>
              </h2>
              <div className='flex flex-col gap-1'>
                {group.tokens.map(token => (
                  <TokenRow key={token} name={token} raw={values[token]} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
};

const Legend = ({
  swatch,
  children,
}: {
  swatch: ReactElement;
  children: ReactElement | string;
}): ReactElement => (
  <div className='flex items-center gap-1.5'>
    {swatch}
    <span>{children}</span>
  </div>
);

const TokenRow = ({ name, raw }: { name: string; raw: string | undefined }): ReactElement => {
  const value = (raw ?? '').trim();
  const isMissing = value === '';
  const color = isMissing ? null : toCssColor(value);

  return (
    <div className='flex items-center gap-3 rounded-md border border-transparent px-2 py-1.5 hover:border-border'>
      <div
        className='relative size-9 shrink-0 overflow-hidden rounded-md border border-border'
        style={color ? CHECKERBOARD_STYLE : undefined}
      >
        {color && <div className='absolute inset-0' style={{ backgroundColor: color }} />}
        {!isMissing && !color && (
          <div className='flex h-full w-full items-center justify-center bg-muted text-[10px] text-muted-foreground'>
            n/c
          </div>
        )}
        {isMissing && (
          <div className='h-full w-full rounded-md border border-dashed border-border' />
        )}
      </div>
      <div className='min-w-0 flex-1'>
        <code className='block select-text truncate text-xs font-medium text-foreground'>
          {name}
        </code>
        {isMissing ? (
          <p className='truncate text-xs italic text-muted-foreground'>not defined in theme</p>
        ) : (
          <code className='block select-text truncate text-xs text-muted-foreground'>
            {value}
            {color && color !== value ? ` → ${color}` : ''}
          </code>
        )}
      </div>
    </div>
  );
};

export default SystemPalette;
