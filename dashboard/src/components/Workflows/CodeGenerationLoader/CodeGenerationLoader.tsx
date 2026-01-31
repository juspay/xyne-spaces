/**
 * CodeGenerationLoader - Dynamic code generation animation loader
 * Displays animated code lines while workflow is in progress
 */
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface CodeSegment {
  w: number;
  c: string;
  dot?: boolean;
}

interface CodePattern {
  indent: number;
  segments: CodeSegment[];
}

const statusMessages = ['Initializing Local Minimax Model...'];
const cloningMessages = ['Initializing Local Minimax Model...'];

const codePatterns: CodePattern[] = [
  {
    indent: 0,
    segments: [
      { w: 50, c: '#3f3f46' },
      { w: 70, c: '#52525b' },
    ],
  },
  {
    indent: 1,
    segments: [
      { w: 35, c: '#71717a' },
      { w: 90, c: '#3f3f46' },
    ],
  },
  {
    indent: 2,
    segments: [
      { w: 45, c: '#52525b' },
      { w: 40, c: '#10b981' },
      { w: 60, c: '#3f3f46' },
    ],
  },
  {
    indent: 2,
    segments: [
      { w: 30, c: '#3b82f6' },
      { w: 80, c: '#52525b' },
    ],
  },
  { indent: 2, segments: [{ w: 8, dot: true, c: '#71717a' }] },
  { indent: 1, segments: [{ w: 25, c: '#3f3f46' }] },
  {
    indent: 1,
    segments: [
      { w: 50, c: '#f59e0b' },
      { w: 55, c: '#52525b' },
      { w: 8, dot: true, c: '#71717a' },
    ],
  },
  {
    indent: 2,
    segments: [
      { w: 40, c: '#3f3f46' },
      { w: 45, c: '#10b981' },
      { w: 70, c: '#52525b' },
    ],
  },
  {
    indent: 2,
    segments: [
      { w: 60, c: '#3b82f6' },
      { w: 35, c: '#3f3f46' },
    ],
  },
  {
    indent: 2,
    segments: [
      { w: 8, dot: true, c: '#52525b' },
      { w: 8, dot: true, c: '#71717a' },
    ],
  },
  { indent: 1, segments: [{ w: 20, c: '#71717a' }] },
  { indent: 0, segments: [{ w: 15, c: '#3f3f46' }] },
];

interface CodeGenerationLoaderProps {
  isCancelled?: boolean;
  isCloning?: boolean;
  isFailed?: boolean;
  errorMessage?: string;
}

export const CodeGenerationLoader: React.FC<CodeGenerationLoaderProps> = ({
  isCancelled = false,
  isCloning = false,
  isFailed = false,
  errorMessage,
}) => {
  const [lines, setLines] = useState<number[]>([0, 1, 2, 3, 4, 5, 6, 7]);
  const [currentStatusIndex, setCurrentStatusIndex] = useState(0);

  // Use cloning messages if cloning is in progress
  const messages = isCloning ? cloningMessages : statusMessages;

  useEffect(() => {
    if (isCancelled || isFailed) return;
    const interval = setInterval(() => {
      setLines(prev => prev.map(l => (l + 1) % 12));
    }, 1500);
    return (): void => clearInterval(interval);
  }, [isCancelled, isFailed]);

  useEffect(() => {
    if (isCancelled || isFailed) return;
    const statusInterval = setInterval(() => {
      setCurrentStatusIndex(prev => (prev + 1) % messages.length);
    }, 2000);
    return (): void => clearInterval(statusInterval);
  }, [isCancelled, isFailed, messages.length]);

  if (isCancelled) return null;

  // Show error state when workflow has failed
  if (isFailed) {
    return (
      <div className='flex items-center justify-center min-h-screen bg-white'>
        <div className='relative bg-white rounded-2xl overflow-hidden shadow-lg w-full max-w-md p-6'>
          <div className='flex flex-col items-center text-center'>
            <div className='w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-4'>
              <svg
                className='w-8 h-8 text-red-500'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z'
                />
              </svg>
            </div>
            <h3 className='text-lg font-semibold text-gray-900 mb-2'>Workflow Failed</h3>
            {errorMessage && (
              <div className='max-h-48 overflow-y-auto w-full'>
                <p className='text-sm text-gray-600 bg-gray-50 rounded-lg p-3 font-mono text-left whitespace-pre-wrap break-all'>
                  {errorMessage}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className='flex items-center justify-center min-h-screen bg-white'>
      <motion.div
        className='relative bg-white rounded-2xl overflow-hidden shadow-2xl w-full max-w-sm mb-32'
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{
          opacity: 1,
          scale: [1, 1.01, 1],
        }}
        transition={{
          opacity: { duration: 1 },
          scale: {
            duration: 3,
            repeat: Infinity,
            ease: 'easeInOut',
          },
        }}
      >
        {/* Window Header */}
        <div className='flex items-center gap-2 px-4 py-3'>
          <AnimatePresence mode='wait'>
            <motion.span
              key={currentStatusIndex}
              className='text-sm font-medium text-zinc-700'
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{
                duration: 0.3,
                ease: 'easeInOut',
              }}
            >
              {messages[currentStatusIndex]}
            </motion.span>
          </AnimatePresence>
        </div>

        {/* Code Lines */}
        <div className='p-5 space-y-2.5'>
          {lines.map((lineIdx, i) => {
            const pattern = codePatterns[lineIdx];
            if (!pattern) return null;
            return (
              <motion.div
                key={`${i}-${lineIdx}`}
                className='flex items-center gap-1.5 h-2'
                style={{ paddingLeft: pattern.indent * 14 }}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{
                  duration: 0.5,
                  delay: i * 0.08,
                  ease: 'easeOut',
                }}
              >
                {pattern.segments.map((seg, j) => (
                  <motion.div
                    key={j}
                    style={{
                      width: seg.w,
                      height: seg.dot ? 6 : 6,
                      backgroundColor: seg.c,
                      borderRadius: seg.dot ? 999 : 3,
                    }}
                    animate={{ opacity: [0.25, 0.75, 0.25] }}
                    transition={{
                      duration: 2.5,
                      repeat: Infinity,
                      delay: j * 0.15 + i * 0.12,
                      ease: 'easeInOut',
                    }}
                  />
                ))}
              </motion.div>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
};

export default CodeGenerationLoader;
