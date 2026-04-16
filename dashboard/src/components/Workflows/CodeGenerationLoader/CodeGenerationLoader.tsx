import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

const STATUS = ['Generating...'];

export const CodeGenerationLoader = ({
  isCancelled,
  isFailed,
  errorMessage,
}: {
  isCancelled?: boolean;
  isFailed?: boolean;
  errorMessage?: string;
}) => {
  const [offset, setOffset] = useState(0);
  const [statusIdx, setStatusIdx] = useState(0);

  useEffect(() => {
    if (isCancelled || isFailed) return;
    const t = setInterval(() => setOffset(o => o + 1), 1200);
    const s = setInterval(() => setStatusIdx(i => (i + 1) % STATUS.length), 2500);
    return () => {
      clearInterval(t);
      clearInterval(s);
    };
  }, [isCancelled, isFailed]);

  if (isCancelled) return null;

  if (isFailed) {
    return (
      <div className='flex items-center justify-center min-h-screen bg-background'>
        <div className='text-center'>
          <div className='w-8 h-8 mx-auto mb-3 rounded-full bg-red-50 flex items-center justify-center'>
            <div className='w-1.5 h-1.5 rounded-full bg-red-400' />
          </div>
          <p className='text-zinc-500 text-sm'>Failed</p>
          {errorMessage && <p className='text-zinc-400 text-xs mt-1 max-w-xs'>{errorMessage}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className='flex items-center justify-center min-h-screen bg-background'>
      <div className='text-center'>
        <motion.p
          key={statusIdx}
          className='text-foreground text-xs mb-4 font-medium tracking-wide'
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          {STATUS[statusIdx]}
        </motion.p>
        <div className='flex flex-col items-start gap-1.5'>
          {Array.from({ length: 5 }).map((_, i) => {
            const seed = (offset + i) * 7;
            const widths = [35 + (seed % 30), 20 + ((seed * 3) % 25)].filter(Boolean);

            return (
              <div key={`${offset}-${i}`} className='flex items-center gap-1'>
                {widths.map((w, j) => (
                  <motion.div
                    key={j}
                    className='h-1 rounded-full bg-border'
                    style={{ width: w }}
                    animate={{ opacity: [0.4, 1, 0.4] }}
                    transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.1 + j * 0.15 }}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default CodeGenerationLoader;
