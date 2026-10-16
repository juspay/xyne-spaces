import { Fragment, type ReactElement } from 'react';
import { Alert } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as FileSystem from 'expo-file-system/legacy';
import { AppWindow, ExternalLink, FileText } from 'lucide-react-native';

import { shareOrSaveAttachment } from '@/src/components/attachments-viewer/utils/saveAttachment';
import { ListRow, ListRowDivider, SectionCard } from '@/src/components/ui/settings-list';
import { API_BASE_URL, DASHBOARD_ORIGIN } from '@/src/config';
import type { BriefCitation } from '@/src/features/morning-brief/api/dailyBriefApi';
import { cacheMtlsRemoteFile } from '@/src/utils/mtlsDiskCache';

import type { TurnAttachment } from '../api/xyneAIEvents';
import type { AssistantTurn } from '../model/assistantTurn';
import { createdCanvases, openUrlTargets } from '../model/turnOutputs';

const CACHE_ROOT = `${FileSystem.cacheDirectory}attachments/xyne-ai`;

const cacheKey = ({ id, data, filename }: TurnAttachment): string =>
  id ?? `${filename}-${data?.length}`;

// Stored files are fetched by id; a just-streamed one arrives as base64 and is written once.
async function localUri(attachment: TurnAttachment): Promise<string> {
  const { id, data, filename } = attachment;
  const directory = `${CACHE_ROOT}/${encodeURIComponent(cacheKey(attachment))}`;
  const path = `${directory}/${filename.replace(/[\\/]/g, '_')}`;
  if (id) {
    const url = `${API_BASE_URL}/xyne-ai/v2/attachments/${encodeURIComponent(id)}/download`;
    return cacheMtlsRemoteFile({ url, localPath: path });
  }
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  await FileSystem.writeAsStringAsync(path, data ?? '', {
    encoding: FileSystem.EncodingType.Base64,
  });
  return path;
}

const Thumbnail = ({ attachment }: { attachment: TurnAttachment }): ReactElement | undefined => {
  const { data: uri } = useQuery({
    queryKey: ['xyne-ai', 'attachment', cacheKey(attachment)],
    queryFn: () => localUri(attachment),
    staleTime: Infinity,
  });
  return uri ? (
    <Image source={{ uri }} style={{ width: 36, height: 36, borderRadius: 6 }} contentFit='cover' />
  ) : undefined;
};

const AttachmentRow = ({ attachment }: { attachment: TurnAttachment }): ReactElement => (
  <ListRow
    {...(attachment.mimeType.startsWith('image/')
      ? { leading: <Thumbnail attachment={attachment} /> }
      : { icon: FileText })}
    label={attachment.filename}
    description={attachment.mimeType}
    onPress={(): void => {
      localUri(attachment)
        .then(uri => shareOrSaveAttachment(uri, attachment.filename, attachment.mimeType))
        .catch(() => Alert.alert('Could not open file', 'Please try again.'));
    }}
  />
);

/** What the answer produced: generated apps, canvases, pages to open, and files. */
export const TurnOutputs = ({
  turn: { attachments, tools },
  onOpenUrl,
  onOpenCanvas,
}: {
  turn: Pick<AssistantTurn, 'attachments' | 'tools'>;
  onOpenUrl: (url: string) => void;
  onOpenCanvas: (canvas: BriefCitation) => void;
}): ReactElement | null => {
  const rows = [
    ...attachments.flatMap(({ app }) =>
      app
        ? [
            <ListRow
              key={`app-${app.id}`}
              icon={AppWindow}
              label={app.title}
              description='App'
              showChevron
              onPress={(): void => onOpenUrl(`${DASHBOARD_ORIGIN}/app/${app.id}`)}
            />,
          ]
        : [],
    ),
    ...createdCanvases(tools).map(canvas => (
      <ListRow
        key={`canvas-${canvas.viewAccessId ?? canvas.canvasId}`}
        icon={FileText}
        label={canvas.label ?? 'Canvas'}
        description='Canvas'
        showChevron
        onPress={(): void => onOpenCanvas(canvas)}
      />
    )),
    ...openUrlTargets(tools).map(url => (
      <ListRow
        key={url}
        icon={ExternalLink}
        label={/^https?:\/\/([^/?#]+)/i.exec(url)?.[1] ?? url}
        description='Open link'
        showChevron
        onPress={(): void => onOpenUrl(url)}
      />
    )),
    ...attachments.flatMap(attachment =>
      attachment.app
        ? []
        : [<AttachmentRow key={attachment.id ?? attachment.filename} attachment={attachment} />],
    ),
  ];

  return rows.length > 0 ? (
    <SectionCard>
      {rows.map((row, index) => (
        <Fragment key={row.key}>
          {index > 0 ? <ListRowDivider /> : null}
          {row}
        </Fragment>
      ))}
    </SectionCard>
  ) : null;
};
