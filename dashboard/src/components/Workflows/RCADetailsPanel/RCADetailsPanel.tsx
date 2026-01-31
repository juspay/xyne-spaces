import React from 'react';
import { AlertCircle, FileCode, GitCommit, Layers, Activity } from 'lucide-react';
import { Accordion, AccordionItem, AccordionType } from '@juspay/blend-design-system';
import { MermaidDiagram } from '../MermaidDiagram';

// API response fields use snake_case
/* eslint-disable @typescript-eslint/naming-convention */
export interface RCAItem {
  repo_name: string;
  module_name: string;
  function_name: string;
  code_snippet: string;
  reason: string;
  references: string[];
  mermaid_diagram?: string;
}
/* eslint-enable @typescript-eslint/naming-convention */

interface RCADetailsPanelProps {
  data: RCAItem[];
}

export const RCADetailsPanel: React.FC<RCADetailsPanelProps> = ({ data }) => {
  if (!data || data.length === 0) {
    return (
      <div className='h-full flex flex-col items-center justify-center text-gray-500 p-8 text-center'>
        <AlertCircle size={48} className='mb-4 text-gray-300' />
        <p className='text-lg font-medium text-gray-900'>No RCA Details Available</p>
        <p className='text-sm mt-2'>Select a completed Root Cause Analysis step to view details.</p>
      </div>
    );
  }

  return (
    <div className='h-full overflow-y-auto bg-white p-6'>
      <div className='mb-6'>
        <h2 className='text-xl font-semibold text-gray-900 flex items-center gap-2'>
          <Activity className='text-blue-600' />
          Root Cause Analysis
        </h2>
        <p className='text-sm text-gray-500 mt-1'>
          Analysis of potential root causes identified by the AI agent.
        </p>
      </div>

      <div className='flex-1 overflow-y-auto space-y-4'>
        <Accordion accordionType={AccordionType.BORDER} isMultiple={true} defaultValue={['rca-0']}>
          {data.map((item, index) => (
            <AccordionItem
              key={`rca-item-${item.repo_name}-${item.module_name}-${index}`}
              value={`rca-${index}`}
              title={`${(item.reason || 'Unknown reason').substring(0, 60)}${(item.reason || '').length > 60 ? '...' : ''}`}
              subtext={`${item.repo_name || 'Unknown repo'} • ${item.module_name || 'Unknown module'}`}
            >
              <div className='p-4 space-y-4 bg-gray-50/50'>
                {/* Location Info */}
                <div className='grid grid-cols-1 gap-3'>
                  <div className='bg-white p-3 rounded-md border border-gray-200 shadow-sm'>
                    <div className='flex items-center gap-2 mb-2 text-xs font-medium text-gray-500 uppercase tracking-wider'>
                      <Layers size={12} /> Location
                    </div>
                    <div className='space-y-1'>
                      <div className='flex items-start gap-2 text-sm'>
                        <span className='text-gray-500 min-w-[70px]'>Repo:</span>
                        <span className='font-mono text-gray-900 bg-gray-100 px-1 rounded'>
                          {item.repo_name}
                        </span>
                      </div>
                      <div className='flex items-start gap-2 text-sm'>
                        <span className='text-gray-500 min-w-[70px]'>Module:</span>
                        <span className='font-mono text-gray-900'>{item.module_name}</span>
                      </div>
                      <div className='flex items-start gap-2 text-sm'>
                        <span className='text-gray-500 min-w-[70px]'>Function:</span>
                        <span className='font-mono text-blue-600'>{item.function_name}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Reason */}
                <div className='bg-white p-3 rounded-md border border-gray-200 shadow-sm'>
                  <div className='flex items-center gap-2 mb-2 text-xs font-medium text-gray-500 uppercase tracking-wider'>
                    <AlertCircle size={12} /> Root Cause
                  </div>
                  <p className='text-sm text-gray-800 leading-relaxed'>{item.reason}</p>
                </div>

                {/* Mermaid Diagram */}
                {item.mermaid_diagram && (
                  <div className='bg-white p-3 rounded-md border border-gray-200 shadow-sm'>
                    <div className='flex items-center gap-2 mb-2 text-xs font-medium text-gray-500 uppercase tracking-wider'>
                      <Activity size={12} /> Visualization
                    </div>
                    <MermaidDiagram chart={item.mermaid_diagram} />
                  </div>
                )}

                {/* Code Snippet */}
                {item.code_snippet && (
                  <div className='bg-white rounded-md border border-gray-200 shadow-sm overflow-hidden'>
                    <div className='flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wider'>
                      <FileCode size={12} /> Code Snippet
                    </div>
                    <pre className='p-3 overflow-x-auto text-xs font-mono text-gray-800 bg-slate-50 leading-relaxed'>
                      {item.code_snippet}
                    </pre>
                  </div>
                )}

                {/* References */}
                {item.references && item.references.length > 0 && (
                  <div className='bg-white p-3 rounded-md border border-gray-200 shadow-sm'>
                    <div className='flex items-center gap-2 mb-2 text-xs font-medium text-gray-500 uppercase tracking-wider'>
                      <GitCommit size={12} /> References
                    </div>
                    <ul className='space-y-1'>
                      {item.references.map((ref, i) => (
                        <li key={i} className='text-sm text-gray-600 flex items-start gap-2'>
                          <span className='text-gray-400 mt-1'>•</span>
                          <span>{ref}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </div>
  );
};
