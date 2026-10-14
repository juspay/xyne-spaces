import type { DeskListItemData } from '../types';

export type MapDeskListItemInput = {
  id: string;
  name?: string | null;
  type?: string | null;
  description?: string | null | undefined;
  isJoined: boolean;
};

export function mapDeskListItem(input: MapDeskListItemInput): DeskListItemData {
  const description = (input.description ?? '').trim();

  return {
    id: input.id,
    name: (input.name ?? '').trim() || input.id,
    isJoined: input.isJoined,
    type: input.type ?? 'EMAIL',
    description: description.length > 0 ? description : null,
  };
}
