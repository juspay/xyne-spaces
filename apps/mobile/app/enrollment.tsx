/**
 * Enrollment Screen Route
 * Expo Router file for device enrollment
 *
 * Enrollment happens BEFORE login - device must be enrolled first
 */

import { useRouter } from 'expo-router';
import EnrollmentScreen from '../src/screens';

export default function EnrollmentRoute() {
  const router = useRouter();

  const handleEnrollmentComplete = () => {
    // Navigate to login after enrollment
    router.replace('/login');
  };

  return <EnrollmentScreen onEnrollmentComplete={handleEnrollmentComplete} />;
}
