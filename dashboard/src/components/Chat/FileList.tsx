// import { FileBubble } from '../ui/FileBubble/FileBubble';
import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../../zero/queries';

interface FileListProps {
  chatMessages: QueryResultType<typeof queries.channelConversations> | undefined;
}

const FileList: React.FC<FileListProps> = ({ chatMessages }) => {
  // Flatten attachments from all conversations
  const files =
    chatMessages
      ?.flatMap(conv => {
        const msg = conv.initialMessage as QueryResultType<
          typeof queries.conversationMessages
        >[number];

        if (!msg) return [];

        return (msg.attachments || []).map(att => ({
          message: msg,
          attachment: att,
        }));
      })
      .filter(item => !!item.attachment) ?? [];

  if (files.length === 0) {
    return (
      <div className='text-center text-gray-500 py-8 flex-1 flex flex-col items-center justify-center select-none bg-[#FFFFFF]'>
        <img
          src='/images/empty-attachments.png'
          alt='No files shared in this channel yet.'
          width={200}
          height={200}
        />
        <p className='text-gray-500'>No files shared in this channel yet.</p>
      </div>
    );
  }

  return (
    <div className='overflow-auto no-scrollbar p-4 space-y-3'>
      {/* {files.map((file, idx) => (
        <FileBubble
          key={`${file.attachment.id}-${idx}`}
          message={file.message}
          attachment={file.attachment}
        />
      ))} */}
    </div>
  );
};

export default FileList;
