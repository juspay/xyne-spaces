import { useMemo, type CSSProperties, type ReactElement } from 'react';

import {
  orderedPalette,
  parseDesignTokens,
  type DesignTokens,
  type TokenColor,
} from './designTokens';

function pick(colors: TokenColor[], role: string, fallback: string): string {
  const match = colors.find(color => color.role === role);
  return match?.hex ?? match?.value ?? fallback;
}

function Swatch({ color }: { color: TokenColor }): ReactElement {
  return (
    <div className='min-w-0'>
      <div
        className='h-14 w-full rounded-md border border-border'
        style={{ backgroundColor: color.hex ?? color.value }}
        aria-hidden
      />
      <div className='mt-1.5 truncate text-[11px] font-medium text-foreground'>
        {color.role ?? color.token}
      </div>
      <div className='truncate font-mono text-[11px] text-muted-foreground'>
        {color.hex ?? color.value}
      </div>
    </div>
  );
}

function SampleComponents({ tokens }: { tokens: DesignTokens }): ReactElement {
  const colors = tokens.colors;
  const primary = pick(colors, 'primary', '#2563EB');
  const surface = pick(colors, 'surface', pick(colors, 'background', '#FFFFFF'));
  const text = pick(colors, 'text', '#0F172A');
  const border = pick(colors, 'border', '#E2E8F0');
  const radius = tokens.radii[0]?.value ?? '8px';
  const fontStack = tokens.fonts[0]?.stack ?? 'inherit';

  const frame: CSSProperties = {
    backgroundColor: surface,
    color: text,
    borderColor: border,
    borderRadius: radius,
    fontFamily: fontStack,
  };

  return (
    <div className='rounded-lg border border-border p-4' style={frame}>
      <div className='flex flex-wrap items-center gap-3'>
        <button
          type='button'
          style={{ backgroundColor: primary, borderRadius: radius, color: surface }}
          className='px-3 py-1.5 text-sm font-medium'
          data-track-category='XyneAI'
          data-track-name='DESIGN_SYSTEM_SPECIMEN_SAMPLE'
        >
          Primary action
        </button>
        <button
          type='button'
          style={{ borderColor: border, borderRadius: radius, color: text }}
          className='border px-3 py-1.5 text-sm'
          data-track-category='XyneAI'
          data-track-name='DESIGN_SYSTEM_SPECIMEN_SAMPLE'
        >
          Secondary
        </button>
      </div>

      <input
        readOnly
        value='Input field'
        aria-label='Specimen input'
        data-track-category='XyneAI'
        data-track-name='DESIGN_SYSTEM_SPECIMEN_SAMPLE'
        style={{ borderColor: border, borderRadius: radius, color: text, backgroundColor: surface }}
        className='mt-3 w-full border px-3 py-1.5 text-sm'
      />

      <div className='mt-3 border p-3' style={{ borderColor: border, borderRadius: radius }}>
        <div className='text-sm font-semibold'>Card title</div>
        <div className='mt-0.5 text-xs opacity-70'>
          Body copy set in the system&rsquo;s own typeface and scale.
        </div>
      </div>
    </div>
  );
}

export function SpecimenView({ tokensCss }: { tokensCss: string }): ReactElement {
  const tokens = useMemo(() => parseDesignTokens(tokensCss), [tokensCss]);
  const palette = useMemo(() => orderedPalette(tokens.colors), [tokens.colors]);

  if (tokens.isEmpty) {
    return (
      <p className='text-xs text-muted-foreground'>
        This system has no tokens.css, so there is nothing to preview. Its written rules still apply
        to runs that use it.
      </p>
    );
  }

  return (
    <div className='space-y-5'>
      {palette.length > 0 && (
        <section>
          <h3 className='text-xs font-medium text-muted-foreground'>Palette</h3>
          <div className='mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5'>
            {palette.slice(0, 10).map(color => (
              <Swatch key={color.token} color={color} />
            ))}
          </div>
        </section>
      )}

      {tokens.fonts.length > 0 && (
        <section>
          <h3 className='text-xs font-medium text-muted-foreground'>Typefaces</h3>
          <div className='mt-2 space-y-3'>
            {tokens.fonts.slice(0, 3).map(font => (
              <div key={font.token}>
                <div
                  className='truncate text-lg text-foreground'
                  style={{ fontFamily: font.stack }}
                >
                  {font.family}
                </div>
                <div
                  className='truncate text-xs text-muted-foreground'
                  style={{ fontFamily: font.stack }}
                >
                  The quick brown fox jumps over the lazy dog
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {tokens.typeSteps.length > 0 && (
        <section>
          <h3 className='text-xs font-medium text-muted-foreground'>Type scale</h3>
          <div className='mt-2 flex flex-wrap gap-1.5'>
            {tokens.typeSteps.slice(0, 10).map(step => (
              <span
                key={step.token}
                className='rounded bg-secondary/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground'
              >
                {step.token}: {step.value}
              </span>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className='text-xs font-medium text-muted-foreground'>Components</h3>
        <div className='mt-2'>
          <SampleComponents tokens={tokens} />
        </div>
      </section>
    </div>
  );
}
