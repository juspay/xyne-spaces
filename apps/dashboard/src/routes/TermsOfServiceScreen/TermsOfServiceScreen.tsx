import { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { LegalDocumentScreen, type LegalSection } from '../../components/Legal/LegalDocumentScreen';

const TERMS_SECTIONS: LegalSection[] = [
  {
    id: 'acceptance-and-eligibility',
    number: '1',
    title: 'Acceptance and Eligibility',
    blocks: [
      {
        kind: 'paragraph',
        text: 'You must be at least 18 years old (or the age of majority in your jurisdiction) and capable of forming a binding contract to use the Software.',
      },
      {
        kind: 'paragraph',
        number: '1.2',
        text: 'You represent and warrant that you are not located in, under the control of, or a national or resident of any country or a party subject to applicable sanctions or export-control restrictions, and that your use of the Software complies with all applicable export-control and sanctions laws.',
      },
    ],
  },
  {
    id: 'software-and-licence',
    number: '2',
    title: 'The Software and Licence to Use',
    blocks: [
      {
        kind: 'paragraph',
        number: '2.1',
        text: (
          <>
            <strong>&ldquo;Software&rdquo;</strong> means the Xyne software/application made
            available by Juspay, which includes its enterprise search engine,
            collaboration-workspace platform, and any other products, features, modules,
            integrations, updates, and documentation (<strong>&ldquo;Documentation&rdquo;</strong>),
            as made available from time to time.
          </>
        ),
      },
      {
        kind: 'paragraph',
        number: '2.2',
        lead: 'License.',
        text: (
          <>
            The Software is an open-source software, governed by the open-source license terms
            (hereinafter referred to as the <strong>&ldquo;License&rdquo;</strong>), a copy of which
            is published with the Software. The License governs your rights to download, use,
            reproduce, modify, and distribute the Software&rsquo;s source code. These Terms set out
            additional terms that govern your use of the Software. In the event of a direct conflict
            between the License and the Terms, in relation to any rights in the source code, the
            License prevails.
          </>
        ),
      },
      {
        kind: 'paragraph',
        number: '2.3',
        text: 'You are solely responsible for obtaining, provisioning, configuring, securing, and maintaining the devices, environments, systems, networks, and third-party services on or through which you download, install, and operate the Software (whether locally, on-premises, or in your own cloud), and for all use of the Software under your deployment, including by your personnel and users.',
      },
      {
        kind: 'paragraph',
        number: '2.4',
        lead: 'Acceptable use and your responsibility.',
        text: 'You will not use the Software in violation of applicable law, or to create, store, or share content that is unlawful, infringing, harmful, or that violates the rights of others (including but not limited to child sexual abuse material, malware, or content promoting violence). Juspay does not monitor, moderate, or control any content or conduct within your deployment, and you are solely responsible for administering and enforcing acceptable use within it. Juspay may suspend or terminate your rights under these Terms and the License if it becomes aware of any breach.',
      },
    ],
  },
  {
    id: 'third-party-services-and-ai-models',
    number: '3',
    title: 'Third-Party Services and AI Models',
    blocks: [
      {
        kind: 'paragraph',
        number: '3.1',
        lead: 'Third-party services.',
        text: 'While using the Software, you may interact with third-party services, AI models and model providers, applications, repositories, or agents that Juspay does not control, including any AI models you connect. Your access to and use of any such third-party offerings are solely between you and the relevant third party and are governed by that third party\u2019s own terms and policies. Juspay makes no representations or warranties regarding, and shall have no responsibility or liability for, any third-party offering, including its availability, performance, security, or outputs, or the acts or omissions of any third party.',
      },
      {
        kind: 'paragraph',
        number: '3.2',
        lead: 'You bring your own AI models.',
        text: (
          <>
            The Software allows you to connect and use third-party artificial intelligence or
            large-language models by configuring your own model (each, a{' '}
            <strong>&ldquo;Connected Model&rdquo;</strong>). Juspay does not provide, and will not
            provide, access to any AI model under these Terms, and Juspay is not responsible for any
            model&rsquo;s availability, performance, outputs, costs, or terms.
          </>
        ),
      },
      {
        kind: 'paragraph',
        number: '3.3',
        lead: 'Your responsibilities.',
        text: 'You are responsible for obtaining and connecting your own AI model access, including any third-party model-provider accounts, API keys, and credentials, and you are responsible for: (a) all fees and charges imposed by your model provider(s) for your Connected Model; (b) complying with the Connected Model provider\u2019s terms of service and acceptable-use policies; (c) keeping your Connected Model API keys and credentials secure; and (d) all activity, outputs, and actions of any Connected Model or AI agents you connect or use with such Connected Model.',
      },
    ],
  },
  {
    id: 'customer-content',
    number: '4',
    title: 'Customer Content',
    blocks: [
      {
        kind: 'paragraph',
        number: '4.1',
        text: (
          <>
            <strong>&ldquo;Customer Content&rdquo;</strong> means all information, data, and content
            that is submitted to, and received from, the use of the Software.
          </>
        ),
      },
      {
        kind: 'paragraph',
        number: '4.2',
        lead: 'Ownership.',
        text: 'As between the parties, you retain all right, title, and interest in and to Customer Content.',
      },
      {
        kind: 'paragraph',
        number: '4.3',
        lead: 'Limited licence.',
        text: 'To the extent you submit or transmit any Customer Content to Juspay, you grant Juspay a non-exclusive, royalty-free, sublicensable licence and right to use, process, and store such Customer Content to operate, maintain, secure, and improve the Software and Juspay\u2019s underlying technologies, and to comply with applicable law.',
      },
    ],
  },
  {
    id: 'your-warranties',
    number: '5',
    title: 'Your Warranties',
    blocks: [
      {
        kind: 'paragraph',
        text: 'By submitting or making available any Customer Content through the Software, you represent and warrant that you have, or have obtained:',
      },
      {
        kind: 'list',
        items: [
          'all rights, licences, consents, permissions, and authority necessary to submit that Customer Content and to grant the rights provided under these Terms;',
          'that the Customer Content does not contain material, that is subject to copyright or other proprietary rights unless you have the necessary permission or are otherwise legally entitled to submit it and grant the licence described above; and',
          'that the Customer Content, and its use with the Software, do not violate these Terms, the rights of any third party, or applicable law.',
        ],
      },
    ],
  },
  {
    id: 'feedback',
    number: '6',
    title: 'Feedback',
    blocks: [
      {
        kind: 'paragraph',
        text: (
          <>
            We welcome feedback, comments, and suggestions for improvements to the Software (
            <strong>&ldquo;Feedback&rdquo;</strong>). You acknowledge and agree that any Feedback
            you provide does not and will not give you any right, title, or interest in the Software
            or in the Feedback. You hereby assign to Juspay all rights, titles, and interests
            (including all intellectual-property rights) that you may have in and to any Feedback
            and all such Feedback becomes the sole and exclusive property of Juspay. Juspay may use
            and disclose Feedback in any manner and for any purpose without notice, compensation, or
            attribution to you.
          </>
        ),
      },
    ],
  },
  {
    id: 'intellectual-property',
    number: '7',
    title: 'Intellectual Property',
    blocks: [
      {
        kind: 'paragraph',
        text: 'Except for the rights expressly granted under the License and these Terms, Juspay and its licensors retain all right, title, and interest, including all intellectual property rights, in and to the Software, its underlying technology, the Documentation, and all derivative works, modifications, and improvements thereto. Juspay reserves all rights not expressly granted. \u201cXyne\u201d, \u201cJuspay\u201d, and associated names and logos are trademarks of Juspay and its affiliates; the License does not grant any right to use these trademarks, and you may use them only as expressly permitted in writing.',
      },
    ],
  },
  {
    id: 'privacy',
    number: '8',
    title: 'Privacy',
    blocks: [
      {
        kind: 'paragraph',
        text: (
          <>
            Juspay&rsquo;s handling of any personal data it may collect in connection with the
            Software (for example, in connection with downloads, your interactions with Juspay, and
            support or marketing communications) is described in the{' '}
            <Link
              to='/privacy'
              className='font-medium underline underline-offset-4 transition-colors hover:text-primary'
              data-track-category='Legal'
              data-track-name='TermsOfServicePrivacyPolicyLink'
            >
              Privacy Policy
            </Link>
            , incorporated by reference.
          </>
        ),
      },
    ],
  },
  {
    id: 'disclaimer-of-warranties',
    number: '9',
    title: 'Disclaimer of Warranties',
    blocks: [
      {
        kind: 'paragraph',
        text: 'TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE SOFTWARE AND ALL CONTENT ARE PROVIDED \u201cAS IS\u201d AND \u201cAS AVAILABLE,\u201d WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT. JUSPAY DOES NOT WARRANT THAT THE SOFTWARE WILL BE UNINTERRUPTED, SECURE, OR ERROR-FREE, OR THAT ANY AI MODEL OUTPUT WILL BE ACCURATE OR RELIABLE. YOU ARE RESPONSIBLE FOR REVIEWING ANY OUTPUT AND MUST NOT RELY ON IT AS THE SOLE BASIS FOR ANY DECISIONS, INCLUDING BUT NOT LIMITED TO, THOSE WITH LEGAL, FINANCIAL, OR SAFETY CONSEQUENCES WITHOUT HUMAN REVIEW.',
      },
    ],
  },
  {
    id: 'limitation-of-liability',
    number: '10',
    title: 'Limitation of Liability',
    blocks: [
      {
        kind: 'paragraph',
        number: '10.1',
        text: 'TO THE MAXIMUM EXTENT PERMITTED BY LAW, JUSPAY AND ITS AFFILIATES WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF PROFITS, REVENUE, DATA, GOODWILL, OR BUSINESS INTERRUPTION, ARISING OUT OF OR RELATING TO THE SOFTWARE OR THESE TERMS, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.',
      },
      {
        kind: 'paragraph',
        number: '10.2',
        text: 'TO THE MAXIMUM EXTENT PERMITTED BY LAW, JUSPAY\u2019S TOTAL AGGREGATE LIABILITY ARISING OUT OF OR RELATING TO THE SOFTWARE AND THESE TERMS WILL NOT EXCEED INR 10,000/-.',
      },
    ],
  },
  {
    id: 'indemnification',
    number: '11',
    title: 'Indemnification',
    blocks: [
      {
        kind: 'paragraph',
        text: 'You will indemnify and hold harmless Juspay and its affiliates and their respective officers, directors, employees, and agents from and against any claims, damages, liabilities, costs, and expenses (including reasonable legal fees) arising out of or relating (i) to Customer Content, (ii) third-party Connected Models, (iii) your use of the Software, (iv) your violation of these Terms or the License and, (v) breach of applicable law.',
      },
    ],
  },
  {
    id: 'term-suspension-and-termination',
    number: '12',
    title: 'Term, Suspension, and Termination',
    blocks: [
      {
        kind: 'paragraph',
        number: '12.1',
        text: 'These Terms apply from the date you first download, install, access, or use the Software and continue for as long as you use the Software.',
      },
      {
        kind: 'paragraph',
        number: '12.2',
        text: 'These Terms terminate automatically if you cease using and delete the Software. Juspay may also terminate these Terms and the License, and any rights or permissions granted by Juspay under them (including any right to use the \u201cXyne\u201d or \u201cJuspay\u201d names or trademarks, any support, and access to any Juspay-operated services, updates, or accounts), on notice if you breach these Terms and the License.',
      },
      {
        kind: 'paragraph',
        number: '12.3',
        text: 'On termination, all rights and permissions granted to you under these Terms and the License end, and you must promptly cease using the Software and uninstall and delete all copies in your possession or control. Sections 4, 5, 6, 7, 9, 10, 11, and this Section 12.3, and Section 14, shall survive termination.',
      },
    ],
  },
  {
    id: 'changes-to-the-terms-and-the-software',
    number: '13',
    title: 'Changes to the Terms and the Software',
    blocks: [
      {
        kind: 'paragraph',
        number: '13.1',
        text: 'Juspay may modify these Terms from time to time, and your continued use of the Software after the changes take effect shall constitute acceptance.',
      },
      {
        kind: 'paragraph',
        number: '13.2',
        text: 'Juspay may change, discontinue, or stop maintaining the Software or any of its features at any time at its sole discretion, without liability.',
      },
    ],
  },
  {
    id: 'general-provisions',
    number: '14',
    title: 'General Provisions',
    blocks: [
      {
        kind: 'paragraph',
        number: '14.1',
        lead: 'Governing law and jurisdiction.',
        text: 'These Terms are governed by the laws of India, and the courts at Bengaluru, Karnataka shall have exclusive jurisdiction, subject to any right of Juspay to seek injunctive relief in any competent court.',
      },
      {
        kind: 'paragraph',
        number: '14.2',
        lead: 'Notices.',
        text: (
          <>
            Notices to Juspay must be sent to{' '}
            <a
              href='mailto:legal@juspay.in'
              className='font-medium underline underline-offset-4 transition-colors hover:text-primary'
            >
              legal@juspay.in
            </a>
            . Juspay may give notice through the Software, its website, or the repository.
          </>
        ),
      },
      {
        kind: 'paragraph',
        number: '14.3',
        lead: 'Assignment.',
        text: 'You may not assign these Terms without Juspay\u2019s prior written consent. Any prohibited assignment is void.',
      },
      {
        kind: 'paragraph',
        number: '14.4',
        lead: 'Force majeure.',
        text: 'Juspay is not liable for any delay or failure to perform due to causes beyond its reasonable control.',
      },
      {
        kind: 'paragraph',
        number: '14.5',
        lead: 'Entire agreement; severability; waiver.',
        text: 'These Terms, together with the License and the Privacy Policy, are the entire agreement between the parties regarding the Software and shall supersede all prior agreements on the subject matter. If any provision is held unenforceable, the remainder continues to be in effect. No waiver is effective unless given in writing.',
      },
      {
        kind: 'paragraph',
        number: '14.6',
        lead: 'Independent parties.',
        text: 'The parties are independent contractors; these Terms create no partnership, agency, or joint venture.',
      },
    ],
  },
];

const TermsOfServiceScreen = (): ReactElement => (
  <LegalDocumentScreen
    title='Terms of Service'
    lastUpdated='25 August 2026'
    intro={
      <>
        These Terms of Service (these &ldquo;Terms&rdquo;) are a binding agreement between Juspay
        Technologies Private Limited, a company incorporated under the laws of India with its
        registered office at #444, Stallion Business Centre, 18th Main Road, 6th Block, Koramangala,
        Bengaluru, Karnataka, India - 560095 (&ldquo;Juspay&rdquo;, &ldquo;we&rdquo;,
        &ldquo;us&rdquo;, &ldquo;our&rdquo;), and the entity or person that downloads, installs,
        accesses, or uses the Software (the &ldquo;Customer&rdquo;, &ldquo;you&rdquo;,
        &ldquo;your&rdquo;). The Software is intended only for your internal use.
      </>
    }
    notice={
      <p className='text-[12px] font-medium leading-[1.85] tracking-[0.012em] text-foreground'>
        PLEASE READ THESE TERMS CAREFULLY. BY DOWNLOADING, INSTALLING, ACCESSING, OR USING THE
        SOFTWARE, OR BY CLICKING TO ACCEPT, YOU AGREE TO BE BOUND BY THESE TERMS. IF YOU DO NOT
        AGREE, DO NOT DOWNLOAD, INSTALL, ACCESS, OR USE THE SOFTWARE. IF YOU ARE ACCEPTING ON BEHALF
        OF AN ENTITY, YOU REPRESENT AND WARRANT THAT YOU ARE AUTHORISED TO BIND THAT ENTITY.
      </p>
    }
    sections={TERMS_SECTIONS}
    siblingLink={{ label: 'Privacy Policy', to: '/privacy' }}
  />
);

export default TermsOfServiceScreen;
