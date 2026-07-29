import { ReactElement } from 'react';

const CreateForm = ({ color = 'currentColor' }: { color?: string }): ReactElement => {
  return (
    <svg width='18' height='18' viewBox='0 0 18 18' fill='none' xmlns='http://www.w3.org/2000/svg'>
      <path
        d='M8.51932 2.25H5.83654C3.63444 2.25 2.25293 3.81094 2.25293 6.01961V11.9797C2.25293 14.189 3.62787 15.75 5.83654 15.75H12.1627C14.3736 15.75 15.7471 14.189 15.7471 11.9797V9.29393'
        stroke={color}
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M12.4758 2.93594C13.2358 2.08752 14.1204 2.66648 14.7755 3.25325C15.4305 3.84002 16.1028 4.65588 15.3428 5.5043L10.197 11.041C9.96605 11.2988 9.64167 11.4537 9.296 11.4713L7.55757 11.5596C7.32033 11.5717 7.11771 11.3902 7.1037 11.1529L7.00104 9.41535C6.98063 9.06982 7.09905 8.73045 7.33001 8.47267L12.4758 2.93594Z'
        stroke={color}
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  );
};

export default CreateForm;
