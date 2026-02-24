import { useEffect, useRef, useState, useCallback } from 'react';
import type {
  BlockNoteEditor,
  BlockSchema,
  InlineContentSchema,
  StyleSchema,
} from '@blocknote/core';
import {
  findMatches,
  applyHighlights,
  removeHighlights,
  scrollToMatch,
  type SearchMatch,
} from '../../../utils/searchUtils';

interface CanvasSearchProps {
  editor: BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  isOpen: boolean;
  onClose: () => void;
}

export const CanvasSearch = ({ editor, containerRef, isOpen, onClose }: CanvasSearchProps) => {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      removeHighlights(containerRef.current);
      setQuery('');
      setMatches([]);
      setCurrentIndex(0);
    }
  }, [isOpen, containerRef]);

  useEffect(() => {
    if (!query.trim()) {
      removeHighlights(containerRef.current);
      setMatches([]);
      setCurrentIndex(0);
      return;
    }

    const newMatches = findMatches(editor, query);
    setMatches(newMatches);
    setCurrentIndex(0);

    if (newMatches.length > 0) {
      applyHighlights(containerRef.current, newMatches, 0);
      const firstMatch = newMatches[0];
      if (firstMatch) {
        scrollToMatch(containerRef.current, firstMatch);
      }
    } else {
      removeHighlights(containerRef.current);
    }
  }, [query, editor, containerRef]);

  const goToNext = useCallback(() => {
    if (matches.length === 0) return;
    const nextIndex = (currentIndex + 1) % matches.length;
    setCurrentIndex(nextIndex);
    applyHighlights(containerRef.current, matches, nextIndex);
    const match = matches[nextIndex];
    if (match) {
      scrollToMatch(containerRef.current, match);
    }
  }, [matches, currentIndex, containerRef]);

  const goToPrevious = useCallback(() => {
    if (matches.length === 0) return;
    const prevIndex = (currentIndex - 1 + matches.length) % matches.length;
    setCurrentIndex(prevIndex);
    applyHighlights(containerRef.current, matches, prevIndex);
    const match = matches[prevIndex];
    if (match) {
      scrollToMatch(containerRef.current, match);
    }
  }, [matches, currentIndex, containerRef]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          goToPrevious();
        } else {
          goToNext();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [goToNext, goToPrevious, onClose],
  );

  if (!isOpen) return null;

  return (
    <div className='absolute top-4 right-4 z-50 bg-white rounded-lg shadow-lg border border-gray-200 p-2 flex items-center gap-2 min-w-[300px]'>
      <div className='relative flex-1'>
        <input
          ref={inputRef}
          type='text'
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder='Search in canvas...'
          className='w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'
          data-track-event='blur'
          data-track-category='CANVAS'
          data-track-name='Canvas_Search_Input'
        />
      </div>

      {matches.length > 0 && (
        <div className='flex items-center gap-1 text-xs text-gray-600'>
          <button
            onClick={goToPrevious}
            className='p-1 hover:bg-gray-100 rounded disabled:opacity-50 disabled:cursor-not-allowed'
            disabled={matches.length === 0}
            aria-label='Previous match'
            data-track-category='CANVAS'
            data-track-name='Search_Previous_Match'
            data-track-metadata={JSON.stringify({
              query,
              currentIndex,
              totalMatches: matches.length,
            })}
          >
            <svg
              xmlns='http://www.w3.org/2000/svg'
              width='16'
              height='16'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
              strokeLinecap='round'
              strokeLinejoin='round'
            >
              <polyline points='15 18 9 12 15 6'></polyline>
            </svg>
          </button>

          <span className='px-1'>
            {currentIndex + 1}/{matches.length}
          </span>

          <button
            onClick={goToNext}
            className='p-1 hover:bg-gray-100 rounded disabled:opacity-50 disabled:cursor-not-allowed'
            disabled={matches.length === 0}
            aria-label='Next match'
            data-track-category='CANVAS'
            data-track-name='Search_Next_Match'
            data-track-metadata={JSON.stringify({
              query,
              currentIndex,
              totalMatches: matches.length,
            })}
          >
            <svg
              xmlns='http://www.w3.org/2000/svg'
              width='16'
              height='16'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
              strokeLinecap='round'
              strokeLinejoin='round'
            >
              <polyline points='9 18 15 12 9 6'></polyline>
            </svg>
          </button>
        </div>
      )}

      <button
        onClick={onClose}
        className='p-1 hover:bg-gray-100 rounded text-gray-500 hover:text-gray-700'
        aria-label='Close search'
        data-track-category='CANVAS'
        data-track-name='Close_Canvas_Search'
        data-track-metadata={JSON.stringify({ query })}
      >
        <svg
          xmlns='http://www.w3.org/2000/svg'
          width='16'
          height='16'
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'
        >
          <line x1='18' y1='6' x2='6' y2='18'></line>
          <line x1='6' y1='6' x2='18' y2='18'></line>
        </svg>
      </button>
    </div>
  );
};
