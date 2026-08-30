import { useEffect, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from '@xyne/icons';
import { Button } from '../../components/ui/Button/Button';

interface NotFoundScreenProps {
  /** Where to return to. Skips history so a dead URL in it is never replayed. */
  fallbackPath?: string;
}

const NotFoundScreen = ({ fallbackPath }: NotFoundScreenProps = {}): ReactElement => {
  const navigate = useNavigate();

  useEffect(() => {
    const previous = document.title;
    document.title = 'Page not found';
    return (): void => {
      document.title = previous;
    };
  }, []);

  // `window.history.length` counts entries from before the app loaded (other sites
  // visited in the same tab), so it can't tell us whether there is anywhere in-app to
  // return to — going back on a pasted URL would leave Xyne entirely. React Router
  // tracks its own position at `history.state.idx`; 0 means this is the first entry it
  // owns, so fall through to the default route, which resolves workspace + landing.
  const handleGoBack = (): void => {
    if (fallbackPath) {
      void navigate(fallbackPath, { replace: true });
      return;
    }
    const idx = (window.history.state as { idx?: number } | null)?.idx;
    if (typeof idx === 'number' && idx > 0) {
      void navigate(-1);
      return;
    }
    void navigate('/', { replace: true });
  };

  return (
    <div className='flex h-screen w-full flex-col overflow-hidden bg-background'>
      <header className='flex w-full shrink-0 items-center py-4 pl-4 pr-3'>
        <img src='/svgs/xyne.svg' alt='Xyne' className='h-3.5 w-auto' draggable='false' />
      </header>

      <main className='flex flex-1 flex-col items-center justify-center gap-[58px] overflow-y-auto px-6 py-10'>
        <div
          aria-hidden='true'
          className='not-found-illustration aspect-[692/390] w-full max-w-[692px] shrink-0'
        />

        <div className='flex flex-col items-center gap-3'>
          <h1 className='text-center text-base font-medium leading-[22px] tracking-[-0.15px] text-muted-foreground'>
            Oops, Looks like you found our mistake.
          </h1>

          <Button
            variant='outline'
            onClick={handleGoBack}
            className='h-auto gap-1.5 rounded-lg border-[0.5px] bg-foreground/[6%] px-[15.5px] py-[8.5px] text-base'
            data-track-category='NOT_FOUND'
            data-track-name='GO_BACK'
          >
            <ArrowLeft size={16} />
            Go back
          </Button>
        </div>
      </main>
    </div>
  );
};

export default NotFoundScreen;
