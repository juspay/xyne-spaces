import React, { createContext, useCallback, useContext, useState } from 'react';
import { skipsDeviceEnrollmentGate } from '../config';
import { getBoolean, setBoolean } from '../services/localStorage';

type EnrollmentContextType = {
  isEnrolled: boolean | null;
  setIsEnrolled: (value: boolean) => void;
  isEnrollmentLoading: boolean;
  setIsEnrollmentLoading: (value: boolean) => void;
};

const EnrollmentContext = createContext<EnrollmentContextType | null>(null);
const ENROLLMENT_CACHE_KEY = '@lotus_is_enrolled';

export function EnrollmentProvider({ children }: { children: React.ReactNode }) {
  const skipEnrollment = skipsDeviceEnrollmentGate();
  const cachedEnrollment = getBoolean(ENROLLMENT_CACHE_KEY);
  const [isEnrolled, setIsEnrolledState] = useState<boolean | null>(
    skipEnrollment ? true : cachedEnrollment,
  );
  const [isEnrollmentLoading, setIsEnrollmentLoading] = useState(
    !skipEnrollment && cachedEnrollment === null,
  );
  const setIsEnrolled = useCallback(
    (value: boolean): void => {
      if (!skipEnrollment) {
        setBoolean(ENROLLMENT_CACHE_KEY, value);
      }
      setIsEnrolledState(value);
    },
    [skipEnrollment],
  );

  return (
    <EnrollmentContext.Provider
      value={{ isEnrolled, setIsEnrolled, isEnrollmentLoading, setIsEnrollmentLoading }}
    >
      {children}
    </EnrollmentContext.Provider>
  );
}

export function useEnrollment() {
  const ctx = useContext(EnrollmentContext);
  if (!ctx) throw new Error('useEnrollment must be used within EnrollmentProvider');
  return ctx;
}
