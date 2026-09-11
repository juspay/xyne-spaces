import { FC } from 'react';
import { RadioGroup, Radio } from '../ui/RadioGroup';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../ui/dropdown-menu';
import { Button } from '../ui/Button/Button';
import { useGlobalNotificationSettings } from '../../hooks/useGlobalNotificationSettings';
import { MobileRoutingMode } from '@xyne/shared';

const THRESHOLD_OPTIONS = [1, 2, 3, 5, 10, 15, 30, 60, 120];

/**
 * Device-aware mobile notification routing (Slack-style): choose when
 * notifications reach mobile devices. While you're active on desktop,
 * WHEN_DESKTOP_INACTIVE skips the mobile push (no duplicate buzz); ALWAYS
 * delivers to every device regardless of desktop activity.
 */
export const MobileRoutingCard: FC = () => {
  const { mobileRoutingMode, desktopInactivityThresholdMinutes, update } =
    useGlobalNotificationSettings();

  // Radio values are local UI keys; map to the persisted enum + threshold.
  const radioValue =
    mobileRoutingMode === MobileRoutingMode.ALWAYS
      ? 'always'
      : desktopInactivityThresholdMinutes <= 1
        ? 'as_soon_as_inactive'
        : 'after_x_minutes';

  return (
    <div
      data-testid='mobile-routing-card'
      className='p-3 rounded-lg border border-border bg-muted/30 space-y-3'
    >
      <div>
        <p className='text-sm font-medium text-foreground'>
          When I&apos;m not active on desktop
        </p>
        <p className='text-xs text-muted-foreground mt-0.5'>
          While you&apos;re active on desktop, mobile notifications are skipped so
          your devices don&apos;t both buzz. Choose when mobile notifications resume.
        </p>
      </div>
      <RadioGroup
        value={radioValue}
        onChange={value => {
          if (value === 'always') {
            update({ mobileRoutingMode: MobileRoutingMode.ALWAYS });
          } else if (value === 'as_soon_as_inactive') {
            update({
              mobileRoutingMode: MobileRoutingMode.WHEN_DESKTOP_INACTIVE,
              desktopInactivityThresholdMinutes: 1,
            });
          } else {
            update({
              mobileRoutingMode: MobileRoutingMode.WHEN_DESKTOP_INACTIVE,
              desktopInactivityThresholdMinutes:
                desktopInactivityThresholdMinutes <= 1
                  ? 5
                  : desktopInactivityThresholdMinutes,
            });
          }
        }}
      >
        <Radio value='as_soon_as_inactive' data-track-category='PREFERENCES' data-track-name='SET_MOBILE_ROUTING_AS_SOON_AS_INACTIVE'>
          As soon as I&apos;m inactive
        </Radio>
        <Radio value='after_x_minutes' data-track-category='PREFERENCES' data-track-name='SET_MOBILE_ROUTING_AFTER_X_MINUTES'>
          After{' '}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                data-testid='mobile-routing-threshold-trigger'
                variant='outline'
                size='sm'
                className='h-6 px-2 mx-1 text-xs'
              >
                {desktopInactivityThresholdMinutes <= 1 ? 5 : desktopInactivityThresholdMinutes}{' '}
                minutes
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='start' data-track-category='PREFERENCES' data-track-name='SET_MOBILE_ROUTING_THRESHOLD'>
              {THRESHOLD_OPTIONS.map(minutes => (
                <DropdownMenuItem
                  key={minutes}
                  onClick={() =>
                    update({
                      mobileRoutingMode: MobileRoutingMode.WHEN_DESKTOP_INACTIVE,
                      desktopInactivityThresholdMinutes: minutes,
                    })
                  }
                >
                  {minutes} {minutes === 1 ? 'minute' : 'minutes'}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>{' '}
          of inactivity
        </Radio>
        <Radio value='always' data-track-category='PREFERENCES' data-track-name='SET_MOBILE_ROUTING_ALWAYS'>
          Always send me mobile notifications
        </Radio>
      </RadioGroup>
    </div>
  );
};

export default MobileRoutingCard;
