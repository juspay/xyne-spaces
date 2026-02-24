import { Check, ChevronDown } from 'lucide-react';
import React, { JSX, useEffect, useRef, useState } from 'react';
import { usePlatform } from '../../../hooks/usePlatform';
import { cn } from '../../../utils/classNames';

interface DeviceSelectorProps {
  devices: MediaDeviceInfo[];
  currentDeviceId: string | null;
  onDeviceChange: (deviceId: string) => void;
  icon: React.ElementType;
  label: string;
  iconSize?: number;
  buttonPadding?: number;
}

export function DeviceSelector({
  devices,
  currentDeviceId,
  onDeviceChange,
  icon,
  label,
  iconSize = 20,
  buttonPadding = 16,
}: DeviceSelectorProps): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const [showDeviceList, setShowDeviceList] = useState(false);
  const { isMobile } = usePlatform();
  const ref = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect((): (() => void) => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsOpen(false);
        setShowDeviceList(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentDevice = devices.find(d => d.deviceId === currentDeviceId);

  // Determine if custom sizing is being used
  const hasCustomSizing = iconSize !== 20 || buttonPadding !== 16;
  const buttonClasses = cn(
    'flex-1 px-4 py-3 text-left text-sm rounded-full border flex items-center gap-2.5 transition-colors min-w-[140px] sm:min-w-[160px]',
    hasCustomSizing && 'text-xs',
  );

  if (isMobile) {
    return (
      <div className='relative max-w-xs md:max-w-auto' ref={ref}>
        {/* Compact row showing current device */}
        <button
          onClick={() => setShowDeviceList(!showDeviceList)}
          className='transition-colors w-full cursor-pointer px-2 text-left '
          data-track-category='CALLS'
          data-track-name='Toggle_Device_Selector'
          data-track-metadata={JSON.stringify({ deviceType: label })}
        >
          <div className='flex items-center px-3 py-2 gap-3 hover:bg-gray-700 rounded-lg'>
            {icon &&
              React.createElement(icon, { className: 'w-4 h-4 flex-shrink-0 text-gray-400' })}
            <div className='flex-1 min-w-0'>
              <div className='text-xs text-gray-400 mb-0.5'>{label}</div>
              <div className='text-sm text-white truncate'>
                {currentDevice?.label || `No ${label.toLowerCase()}`}
              </div>
            </div>
            <ChevronDown
              className={cn(
                'w-4 h-4 text-gray-400 transition-transform duration-300',
                showDeviceList && 'rotate-180',
              )}
            />
          </div>
        </button>
        {/* Expandable device list - now with smooth height transition */}
        <div
          className={cn(
            'overflow-hidden transition-all duration-300 ease-in-out',
            showDeviceList ? 'max-h-[200px] opacity-100' : 'max-h-0 opacity-0',
          )}
        >
          <div className='bg-gray-800/50 rounded-lg mx-2 '>
            <div className='max-h-[200px] overflow-y-auto p-1.5'>
              {devices.length > 0 ? (
                devices.map(device => (
                  <button
                    key={device.deviceId}
                    onClick={() => {
                      onDeviceChange(device.deviceId);
                      setShowDeviceList(false);
                    }}
                    className='w-full px-4 py-2.5 rounded-lg text-left text-sm hover:bg-gray-700 flex items-center justify-between transition-colors'
                    data-track-category='CALLS'
                    data-track-name='SelectMobileDevice'
                    data-track-metadata={JSON.stringify({
                      deviceType: label,
                      deviceLabel: device.label,
                    })}
                  >
                    <span className='truncate pr-2 text-white'>{device.label || label}</span>
                    {device.deviceId === currentDeviceId && (
                      <Check className='w-4 h-4 text-blue-500 flex-shrink-0' />
                    )}
                  </button>
                ))
              ) : (
                <div className='px-4 py-2 text-sm text-gray-500'>
                  No {label.toLowerCase()}s found
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className='relative' ref={ref}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={buttonClasses}
        style={hasCustomSizing ? { padding: `${buttonPadding}px` } : undefined}
        title={`Select ${label.toLowerCase()}`}
        data-track-category='CALLS'
        data-track-name='Toggle_Device_Dropdown'
        data-track-metadata={JSON.stringify({ deviceType: label })}
      >
        {icon && React.createElement(icon, { className: 'w-4 h-4 flex-shrink-0 text-white' })}
        <div className='flex-1  min-w-0'>
          <div className='truncate text-xs font-medium text-white'>
            {currentDevice?.label || `No ${label.toLowerCase()} selected`}
          </div>
        </div>
        <ChevronDown
          className={cn(
            'w-3.5 h-3.5 flex-shrink-0 transition-transform text-white',
            isOpen && 'rotate-180',
          )}
        />
      </button>

      {isOpen && (
        <div className='absolute bottom-full mb-4 left-0 bg-gray-800 rounded-xl shadow-xl border border-gray-700 min-w-[250px] sm:min-w-[280px] max-h-[300px] overflow-y-auto z-50'>
          <div className='py-1'>
            {devices.length > 0 ? (
              devices.map(device => (
                <button
                  key={device.deviceId}
                  onClick={() => {
                    onDeviceChange(device.deviceId);
                    setIsOpen(false);
                  }}
                  className='w-full px-4 py-2.5 text-left text-sm hover:bg-gray-700 flex items-center justify-between transition-colors'
                  data-track-category='CALLS'
                  data-track-name='Select_Device'
                  data-track-metadata={JSON.stringify({
                    deviceType: label,
                    deviceLabel: device.label,
                  })}
                >
                  <span className='truncate pr-2 text-white'>{device.label || label}</span>
                  {device.deviceId === currentDeviceId && (
                    <Check className='w-4 h-4 text-blue-500 flex-shrink-0' />
                  )}
                </button>
              ))
            ) : (
              <div className='px-4 py-2 text-sm text-gray-500'>No {label.toLowerCase()}s found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
