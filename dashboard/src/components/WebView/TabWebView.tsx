import { ReactElement, useRef } from 'react';
import { TabType } from '../../machines/webviewMachine';

// Extend HTMLElement to include Electron webview properties
interface ElectronWebviewElement extends HTMLElement {
  src: string;
  setZoomFactor?: (factor: number) => void;
}

interface TabWebViewProps {
  tab: TabType;
  isActive: boolean;
}

const TabWebView = ({ tab, isActive }: TabWebViewProps): ReactElement => {
  const webviewRef = useRef<ElectronWebviewElement | null>(null);

  // Extract domain from URL for display
  // const getDomainFromUrl = (url: string): string => {
  //   try {
  //     const urlObj = new URL(url);
  //     return urlObj.hostname;
  //   } catch {
  //     return url;
  //   }
  // };

  return (
    <div className={`flex flex-col h-full w-full bg-background ${isActive ? 'block' : 'hidden'}`}>
      {/* Header */}
      {/* <div className='flex items-center justify-between px-4 py-3 border-b border-border bg-muted'>
        <div className='flex items-center gap-2'>
          <span className='text-lg'>🌐</span>
          <div className='flex flex-col'>
            <h3 className='text-sm font-semibold text-foreground'>
              {getDomainFromUrl(tab.currentUrl)}
            </h3>
            <span className='text-xs text-muted-foreground'>{tab.currentUrl}</span>
          </div>
        </div>
      </div> */}

      {/* Webview */}
      <div className='flex-1 relative'>
        <webview
          ref={el => {
            if (el) {
              webviewRef.current = el as ElectronWebviewElement;
            }
          }}
          src={tab.currentUrl}
          className='w-full h-full border-0'
        />
      </div>
    </div>
  );
};

export default TabWebView;
