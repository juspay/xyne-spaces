import type { ReactElement } from 'react';
import { usePlatform } from '../../../../hooks/usePlatform';
import { GlassStar } from '../../../icons/xyne-ai';

interface XyneAISuggestionsProps {
  queries: string[];
  onSuggestionClick: (query: string) => void;
}

export const XyneAISuggestions = ({
  queries,
  onSuggestionClick,
}: XyneAISuggestionsProps): ReactElement => {
  const { isMobile } = usePlatform();

  return (
    <div className='flex flex-col items-center justify-center h-full px-4'>
      {/* Animated Glass Star */}
      <div className={`${isMobile ? 'mb-6' : 'mb-9'}`}>
        <GlassStar shouldRotate={true} />
      </div>

      {/* Heading */}
      <h2 className="text-center text-gray-900 text-[24px] leading-[24px] font-semibold font-['Inter'] mb-6 md:mb-9">
        Hey! What are we working
        <br />
        on today?
      </h2>

      {/* Suggestion Pills */}
      <div className='flex flex-wrap justify-center gap-2 max-w-md'>
        {queries.map((query, index) => (
          <button
            key={index}
            onClick={() => onSuggestionClick(query)}
            className="px-[12px] py-[6px] rounded-full border border-[#EBEDF0] hover:border-[#D9D9D9] hover:bg-gray-50 bg-white transition-colors text-gray-700 font-medium text-[12px] leading-[22px] font-['Inter']"
            data-track-category='XyneAI'
            data-track-name='SELECT_SUGGESTION'
            data-track-metadata={JSON.stringify({ suggestion: query })}
          >
            {query}
          </button>
        ))}
      </div>
    </div>
  );
};
