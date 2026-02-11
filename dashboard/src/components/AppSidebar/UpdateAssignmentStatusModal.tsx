import React, { useState, useEffect } from 'react';
import * as Select from '@radix-ui/react-select';
import { Check, ChevronDown, X } from 'lucide-react';
import { useZero } from '../../hooks/useZero';
import { Dialog } from '../ui/Dialog/Dialog';
import { Button } from '../ui/Button/Button';
import Input from '../ui/Input/Input';
import { calculateExpiryTime } from '../../utils/statusUtils';
import { apiInstance } from '../../services/clients/apiClient';
import { useAuth } from '../../hooks/useAuth';
import { mutators } from '../../zero/mutators';
import { v4 as uuidv4 } from 'uuid';

// Assignment-specific expiry options
const ASSIGNMENT_EXPIRY_OPTIONS = [
  { label: '30 minutes', value: '30min' },
  { label: '1 hour', value: '1hour' },
  { label: '4 hours', value: '4hours' },
  { label: 'Today', value: 'today' },
  { label: 'This week', value: 'week' },
  { label: 'Custom', value: 'custom' },
];

interface UpdateAssignmentStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const UpdateAssignmentStatusModal: React.FC<UpdateAssignmentStatusModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { user } = useAuth();
  const zero = useZero();
  const modalContentRef = React.useRef<HTMLDivElement>(null);
  const [expiryOption, setExpiryOption] = useState('today');
  const [customDate, setCustomDate] = useState<Date | undefined>(new Date());
  const [customTime, setCustomTime] = useState('23:59');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize state based on current availability
  useEffect(() => {
    if (isOpen) {
      setExpiryOption('today');
      setCustomDate(new Date());
      setCustomTime('23:59');
      setShowDatePicker(false);
      setError(null);
    }
  }, [isOpen]);

  // Show date picker when custom option is selected
  useEffect(() => {
    setShowDatePicker(expiryOption === 'custom');
    if (expiryOption === 'custom' && !customDate) {
      setCustomDate(new Date());
    }
  }, [expiryOption, customDate]);

  const handleSave = async (): Promise<void> => {
    if (!user) {
      setError('User not found');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Pause: Calculate unavailableUntil timestamp
      let customDateTime: Date | undefined;
      if (expiryOption === 'custom' && customDate) {
        customDateTime = new Date(customDate);
        const [hoursStr, minutesStr] = customTime.split(':');
        const hours = parseInt(hoursStr || '', 10);
        const minutes = parseInt(minutesStr || '', 10);
        customDateTime.setHours(isNaN(hours) ? 23 : hours, isNaN(minutes) ? 59 : minutes, 0, 0);
      }

      const unavailableUntilTimestamp = calculateExpiryTime(expiryOption, customDateTime);

      if (!unavailableUntilTimestamp) {
        setError('Please select a valid time');
        setIsLoading(false);
        return;
      }

      // Call API to update backend (Prisma + Redis)
      await apiInstance.post('/user-assignment-state/toggle', {
        isUnavailable: true,
        unavailableUntil: unavailableUntilTimestamp,
      });

      // Update Zero directly for real-time sync (like UpdateStatusModal does)
      zero.mutate(
        mutators.userPresence.upsert({
          assignmentUnavailableUntil: unavailableUntilTimestamp,
          timestamp: Date.now(),
          presenceId: uuidv4(),
        }),
      );

      onClose();
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to update assignment availability';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose} className='max-w-lg rounded-2xl'>
      <div ref={modalContentRef} className='p-6 space-y-4'>
        <div className='flex items-center justify-between'>
          <h2 className='text-lg font-semibold'>Ticket Assignment Availability</h2>
          <Button
            variant='ghost'
            size='sm'
            onClick={onClose}
            className='size-7 p-0 text-gray-500 hover:text-gray-700 rounded-lg border border-gray-200 hover:bg-gray-100'
          >
            <X className='size-4' />
          </Button>
        </div>

        {/* Datetime Input */}
        <div className='space-y-4 pt-2'>
          <div className='space-y-2'>
            <span className='text-sm font-medium text-gray-700'>Available after</span>
            <Select.Root value={expiryOption} onValueChange={setExpiryOption}>
              <Select.Trigger className='w-full flex items-center justify-between px-3 py-2 rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500'>
                <Select.Value />
                <Select.Icon>
                  <ChevronDown className='size-4' />
                </Select.Icon>
              </Select.Trigger>

              <Select.Portal container={modalContentRef.current ?? undefined}>
                <Select.Content
                  position='popper'
                  side='bottom'
                  align='start'
                  sideOffset={6}
                  className='bg-white rounded-lg border border-gray-200 shadow-lg overflow-hidden z-50'
                >
                  <Select.Viewport className='p-1'>
                    {ASSIGNMENT_EXPIRY_OPTIONS.map(option => (
                      <Select.Item
                        key={option.value}
                        value={option.value}
                        className='relative flex items-center px-3 py-2 rounded-md text-sm cursor-pointer hover:bg-gray-100 outline-none select-none data-[highlighted]:bg-gray-100'
                      >
                        <Select.ItemText>{option.label}</Select.ItemText>
                        <Select.ItemIndicator className='absolute right-2'>
                          <Check className='size-4' />
                        </Select.ItemIndicator>
                      </Select.Item>
                    ))}
                  </Select.Viewport>
                </Select.Content>
              </Select.Portal>
            </Select.Root>
          </div>

          {/* Custom Date/Time Picker */}
          {showDatePicker && (
            <div className='flex items-center gap-2'>
              <div className='px-3 py-2 border border-gray-300 rounded-lg flex-1 bg-white'>
                <Input
                  type='date'
                  value={customDate ? customDate.toISOString().split('T')[0] : ''}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    const date = e.target.value ? new Date(e.target.value) : undefined;
                    setCustomDate(date);
                  }}
                  min={new Date().toISOString().split('T')[0]}
                  className='w-full border-none p-0 focus:ring-0'
                />
              </div>

              <div className='px-3 py-2 border border-gray-300 rounded-lg bg-white'>
                <Input
                  type='time'
                  value={customTime}
                  onChange={e => setCustomTime(e.target.value)}
                  className='w-24 border-none p-0 focus:ring-0'
                />
              </div>
            </div>
          )}

          {error && (
            <div className='p-3 rounded-lg bg-red-50 border border-red-200'>
              <p className='text-sm text-red-800'>{error}</p>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className='flex gap-3 pt-2'>
          <Button variant='ghost' onClick={onClose} className='text-gray-700 hover:bg-gray-100'>
            Cancel
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={isLoading || !expiryOption}
            className='ml-auto px-6 text-white disabled:opacity-50 disabled:cursor-not-allowed'
            style={{ backgroundColor: '#6276BE' }}
          >
            {isLoading ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
