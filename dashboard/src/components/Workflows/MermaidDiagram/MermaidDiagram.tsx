import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'strict',
  fontFamily: 'Inter, sans-serif',
  suppressErrorRendering: true,
});

interface MermaidDiagramProps {
  chart: string;
}

export const MermaidDiagram: React.FC<MermaidDiagramProps> = ({ chart }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const renderChart = async (): Promise<void> => {
      if (!chart) return;

      try {
        setError(null);
        // Validate syntax first
        await mermaid.parse(chart);

        const id = `mermaid-${Math.random().toString(36).substring(2, 11)}`;
        const { svg } = await mermaid.render(id, chart);
        setSvg(svg);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Mermaid rendering error:', err);
        setError('Failed to render diagram');
      }
    };

    void renderChart();
  }, [chart]);

  if (error) {
    return (
      <div className='p-4 bg-red-50 text-red-600 rounded-lg text-sm border border-red-100'>
        {error}
        <pre className='mt-2 text-xs overflow-auto'>{chart}</pre>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className='mermaid-diagram overflow-auto p-4 bg-background rounded-lg flex justify-center'
      // eslint-disable-next-line @typescript-eslint/naming-convention
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};
