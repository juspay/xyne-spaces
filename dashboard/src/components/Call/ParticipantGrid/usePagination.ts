import { useMemo, useState } from 'react';
import type { ParticipantInfo } from '../../../machines/roomMachine';

export interface PaginationState {
  currentPage: number;
  totalPageCount: number;
  tracks: ParticipantInfo[];
  nextPage: () => void;
  prevPage: () => void;
  setPage: (page: number) => void;
}

export function usePagination(
  maxItemsPerPage: number,
  participants: ParticipantInfo[],
): PaginationState {
  const [currentPage, setCurrentPage] = useState(0);

  const totalPageCount = Math.ceil(participants.length / maxItemsPerPage);

  const tracks = useMemo(() => {
    const startIndex = currentPage * maxItemsPerPage;
    const endIndex = startIndex + maxItemsPerPage;
    return participants.slice(startIndex, endIndex);
  }, [participants, currentPage, maxItemsPerPage]);

  const nextPage = (): void => {
    setCurrentPage(prev => Math.min(prev + 1, totalPageCount - 1));
  };

  const prevPage = (): void => {
    setCurrentPage(prev => Math.max(prev - 1, 0));
  };

  const setPage = (page: number): void => {
    setCurrentPage(Math.max(0, Math.min(page, totalPageCount - 1)));
  };

  return {
    currentPage,
    totalPageCount,
    tracks,
    nextPage,
    prevPage,
    setPage,
  };
}
