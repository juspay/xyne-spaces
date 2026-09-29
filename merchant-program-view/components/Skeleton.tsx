import type { CSSProperties } from 'react';

/** Placeholder layout of the portfolio (KPIs, age bar, tabs, filters, table) shown until tickets arrive. */

const Bar = ({ w, h = 12, style }: { w: number | string; h?: number; style?: CSSProperties }) => <span className="sk" style={{ display: 'block', width: w, height: h, ...style }} />;

const COLS = '84px minmax(120px,1.25fr) 64px 136px 100px minmax(170px,2.2fr) 150px 82px';
const ROW_WIDTHS = ['62%', '48%', '70%', '55%', '66%', '44%', '58%', '52%'];

export function PortfolioSkeleton({ note }: { note: string | null }) {
  return (
    <div aria-busy="true" aria-label="Loading tickets" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} style={{ border: '1px solid var(--bd)', borderRadius: 8, padding: '14px 16px 13px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Bar w="55%" h={11} />
            <Bar w="40%" h={22} />
            <Bar w="75%" h={10} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Bar w={130} h={13} />
        <Bar w="100%" h={12} style={{ borderRadius: 3 }} />
        <div style={{ display: 'flex', gap: 18 }}>
          {Array.from({ length: 5 }, (_, i) => (
            <Bar key={i} w={58} h={10} />
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, borderBottom: '1px solid var(--bd)', paddingBottom: 8, flexWrap: 'wrap' }}>
        <Bar w={110} h={16} />
        <Bar w={90} h={16} />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {[72, 76, 92, 76].map((w, i) => (
            <Bar key={i} w={w} h={32} style={{ borderRadius: 6 }} />
          ))}
        </div>
      </div>
      <div style={{ border: '1px solid var(--bd)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ height: 38, background: 'var(--bg3)', borderBottom: '1px solid var(--bd)' }} />
        {ROW_WIDTHS.map((w, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, alignItems: 'center', padding: '16px 16px', borderBottom: i < ROW_WIDTHS.length - 1 ? '1px solid var(--bd2)' : 'none', overflow: 'hidden' }}>
            <Bar w={62} h={20} style={{ borderRadius: 999 }} />
            <Bar w={w} />
            <Bar w={22} />
            <Bar w={120} h={8} />
            <Bar w={40} />
            <Bar w="50%" h={18} />
            <Bar w="70%" />
            <Bar w={48} />
          </div>
        ))}
      </div>
      {note && <p style={{ margin: 0, textAlign: 'center', fontSize: 12.5, color: 'var(--t4)' }}>{note}</p>}
    </div>
  );
}
