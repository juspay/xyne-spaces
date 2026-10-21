import { ReactElement } from 'react';
import { LegalDocumentScreen, type LegalSection } from '../../components/Legal/LegalDocumentScreen';

const PRIVACY_SECTIONS: LegalSection[] = [
  {
    id: 'scope',
    number: '1',
    title: 'Scope',
    blocks: [
      {
        kind: 'paragraph',
        text: 'This Privacy Policy applies to Personal Data we collect from and about you through the Website and through related communications with us, such as emails, enquiry or contact forms, account registration, support and community interactions, and marketing.',
      },
    ],
  },
  {
    id: 'personal-data-we-collect',
    number: '2',
    title: 'Personal Data We Collect',
    blocks: [
      {
        kind: 'paragraph',
        number: '2.1',
        lead: 'Information you provide to us.',
        text: 'We collect the Personal Data that you choose to provide to us through the Website, for example, when you contact us or submit an enquiry, register for or manage an account, request support, participate in our community, sign up to receive marketing communications, or download the software made available on the Website. This information may include your name, work email address, company or organisation name, country, mobile or telephone number, and any information you choose to include in your messages or communications with us.',
      },
      {
        kind: 'paragraph',
        number: '2.2',
        lead: 'Information we collect automatically.',
        text: 'When you use the Website, we may automatically collect certain technical and usage information about your device and interactions, including your IP address, browser type and version, device information, operating system, referring URLs, the pages you view, and how you navigate the Website. We collect this information using cookies, server logs, and similar technologies (see Section 4).',
      },
      {
        kind: 'paragraph',
        number: '2.3',
        lead: 'Aggregate data.',
        text: 'We may also collect, use, and share aggregate data, such as statistical or demographic data, for purposes including analysing and improving the Website. Aggregate data may be derived from your Personal Data but does not, directly or indirectly, reveal your identity.',
      },
    ],
  },
  {
    id: 'how-we-use-your-personal-data',
    number: '3',
    title: 'How We Use Your Personal Data',
    blocks: [
      {
        kind: 'paragraph',
        text: 'We may use your Personal Data for the following purposes:',
      },
      {
        kind: 'list',
        items: [
          'to respond to, follow up on, and manage your enquiries, support requests, and communications;',
          'to reach out to you in connection with your interest in Xyne;',
          'to send you marketing and promotional communications where permitted (see Section 5);',
          'to operate, maintain, secure, analyse, and improve the Website, including through product and usage analytics;',
          'to detect, prevent, and address technical issues, fraud, or misuse; and',
          'to comply with applicable laws and legal or regulatory obligations.',
        ],
      },
    ],
  },
  {
    id: 'cookies-and-similar-technologies',
    number: '4',
    title: 'Cookies and Similar Technologies',
    blocks: [
      {
        kind: 'paragraph',
        text: 'We use cookies and similar technologies, including third-party analytics tools, to operate the Website, understand how it is used, and improve it. You can set your browser to refuse all or some cookies, or to alert you when websites set or access cookies. If you disable or refuse cookies, please note that some parts of the Website may become inaccessible or may not function properly.',
      },
    ],
  },
  {
    id: 'marketing',
    number: '5',
    title: 'Marketing',
    blocks: [
      {
        kind: 'paragraph',
        text: 'We may use your details to send you marketing or outreach communications about Xyne and related offerings, and to manage sign-ups where you have opted to receive such communications, using third-party tools and platforms such as HubSpot and Zoho. You can opt out of receiving marketing communications from us at any time by following the unsubscribe instructions in any such communication or by contacting us using the details in Section 13.',
      },
    ],
  },
  {
    id: 'how-we-share-your-personal-data',
    number: '6',
    title: 'How We Share Your Personal Data',
    blocks: [
      {
        kind: 'paragraph',
        text: 'We may share your Personal Data with the following third-parties:',
      },
      {
        kind: 'list',
        items: [
          'service providers and processors who support, the operation of the Website, our analytics, and our marketing and communications (including providers such as Google, HubSpot, Zoho, and PostHog)',
          'professional advisors, authorities, and other parties where necessary to comply with applicable law, legal process, or a regulatory request, or to establish, exercise, or defend legal claims.',
        ],
      },
      {
        kind: 'paragraph',
        text: 'We require all third parties to respect the security of your Personal Data and to treat it in accordance with applicable law.',
      },
    ],
  },
  {
    id: 'international-transfers',
    number: '7',
    title: 'International Transfers',
    blocks: [
      {
        kind: 'paragraph',
        text: 'Some of our service providers may be located outside your country or outside India, and your Personal Data may be transferred to, stored in, or processed in other jurisdictions. Where we transfer Personal Data across borders, we take steps to ensure that it is afforded an adequate level of protection in accordance with applicable data protection laws.',
      },
    ],
  },
  {
    id: 'data-security',
    number: '8',
    title: 'Data Security',
    blocks: [
      {
        kind: 'paragraph',
        text: 'We have put in place appropriate technical and organisational security measures designed to prevent your Personal Data from being accidentally lost, used, altered, disclosed, or accessed in an unauthorised way. We maintain industry-recognised information-security certifications, including ISO 27001:2022 and SOC 2 Type 2, to limit access to your Personal Data to those who need it, and periodically review and update our security practices in line with changes in applicable data protection laws.',
      },
    ],
  },
  {
    id: 'data-retention',
    number: '9',
    title: 'Data Retention',
    blocks: [
      {
        kind: 'paragraph',
        text: 'We will retain your Personal Data only for as long as necessary to fulfil the purposes for which it was collected, including to satisfy any legal, regulatory, or reporting requirements. Once the applicable purpose has been fulfilled and any retention period has expired, records are securely destroyed or anonymised so that they can no longer be associated with you.',
      },
    ],
  },
  {
    id: 'your-rights',
    number: '10',
    title: 'Your Rights',
    blocks: [
      {
        kind: 'paragraph',
        text: 'Depending on the jurisdiction in which you reside, you may have some or all of the following rights in relation to your Personal Data:',
      },
      {
        kind: 'list',
        items: [
          'right to be informed about the collection and use of your Personal Data;',
          'the right of access to the Personal Data we hold about you and information about how we process it;',
          'right to correction and erasure of your Personal Data;',
          'right to restrict processing in certain circumstances;',
          'right to object to or opt out of processing, including for marketing;',
          'right to data portability;',
          'right to object to decisions based solely on automated processing;',
          'right to grievance redressal in respect of the Personal Data we process; and',
          'right to nominate another individual to exercise your rights in the event of death or incapacity.',
        ],
      },
      {
        kind: 'paragraph',
        text: 'To exercise any of these rights, please contact us using the details in Section 13. If you are not satisfied with how we handle your request, you may have the right to complain to the relevant data-protection authority in your jurisdiction. We would, however, appreciate the opportunity to address your concerns before you approach the authority.',
      },
    ],
  },
  {
    id: 'third-party-links',
    number: '11',
    title: 'Third-Party Links',
    blocks: [
      {
        kind: 'paragraph',
        text: 'The Website may contain links to third-party websites, plug-ins, or services that we do not operate or control. We are not responsible for the privacy practices of those third parties, and we encourage you to review their privacy policies.',
      },
    ],
  },
  {
    id: 'changes-to-this-privacy-policy',
    number: '12',
    title: 'Changes to This Privacy Policy',
    blocks: [
      {
        kind: 'paragraph',
        text: 'We may update this Privacy Policy from time to time to reflect changes in our practices or for legal, operational, or regulatory reasons. Any changes will be effective when the revised Privacy Policy is posted on the Website, and your continued use of the Website after such posting constitutes your acceptance of the revised Privacy Policy.',
      },
    ],
  },
  {
    id: 'contact-us',
    number: '13',
    title: 'Contact Us',
    blocks: [
      {
        kind: 'paragraph',
        text: (
          <>
            For any questions, requests, or grievances relating to this Privacy Policy or the
            processing of your Personal Data, you may contact us at{' '}
            <a
              href='mailto:privacy@juspay.in'
              className='font-medium underline underline-offset-4 transition-colors hover:text-primary'
            >
              privacy@juspay.in
            </a>{' '}
            or{' '}
            <a
              href='mailto:legal@juspay.in'
              className='font-medium underline underline-offset-4 transition-colors hover:text-primary'
            >
              legal@juspay.in
            </a>
            .
          </>
        ),
      },
    ],
  },
];

const PrivacyPolicyScreen = (): ReactElement => (
  <LegalDocumentScreen
    title='Privacy Policy'
    lastUpdated='25 August 2026'
    intro={
      <>
        This Privacy Policy explains how Juspay Technologies Private Limited (
        <strong>&ldquo;Juspay&rdquo;</strong>, <strong>&ldquo;we&rdquo;</strong>,{' '}
        <strong>&ldquo;us&rdquo;</strong>, <strong>&ldquo;our&rdquo;</strong>) collects, uses,
        shares, and protects the personal data (<strong>&ldquo;Personal Data&rdquo;</strong>) of any
        individual (<strong>&ldquo;you&rdquo;</strong>, <strong>&ldquo;your&rdquo;</strong>, or{' '}
        <strong>&ldquo;Customer&rdquo;</strong>) who visits, accesses, or interacts with our website
        (the <strong>&ldquo;Website&rdquo;</strong>), and the rights available to you in relation to
        your Personal Data. &ldquo;Personal Data&rdquo; means any information relating to an
        identified or identifiable individual. By accessing or using the Website, or submitting your
        information to us through it, you acknowledge that you have read and understood this Privacy
        Policy.
      </>
    }
    sections={PRIVACY_SECTIONS}
    appendix={
      <div className='rounded-lg border border-border bg-card p-5 sm:p-6'>
        <p className='text-[11px] font-semibold uppercase tracking-[0.28em] text-muted-foreground'>
          Grievance Officer Details
        </p>
        <div className='mt-4 flex flex-col gap-2.5 text-[15px] leading-[1.8] text-foreground'>
          <p className='font-semibold'>Juspay Technologies Private Limited</p>
          <p>
            <span className='text-muted-foreground'>Office address: </span>
            Stallion Business Centre, #444, 18th Main Road, 6th Block, Koramangala, Bengaluru,
            Karnataka, India &ndash; 560095
          </p>
          <p>
            <span className='text-muted-foreground'>Email: </span>
            <a
              href='mailto:privacy@juspay.in'
              className='font-medium underline underline-offset-4 transition-colors hover:text-primary'
            >
              privacy@juspay.in
            </a>
            <span>; CC: </span>
            <a
              href='mailto:legal@juspay.in'
              className='font-medium underline underline-offset-4 transition-colors hover:text-primary'
            >
              legal@juspay.in
            </a>
          </p>
        </div>
      </div>
    }
    siblingLink={{ label: 'Terms of Service', to: '/terms' }}
  />
);

export default PrivacyPolicyScreen;
