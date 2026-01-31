export interface TicketItem {
  ticketId: string;
  title: string;
  createdBy: string;
  company: string;
  dueDate: Date;
  status: 'TODO' | 'STARTED' | 'PAUSED' | 'CANCELLED' | 'COMPLETED';
}

export interface EmailThread {
  id: string;
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  timestamp: Date;
  isReply?: boolean;
  replyTo?: string;
}

// Predefined email thread templates
const emailTemplates: EmailThread[] = [
  {
    id: 'email-1',
    from: 'support@company.com',
    to: ['team@company.com'],
    subject: 'Urgent: Payment Gateway Issues',
    body: `Dear All,

We are experiencing critical issues with our payment gateway integration. Multiple transactions are failing during peak hours. 

Please investigate and provide an update within 2 hours.

Best regards,
Support Team`,
    timestamp: new Date('2024-01-15T10:30:00'),
    isReply: false,
  },
  {
    id: 'email-2',
    from: 'tech-lead@company.com',
    to: ['support@company.com'],
    subject: 'Re: Urgent: Payment Gateway Issues',
    body: `Hi Support Team,

We've identified the issue - it's related to rate limiting on the third-party API. We're working on implementing a retry mechanism with exponential backoff.

Expected resolution: 4 hours.

Thanks,
Tech Lead`,
    timestamp: new Date('2024-01-15T11:15:00'),
    isReply: true,
    replyTo: 'email-1',
  },
  {
    id: 'email-3',
    from: 'customer@client.com',
    to: ['support@company.com'],
    subject: 'Database Connection Timeout',
    body: `Hello,

We're experiencing database connection timeouts since the last deployment. This is affecting our production environment significantly.

Can you please look into this urgently?

Thanks,
Customer Support`,
    timestamp: new Date('2024-01-18T09:00:00'),
    isReply: false,
  },
  {
    id: 'email-4',
    from: 'devops@company.com',
    to: ['customer@client.com'],
    subject: 'Re: Database Connection Timeout',
    body: `Hi,

We've identified the issue - the connection pool configuration was changed during deployment. We're reverting the changes and will redeploy shortly.

Apologies for the inconvenience.

DevOps Team`,
    timestamp: new Date('2024-01-18T10:30:00'),
    isReply: true,
    replyTo: 'email-3',
  },
  {
    id: 'email-5',
    from: 'admin@company.com',
    to: ['all@company.com'],
    subject: 'Reimbursement Submission Reminder',
    body: `Dear All,

Please submit your reimbursement expenses for the month of December 2025 in Darwin box portal only. If you don't know your emp id, get it from HR.

Note: PFA document procedure for submitting the reimbursement expenses in darwin box portal. Follow those steps which are present in the documentation and submit your claims in the darwin box. For any queries in the Darwin Box Portal, please reach out to the HR Ops team. For books and periodical reimbursements kindly upload the bills in the books and periodicals section only in the Darwin box. We request everyone to not to upload books and periodicals bills in the other expenses section.

Thanks,
Admin Team`,
    timestamp: new Date('2024-01-20T08:00:00'),
    isReply: false,
  },
  {
    id: 'email-6',
    from: 'hr@company.com',
    to: ['admin@company.com'],
    subject: 'Re: Reimbursement Submission Reminder',
    body: `Hi Admin Team,

Just to add - the deadline for December reimbursements is January 25th. Please ensure all submissions are completed by then.

Best,
HR Team`,
    timestamp: new Date('2024-01-20T09:15:00'),
    isReply: true,
    replyTo: 'email-5',
  },
  {
    id: 'email-7',
    from: 'security@company.com',
    to: ['engineering@company.com'],
    subject: 'Authentication System Issues',
    body: `Team,

We're seeing multiple reports of authentication failures. Users are unable to log in across different regions.

This needs immediate attention. Please investigate the authentication service logs.

Security Team`,
    timestamp: new Date('2024-01-22T14:00:00'),
    isReply: false,
  },
  {
    id: 'email-8',
    from: 'engineering@company.com',
    to: ['security@company.com'],
    subject: 'Re: Authentication System Issues',
    body: `Security Team,

We've found the root cause - JWT token validation is failing due to an expired secret. We're rotating the secret now and will deploy the fix within the hour.

Engineering`,
    timestamp: new Date('2024-01-22T14:45:00'),
    isReply: true,
    replyTo: 'email-7',
  },
  {
    id: 'email-9',
    from: 'product@company.com',
    to: ['support@company.com', 'engineering@company.com'],
    subject: 'Search Functionality Broken',
    body: `Hi Team,

Our search functionality is completely broken. Users are reporting empty results for all search queries.

This is a critical issue affecting user experience. Please prioritize.

Product Team`,
    timestamp: new Date('2024-01-25T11:00:00'),
    isReply: false,
  },
  {
    id: 'email-10',
    from: 'engineering@company.com',
    to: ['product@company.com'],
    subject: 'Re: Search Functionality Broken',
    body: `Product Team,

We've identified the issue - Elasticsearch cluster is down. We're working on bringing it back online. ETA: 30 minutes.

Engineering`,
    timestamp: new Date('2024-01-25T11:30:00'),
    isReply: true,
    replyTo: 'email-9',
  },
  {
    id: 'email-11',
    from: 'customer@client.com',
    to: ['support@company.com'],
    subject: 'File Upload Not Working',
    body: `Hello Support,

Our file upload feature has stopped working completely. Users cannot upload files of any size. This is causing significant revenue loss.

Please investigate urgently.

Customer`,
    timestamp: new Date('2024-01-26T09:30:00'),
    isReply: false,
  },
  {
    id: 'email-12',
    from: 'support@company.com',
    to: ['customer@client.com'],
    subject: 'Re: File Upload Not Working',
    body: `Hi Customer,

We're aware of the issue and our team is working on it. The file storage service appears to be down. We're checking with our infrastructure provider.

We'll update you within the hour.

Support Team`,
    timestamp: new Date('2024-01-26T10:00:00'),
    isReply: true,
    replyTo: 'email-11',
  },
  {
    id: 'email-13',
    from: 'ops@company.com',
    to: ['all@company.com'],
    subject: 'Scheduled Maintenance Window',
    body: `Team,

We'll be performing scheduled maintenance on our production systems this weekend (Saturday 2 AM - 4 AM).

During this time, the system will be unavailable. Please plan accordingly.

Ops Team`,
    timestamp: new Date('2024-01-28T16:00:00'),
    isReply: false,
  },
  {
    id: 'email-14',
    from: 'qa@company.com',
    to: ['engineering@company.com'],
    subject: 'Mobile App Crashes',
    body: `Engineering Team,

We're seeing a spike in mobile app crashes across all regions. Crash reports indicate memory issues.

Can you please investigate?

QA Team`,
    timestamp: new Date('2024-01-30T13:00:00'),
    isReply: false,
  },
  {
    id: 'email-15',
    from: 'engineering@company.com',
    to: ['qa@company.com'],
    subject: 'Re: Mobile App Crashes',
    body: `QA Team,

We've identified a memory leak in the image processing module. Fix is ready and will be deployed in the next release (v2.3.1).

Engineering`,
    timestamp: new Date('2024-01-30T15:00:00'),
    isReply: true,
    replyTo: 'email-14',
  },
  {
    id: 'email-16',
    from: 'billing@company.com',
    to: ['finance@company.com'],
    subject: 'Billing Calculation Errors',
    body: `Finance Team,

We've discovered billing calculation errors affecting multiple customer subscriptions. Incorrect amounts are being charged.

This needs immediate attention.

Billing Team`,
    timestamp: new Date('2024-02-01T10:00:00'),
    isReply: false,
  },
  {
    id: 'email-17',
    from: 'finance@company.com',
    to: ['billing@company.com'],
    subject: 'Re: Billing Calculation Errors',
    body: `Billing Team,

We're reviewing the affected accounts and will issue refunds where necessary. Please hold off on any new charges until we resolve this.

Finance`,
    timestamp: new Date('2024-02-01T11:30:00'),
    isReply: true,
    replyTo: 'email-16',
  },
  {
    id: 'email-18',
    from: 'customer@client.com',
    to: ['support@company.com'],
    subject: 'API Rate Limiting Issues',
    body: `Support,

We're hitting rate limits unexpectedly during peak hours. Our API calls are being throttled even though we're within our quota.

Can you check the rate limiter configuration?

Thanks,
Customer`,
    timestamp: new Date('2024-02-03T14:00:00'),
    isReply: false,
  },
  {
    id: 'email-19',
    from: 'support@company.com',
    to: ['customer@client.com'],
    subject: 'Re: API Rate Limiting Issues',
    body: `Hi Customer,

We've reviewed the rate limiter configuration and found that custom limits weren't being applied correctly. We've fixed this and deployed the update.

You should see the correct limits applied now.

Support`,
    timestamp: new Date('2024-02-03T15:30:00'),
    isReply: true,
    replyTo: 'email-18',
  },
  {
    id: 'email-20',
    from: 'devops@company.com',
    to: ['engineering@company.com'],
    subject: 'CDN Configuration Issues',
    body: `Engineering,

Our CDN is serving assets from origin instead of edge locations, causing slow load times globally.

Can you check the cache configuration?

DevOps`,
    timestamp: new Date('2024-02-05T09:00:00'),
    isReply: false,
  },
];

// Utility function to randomly select email threads
const getRandomEmailThreads = (count: number, seed?: string): EmailThread[] => {
  // Use seed for consistent randomization per ticket
  const shuffled = [...emailTemplates];
  if (seed) {
    // Simple seeded shuffle
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
    }
    const random = (): number => {
      hash = ((hash << 5) - hash + 0x9e3779b9) | 0;
      return Math.abs(hash) / 2147483648;
    };
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const temp = shuffled[i]!;
      shuffled[i] = shuffled[j]!;
      shuffled[j] = temp;
    }
  } else {
    // Random shuffle
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = shuffled[i]!;
      shuffled[i] = shuffled[j]!;
      shuffled[j] = temp;
    }
  }

  // Select count emails, ensuring we include reply chains
  const selected: EmailThread[] = [];
  const usedIds = new Set<string>();

  for (const email of shuffled) {
    if (selected.length >= count) break;

    // If it's a reply, try to include the original email too
    if (email.isReply && email.replyTo) {
      const original = emailTemplates.find(e => e.id === email.replyTo);
      if (original && !usedIds.has(original.id)) {
        selected.push(original);
        usedIds.add(original.id);
      }
    }

    if (!usedIds.has(email.id)) {
      selected.push(email);
      usedIds.add(email.id);
    }
  }

  // Sort by timestamp
  return selected.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
};

export const demoTickets: TicketItem[] = [
  {
    ticketId: 'ticket-0',
    title: 'Drop in Success Rates for Lazypay & Mobikwik Wallet',
    createdBy: 'Harsh Sharma',
    company: 'dealshare.in',
    dueDate: new Date('2024-01-15'),
    status: 'TODO',
  },
  {
    ticketId: 'ticket-1',
    title: 'Payment Gateway Issues in Production Environment',
    createdBy: 'Priya Patel',
    company: 'fintech.com',
    dueDate: new Date('2024-01-20'),
    status: 'STARTED',
  },
  {
    ticketId: 'ticket-2',
    title: 'User Authentication Problems Affecting Multiple Users',
    createdBy: 'Raj Kumar',
    company: 'secureapp.io',
    dueDate: new Date('2024-01-18'),
    status: 'PAUSED',
  },
  {
    ticketId: 'ticket-3',
    title: 'Database Connection Timeout Since Last Deployment',
    createdBy: 'Anita Singh',
    company: 'dataflow.tech',
    dueDate: new Date('2024-01-22'),
    status: 'TODO',
  },
  {
    ticketId: 'ticket-4',
    title: 'API Rate Limiting Errors During Peak Hours',
    createdBy: 'Vikram Mehta',
    company: 'apigateway.com',
    dueDate: new Date('2024-01-19'),
    status: 'STARTED',
  },
  {
    ticketId: 'ticket-5',
    title: 'Mobile App Crashes Across All Regions',
    createdBy: 'Sneha Reddy',
    company: 'mobileapp.dev',
    dueDate: new Date('2024-01-25'),
    status: 'COMPLETED',
  },
  {
    ticketId: 'ticket-6',
    title: 'Email Delivery Failures With High Priority',
    createdBy: 'Arjun Nair',
    company: 'emailservice.co',
    dueDate: new Date('2024-01-17'),
    status: 'TODO',
  },
  {
    ticketId: 'ticket-7',
    title: 'Search Functionality Broken Requiring Immediate Attention',
    createdBy: 'Meera Joshi',
    company: 'searchplatform.io',
    dueDate: new Date('2024-01-21'),
    status: 'STARTED',
  },
  {
    ticketId: 'ticket-8',
    title: 'Checkout Process Errors Blocking Critical Workflows',
    createdBy: 'Karan Malhotra',
    company: 'ecommerce.shop',
    dueDate: new Date('2024-01-16'),
    status: 'PAUSED',
  },
  {
    ticketId: 'ticket-9',
    title: 'File Upload Not Working Causing Revenue Loss',
    createdBy: 'Divya Sharma',
    company: 'cloudstorage.net',
    dueDate: new Date('2024-01-23'),
    status: 'TODO',
  },
  {
    ticketId: 'ticket-10',
    title: 'Session Expiration Issues Impact on Customer Experience',
    createdBy: 'Rohit Verma',
    company: 'sessionmanager.app',
    dueDate: new Date('2024-01-24'),
    status: 'CANCELLED',
  },
  {
    ticketId: 'ticket-11',
    title: 'Notification System Down Needs Urgent Resolution',
    createdBy: 'Neha Gupta',
    company: 'notify.service',
    dueDate: new Date('2024-01-26'),
    status: 'STARTED',
  },
  {
    ticketId: 'ticket-12',
    title: 'Report Generation Failed Escalated to Engineering Team',
    createdBy: 'Amit Desai',
    company: 'reporting.tool',
    dueDate: new Date('2024-01-27'),
    status: 'PAUSED',
  },
  {
    ticketId: 'ticket-13',
    title: 'Data Synchronization Problems Pending Customer Response',
    createdBy: 'Pooja Iyer',
    company: 'syncplatform.io',
    dueDate: new Date('2024-01-28'),
    status: 'TODO',
  },
  {
    ticketId: 'ticket-14',
    title: 'Login Credentials Invalid Under Investigation',
    createdBy: 'Suresh Menon',
    company: 'authsystem.com',
    dueDate: new Date('2024-01-29'),
    status: 'COMPLETED',
  },
  {
    ticketId: 'ticket-15',
    title: 'Performance Degradation in Dashboard',
    createdBy: 'Lakshmi Nair',
    company: 'analytics.pro',
    dueDate: new Date('2024-01-30'),
    status: 'STARTED',
  },
  {
    ticketId: 'ticket-16',
    title: 'Third-Party Integration Timeout',
    createdBy: 'Manoj Pillai',
    company: 'integrations.tech',
    dueDate: new Date('2024-02-01'),
    status: 'TODO',
  },
  {
    ticketId: 'ticket-17',
    title: 'Billing System Calculation Errors',
    createdBy: 'Kavita Rao',
    company: 'billingapp.com',
    dueDate: new Date('2024-02-02'),
    status: 'PAUSED',
  },
  {
    ticketId: 'ticket-18',
    title: 'Customer Data Export Failing',
    createdBy: 'Nikhil Shah',
    company: 'datamanager.io',
    dueDate: new Date('2024-02-03'),
    status: 'STARTED',
  },
  {
    ticketId: 'ticket-19',
    title: 'SSL Certificate Expiration Warning',
    createdBy: 'Rashmi Deshmukh',
    company: 'securehost.net',
    dueDate: new Date('2024-02-04'),
    status: 'COMPLETED',
  },
  {
    ticketId: 'ticket-20',
    title: 'CDN Configuration Issues Causing Slow Load Times',
    createdBy: 'Aditya Kapoor',
    company: 'contentdelivery.io',
    dueDate: new Date('2024-02-05'),
    status: 'TODO',
  },
  {
    ticketId: 'ticket-21',
    title: 'Webhook Delivery Failures to External Services',
    createdBy: 'Shruti Agarwal',
    company: 'webhookservice.com',
    dueDate: new Date('2024-02-06'),
    status: 'STARTED',
  },
  {
    ticketId: 'ticket-22',
    title: 'User Profile Image Upload Not Processing',
    createdBy: 'Ravi Thakur',
    company: 'socialnetwork.app',
    dueDate: new Date('2024-02-07'),
    status: 'PAUSED',
  },
  {
    ticketId: 'ticket-23',
    title: 'Real-time Chat Messages Not Delivering',
    createdBy: 'Anjali Mishra',
    company: 'chatplatform.io',
    dueDate: new Date('2024-02-08'),
    status: 'TODO',
  },
  {
    ticketId: 'ticket-24',
    title: 'Invoice PDF Generation Errors',
    createdBy: 'Siddharth Jain',
    company: 'invoicing.tech',
    dueDate: new Date('2024-02-09'),
    status: 'STARTED',
  },
  {
    ticketId: 'ticket-25',
    title: 'Two-Factor Authentication SMS Not Sending',
    createdBy: 'Kritika Singh',
    company: 'securityapp.com',
    dueDate: new Date('2024-02-10'),
    status: 'CANCELLED',
  },
  {
    ticketId: 'ticket-26',
    title: 'Analytics Dashboard Showing Incorrect Metrics',
    createdBy: 'Varun Reddy',
    company: 'analyticspro.io',
    dueDate: new Date('2024-02-11'),
    status: 'STARTED',
  },
  {
    ticketId: 'ticket-27',
    title: 'Backup System Not Running Scheduled Jobs',
    createdBy: 'Isha Patel',
    company: 'backupservice.net',
    dueDate: new Date('2024-02-12'),
    status: 'TODO',
  },
  {
    ticketId: 'ticket-28',
    title: 'API Documentation Out of Sync with Implementation',
    createdBy: 'Rohan Mehta',
    company: 'apidev.tools',
    dueDate: new Date('2024-02-13'),
    status: 'PAUSED',
  },
  {
    ticketId: 'ticket-29',
    title: 'Customer Support Ticket Assignment Logic Broken',
    createdBy: 'Tanvi Shah',
    company: 'supportdesk.io',
    dueDate: new Date('2024-02-14'),
    status: 'STARTED',
  },
  {
    ticketId: 'ticket-30',
    title: 'Payment Refund Process Stuck in Pending State',
    createdBy: 'Abhishek Kumar',
    company: 'paymentprocessor.com',
    dueDate: new Date('2024-02-15'),
    status: 'TODO',
  },
  {
    ticketId: 'ticket-31',
    title: 'Email Template Rendering Incorrectly in Outlook',
    createdBy: 'Nandini Rao',
    company: 'emailmarketing.co',
    dueDate: new Date('2024-02-16'),
    status: 'COMPLETED',
  },
  {
    ticketId: 'ticket-32',
    title: 'Database Query Performance Degradation',
    createdBy: 'Pranav Nair',
    company: 'dbservices.io',
    dueDate: new Date('2024-02-17'),
    status: 'STARTED',
  },
  {
    ticketId: 'ticket-33',
    title: 'Mobile Push Notifications Not Reaching iOS Devices',
    createdBy: 'Swati Desai',
    company: 'pushnotify.app',
    dueDate: new Date('2024-02-18'),
    status: 'TODO',
  },
  {
    ticketId: 'ticket-34',
    title: 'OAuth Token Refresh Failing for Google Integration',
    createdBy: 'Harshit Gupta',
    company: 'oauthprovider.io',
    dueDate: new Date('2024-02-19'),
    status: 'PAUSED',
  },
  {
    ticketId: 'ticket-35',
    title: 'File Compression Service Timing Out on Large Files',
    createdBy: 'Meghna Iyer',
    company: 'fileprocessor.com',
    dueDate: new Date('2024-02-20'),
    status: 'STARTED',
  },
  {
    ticketId: 'ticket-36',
    title: 'User Role Permissions Not Enforcing Correctly',
    createdBy: 'Kunal Malhotra',
    company: 'accesscontrol.io',
    dueDate: new Date('2024-02-21'),
    status: 'TODO',
  },
  {
    ticketId: 'ticket-37',
    title: 'GraphQL Query Resolver Returning Null Values',
    createdBy: 'Divya Pillai',
    company: 'graphqlapi.dev',
    dueDate: new Date('2024-02-22'),
    status: 'STARTED',
  },
  {
    ticketId: 'ticket-38',
    title: 'Scheduled Reports Not Generating on Time',
    createdBy: 'Aryan Joshi',
    company: 'reportingengine.io',
    dueDate: new Date('2024-02-23'),
    status: 'CANCELLED',
  },
  {
    ticketId: 'ticket-39',
    title: 'WebSocket Connection Dropping After 5 Minutes',
    createdBy: 'Sakshi Verma',
    company: 'realtimeapp.io',
    dueDate: new Date('2024-02-24'),
    status: 'TODO',
  },
  {
    ticketId: 'ticket-40',
    title: 'Image Optimization Service Crashing on PNG Files',
    createdBy: 'Ritvik Singh',
    company: 'imageprocessor.com',
    dueDate: new Date('2024-02-25'),
    status: 'STARTED',
  },
  {
    ticketId: 'ticket-41',
    title: 'Customer Onboarding Flow Missing Validation Step',
    createdBy: 'Ananya Reddy',
    company: 'onboarding.tool',
    dueDate: new Date('2024-02-26'),
    status: 'PAUSED',
  },
  {
    ticketId: 'ticket-42',
    title: 'Redis Cache Invalidation Not Working Properly',
    createdBy: 'Vivek Nair',
    company: 'cachemanager.io',
    dueDate: new Date('2024-02-27'),
    status: 'STARTED',
  },
  {
    ticketId: 'ticket-43',
    title: 'Stripe Payment Webhook Signature Verification Failing',
    createdBy: 'Preeti Sharma',
    company: 'paymentgateway.com',
    dueDate: new Date('2024-02-28'),
    status: 'TODO',
  },
  {
    ticketId: 'ticket-44',
    title: 'Elasticsearch Index Not Updating After Data Changes',
    createdBy: 'Rohit Kapoor',
    company: 'searchservice.io',
    dueDate: new Date('2024-03-01'),
    status: 'COMPLETED',
  },
  {
    ticketId: 'ticket-45',
    title: 'Multi-tenant Database Query Returning Wrong Tenant Data',
    createdBy: 'Kavya Patel',
    company: 'multitenant.app',
    dueDate: new Date('2024-03-02'),
    status: 'STARTED',
  },
  {
    ticketId: 'ticket-46',
    title: 'API Rate Limiter Not Respecting Custom Limits',
    createdBy: 'Arjun Deshmukh',
    company: 'ratelimit.service',
    dueDate: new Date('2024-03-03'),
    status: 'TODO',
  },
  {
    ticketId: 'ticket-47',
    title: 'PDF Watermarking Service Not Applying Watermarks',
    createdBy: 'Neha Iyer',
    company: 'documentprocessor.io',
    dueDate: new Date('2024-03-04'),
    status: 'PAUSED',
  },
  {
    ticketId: 'ticket-48',
    title: 'GraphQL Subscription Not Broadcasting Updates',
    createdBy: 'Siddharth Rao',
    company: 'realtimegraphql.io',
    dueDate: new Date('2024-03-05'),
    status: 'STARTED',
  },
  {
    ticketId: 'ticket-49',
    title: 'Customer Feedback Form Submission Not Saving',
    createdBy: 'Pooja Malhotra',
    company: 'feedbacktool.com',
    dueDate: new Date('2024-03-06'),
    status: 'TODO',
  },
];

export interface TicketDetails extends TicketItem {
  id: string;
  email: EmailThread[];
  aiSummary: string;
}

export const demoTicketDetails: TicketDetails[] = [
  {
    id: 'ticket-0',
    ticketId: 'ticket-0',
    title: 'Drop in Success Rates for Lazypay & Mobikwik Wallet',
    createdBy: 'Harsh Sharma',
    company: 'dealshare.in',
    dueDate: new Date('2024-01-15'),
    status: 'TODO',
    email: getRandomEmailThreads(3, 'ticket-0'),
    aiSummary:
      'Critical issue affecting payment success rates for Lazypay and Mobikwik wallet integrations. Investigation needed to identify root cause of declining transaction success percentages.',
  },
  {
    id: 'ticket-1',
    ticketId: 'ticket-1',
    title: 'Payment Gateway Issues in Production Environment',
    createdBy: 'Priya Patel',
    company: 'fintech.com',
    dueDate: new Date('2024-01-20'),
    status: 'STARTED',
    email: getRandomEmailThreads(4, 'ticket-1'),
    aiSummary:
      'Production payment gateway experiencing intermittent failures. Multiple transaction errors reported during peak hours. Requires immediate attention from infrastructure team.',
  },
  {
    id: 'ticket-2',
    ticketId: 'ticket-2',
    title: 'User Authentication Problems Affecting Multiple Users',
    createdBy: 'Raj Kumar',
    company: 'secureapp.io',
    dueDate: new Date('2024-01-18'),
    status: 'PAUSED',
    email: getRandomEmailThreads(3, 'ticket-2'),
    aiSummary:
      'Widespread authentication failures preventing users from accessing the platform. Affects multiple user accounts across different regions. Security review pending.',
  },
  {
    id: 'ticket-3',
    ticketId: 'ticket-3',
    title: 'Database Connection Timeout Since Last Deployment',
    createdBy: 'Anita Singh',
    company: 'dataflow.tech',
    dueDate: new Date('2024-01-22'),
    status: 'TODO',
    email: getRandomEmailThreads(3, 'ticket-3'),
    aiSummary:
      'Database connection pool exhausted causing timeouts. Issue started after recent deployment. Connection pool configuration may need adjustment.',
  },
  {
    id: 'ticket-4',
    ticketId: 'ticket-4',
    title: 'API Rate Limiting Errors During Peak Hours',
    createdBy: 'Vikram Mehta',
    company: 'apigateway.com',
    dueDate: new Date('2024-01-19'),
    status: 'STARTED',
    email: getRandomEmailThreads(3, 'ticket-4'),
    aiSummary:
      'Rate limiting thresholds being exceeded during peak traffic hours. Multiple clients hitting rate limits unexpectedly. May need to review rate limit configuration.',
  },
  {
    id: 'ticket-5',
    ticketId: 'ticket-5',
    title: 'Mobile App Crashes Across All Regions',
    createdBy: 'Sneha Reddy',
    company: 'mobileapp.dev',
    dueDate: new Date('2024-01-25'),
    status: 'COMPLETED',
    email: getRandomEmailThreads(4, 'ticket-5'),
    aiSummary:
      'Mobile application crashes resolved after hotfix deployment. Root cause identified as memory leak in image processing module. Fix deployed to production.',
  },
  {
    id: 'ticket-6',
    ticketId: 'ticket-6',
    title: 'Email Delivery Failures With High Priority',
    createdBy: 'Arjun Nair',
    company: 'emailservice.co',
    dueDate: new Date('2024-01-17'),
    status: 'TODO',
    email: getRandomEmailThreads(3, 'ticket-6'),
    aiSummary:
      'High volume of email delivery failures reported. SMTP service experiencing issues with multiple email providers. Delivery queue backing up significantly.',
  },
  {
    id: 'ticket-7',
    ticketId: 'ticket-7',
    title: 'Search Functionality Broken Requiring Immediate Attention',
    createdBy: 'Meera Joshi',
    company: 'searchplatform.io',
    dueDate: new Date('2024-01-21'),
    status: 'STARTED',
    email: getRandomEmailThreads(4, 'ticket-7'),
    aiSummary:
      'Search functionality completely non-functional. Search queries returning empty results or errors. Elasticsearch cluster may be experiencing issues.',
  },
  {
    id: 'ticket-8',
    ticketId: 'ticket-8',
    title: 'Checkout Process Errors Blocking Critical Workflows',
    createdBy: 'Karan Malhotra',
    company: 'ecommerce.shop',
    dueDate: new Date('2024-01-16'),
    status: 'PAUSED',
    email: getRandomEmailThreads(3, 'ticket-8'),
    aiSummary:
      'Checkout process failing for multiple payment methods. Users unable to complete purchases. Revenue impact significant. Requires urgent resolution.',
  },
  {
    id: 'ticket-9',
    ticketId: 'ticket-9',
    title: 'File Upload Not Working Causing Revenue Loss',
    createdBy: 'Divya Sharma',
    company: 'cloudstorage.net',
    dueDate: new Date('2024-01-23'),
    status: 'TODO',
    email: getRandomEmailThreads(4, 'ticket-9'),
    aiSummary:
      'File upload service completely down. Users unable to upload files of any size. Direct revenue impact as premium features unavailable.',
  },
  {
    id: 'ticket-10',
    ticketId: 'ticket-10',
    title: 'Session Expiration Issues Impact on Customer Experience',
    createdBy: 'Rohit Verma',
    company: 'sessionmanager.app',
    dueDate: new Date('2024-01-24'),
    status: 'CANCELLED',
    email: getRandomEmailThreads(3, 'ticket-10'),
    aiSummary:
      'Session expiration logic working as designed. User complaints about frequent logouts are due to security policy requirements. Ticket rejected as expected behavior.',
  },
  {
    id: 'ticket-11',
    ticketId: 'ticket-11',
    title: 'Notification System Down Needs Urgent Resolution',
    createdBy: 'Neha Gupta',
    company: 'notify.service',
    dueDate: new Date('2024-01-26'),
    status: 'STARTED',
    email: getRandomEmailThreads(3, 'ticket-11'),
    aiSummary:
      'Notification service completely offline. Push notifications, emails, and SMS not being delivered. Service restart in progress.',
  },
  {
    id: 'ticket-12',
    ticketId: 'ticket-12',
    title: 'Report Generation Failed Escalated to Engineering Team',
    createdBy: 'Amit Desai',
    company: 'reporting.tool',
    dueDate: new Date('2024-01-27'),
    status: 'PAUSED',
    email: getRandomEmailThreads(4, 'ticket-12'),
    aiSummary:
      'Report generation service failing for large datasets. Timeout errors occurring for reports with more than 100k records. Engineering team reviewing query optimization.',
  },
  {
    id: 'ticket-13',
    ticketId: 'ticket-13',
    title: 'Data Synchronization Problems Pending Customer Response',
    createdBy: 'Pooja Iyer',
    company: 'syncplatform.io',
    dueDate: new Date('2024-01-28'),
    status: 'TODO',
    email: getRandomEmailThreads(3, 'ticket-13'),
    aiSummary:
      'Data synchronization between primary and replica databases experiencing delays. Customer needs to provide access logs for further investigation.',
  },
  {
    id: 'ticket-14',
    ticketId: 'ticket-14',
    title: 'Login Credentials Invalid Under Investigation',
    createdBy: 'Suresh Menon',
    company: 'authsystem.com',
    dueDate: new Date('2024-01-29'),
    status: 'COMPLETED',
    email: getRandomEmailThreads(4, 'ticket-14'),
    aiSummary:
      'Login credential validation issue resolved. Problem was caused by expired JWT secret. New secret rotated and deployed. All systems operational.',
  },
  {
    id: 'ticket-15',
    ticketId: 'ticket-15',
    title: 'Performance Degradation in Dashboard',
    createdBy: 'Lakshmi Nair',
    company: 'analytics.pro',
    dueDate: new Date('2024-01-30'),
    status: 'STARTED',
    email: getRandomEmailThreads(3, 'ticket-15'),
    aiSummary:
      'Dashboard loading times increased by 300% over past week. Multiple slow queries identified. Performance optimization work in progress.',
  },
  {
    id: 'ticket-16',
    ticketId: 'ticket-16',
    title: 'Third-Party Integration Timeout',
    createdBy: 'Manoj Pillai',
    company: 'integrations.tech',
    dueDate: new Date('2024-02-01'),
    status: 'TODO',
    email: getRandomEmailThreads(3, 'ticket-16'),
    aiSummary:
      'Third-party API integration timing out consistently. External service may be experiencing issues. Retry logic and timeout configuration under review.',
  },
  {
    id: 'ticket-17',
    ticketId: 'ticket-17',
    title: 'Billing System Calculation Errors',
    createdBy: 'Kavita Rao',
    company: 'billingapp.com',
    dueDate: new Date('2024-02-02'),
    status: 'PAUSED',
    email: getRandomEmailThreads(4, 'ticket-17'),
    aiSummary:
      'Billing calculations producing incorrect amounts for subscription renewals. Multiple customers affected. Finance team approval required before fix deployment.',
  },
  {
    id: 'ticket-18',
    ticketId: 'ticket-18',
    title: 'Customer Data Export Failing',
    createdBy: 'Nikhil Shah',
    company: 'datamanager.io',
    dueDate: new Date('2024-02-03'),
    status: 'STARTED',
    email: getRandomEmailThreads(3, 'ticket-18'),
    aiSummary:
      'Customer data export feature failing for large datasets. CSV generation timing out. Implementing streaming export to handle large volumes.',
  },
  {
    id: 'ticket-19',
    ticketId: 'ticket-19',
    title: 'SSL Certificate Expiration Warning',
    createdBy: 'Rashmi Deshmukh',
    company: 'securehost.net',
    dueDate: new Date('2024-02-04'),
    status: 'COMPLETED',
    email: getRandomEmailThreads(4, 'ticket-19'),
    aiSummary:
      'SSL certificate renewed and deployed successfully. All domains now using valid certificates. Certificate auto-renewal configured for future.',
  },
  {
    id: 'ticket-20',
    ticketId: 'ticket-20',
    title: 'CDN Configuration Issues Causing Slow Load Times',
    createdBy: 'Aditya Kapoor',
    company: 'contentdelivery.io',
    dueDate: new Date('2024-02-05'),
    status: 'TODO',
    email: getRandomEmailThreads(3, 'ticket-20'),
    aiSummary:
      'CDN cache configuration incorrect causing assets to be served from origin instead of edge locations. Load times significantly increased globally.',
  },
  {
    id: 'ticket-21',
    ticketId: 'ticket-21',
    title: 'Webhook Delivery Failures to External Services',
    createdBy: 'Shruti Agarwal',
    company: 'webhookservice.com',
    dueDate: new Date('2024-02-06'),
    status: 'STARTED',
    email: getRandomEmailThreads(4, 'ticket-21'),
    aiSummary:
      'Webhook delivery failures increasing. Multiple external services not receiving webhook notifications. Retry mechanism and delivery queue under investigation.',
  },
  {
    id: 'ticket-22',
    ticketId: 'ticket-22',
    title: 'User Profile Image Upload Not Processing',
    createdBy: 'Ravi Thakur',
    company: 'socialnetwork.app',
    dueDate: new Date('2024-02-07'),
    status: 'PAUSED',
    email: getRandomEmailThreads(3, 'ticket-22'),
    aiSummary:
      'Profile image uploads accepted but not processing. Image processing queue appears stuck. Media processing service needs restart approval.',
  },
  {
    id: 'ticket-23',
    ticketId: 'ticket-23',
    title: 'Real-time Chat Messages Not Delivering',
    createdBy: 'Anjali Mishra',
    company: 'chatplatform.io',
    dueDate: new Date('2024-02-08'),
    status: 'TODO',
    email: getRandomEmailThreads(4, 'ticket-23'),
    aiSummary:
      'Real-time chat messages not being delivered to recipients. WebSocket connections established but message broadcasting failing. Message queue investigation needed.',
  },
  {
    id: 'ticket-24',
    ticketId: 'ticket-24',
    title: 'Invoice PDF Generation Errors',
    createdBy: 'Siddharth Jain',
    company: 'invoicing.tech',
    dueDate: new Date('2024-02-09'),
    status: 'STARTED',
    email: getRandomEmailThreads(3, 'ticket-24'),
    aiSummary:
      'PDF generation service throwing errors for invoices with special characters. Template rendering issue identified. Fix in development.',
  },
  {
    id: 'ticket-25',
    ticketId: 'ticket-25',
    title: 'Two-Factor Authentication SMS Not Sending',
    createdBy: 'Kritika Singh',
    company: 'securityapp.com',
    dueDate: new Date('2024-02-10'),
    status: 'CANCELLED',
    email: getRandomEmailThreads(3, 'ticket-25'),
    aiSummary:
      'SMS delivery working correctly. User account flagged for suspicious activity. 2FA SMS blocked by security policy. Ticket rejected as expected security behavior.',
  },
  {
    id: 'ticket-26',
    ticketId: 'ticket-26',
    title: 'Analytics Dashboard Showing Incorrect Metrics',
    createdBy: 'Varun Reddy',
    company: 'analyticspro.io',
    dueDate: new Date('2024-02-11'),
    status: 'STARTED',
    email: getRandomEmailThreads(4, 'ticket-26'),
    aiSummary:
      'Analytics dashboard displaying incorrect aggregation calculations. Data pipeline issue causing metrics to be calculated from incomplete datasets. Fix in progress.',
  },
  {
    id: 'ticket-27',
    ticketId: 'ticket-27',
    title: 'Backup System Not Running Scheduled Jobs',
    createdBy: 'Isha Patel',
    company: 'backupservice.net',
    dueDate: new Date('2024-02-12'),
    status: 'TODO',
    email: getRandomEmailThreads(3, 'ticket-27'),
    aiSummary:
      'Scheduled backup jobs not executing. Cron scheduler appears to be down. Manual backups working but automated schedule broken.',
  },
  {
    id: 'ticket-28',
    ticketId: 'ticket-28',
    title: 'API Documentation Out of Sync with Implementation',
    createdBy: 'Rohan Mehta',
    company: 'apidev.tools',
    dueDate: new Date('2024-02-13'),
    status: 'PAUSED',
    email: getRandomEmailThreads(4, 'ticket-28'),
    aiSummary:
      'API documentation missing several new endpoints and parameters. Documentation update pending review. Breaking changes need to be documented.',
  },
  {
    id: 'ticket-29',
    ticketId: 'ticket-29',
    title: 'Customer Support Ticket Assignment Logic Broken',
    createdBy: 'Tanvi Shah',
    company: 'supportdesk.io',
    dueDate: new Date('2024-02-14'),
    status: 'STARTED',
    email: getRandomEmailThreads(3, 'ticket-29'),
    aiSummary:
      'Ticket assignment algorithm incorrectly routing tickets to wrong teams. Load balancing logic needs review. Assignment rules being updated.',
  },
  {
    id: 'ticket-30',
    ticketId: 'ticket-30',
    title: 'Payment Refund Process Stuck in Pending State',
    createdBy: 'Abhishek Kumar',
    company: 'paymentprocessor.com',
    dueDate: new Date('2024-02-15'),
    status: 'TODO',
    email: getRandomEmailThreads(4, 'ticket-30'),
    aiSummary:
      'Multiple refund requests stuck in pending state. Refund processing workflow appears to be blocked. Payment gateway integration issue suspected.',
  },
  {
    id: 'ticket-31',
    ticketId: 'ticket-31',
    title: 'Email Template Rendering Incorrectly in Outlook',
    createdBy: 'Nandini Rao',
    company: 'emailmarketing.co',
    dueDate: new Date('2024-02-16'),
    status: 'COMPLETED',
    email: getRandomEmailThreads(3, 'ticket-31'),
    aiSummary:
      'Email template CSS compatibility issue with Outlook resolved. Inline styles added for better Outlook support. Templates now rendering correctly across all email clients.',
  },
  {
    id: 'ticket-32',
    ticketId: 'ticket-32',
    title: 'Database Query Performance Degradation',
    createdBy: 'Pranav Nair',
    company: 'dbservices.io',
    dueDate: new Date('2024-02-17'),
    status: 'STARTED',
    email: getRandomEmailThreads(3, 'ticket-32'),
    aiSummary:
      'Slow query performance identified in several frequently used queries. Missing indexes causing full table scans. Index optimization in progress.',
  },
  {
    id: 'ticket-33',
    ticketId: 'ticket-33',
    title: 'Mobile Push Notifications Not Reaching iOS Devices',
    createdBy: 'Swati Desai',
    company: 'pushnotify.app',
    dueDate: new Date('2024-02-18'),
    status: 'TODO',
    email: getRandomEmailThreads(4, 'ticket-33'),
    aiSummary:
      'iOS push notifications failing to deliver. APNs certificate may have expired or configuration issue. iOS notification service needs verification.',
  },
  {
    id: 'ticket-34',
    ticketId: 'ticket-34',
    title: 'OAuth Token Refresh Failing for Google Integration',
    createdBy: 'Harshit Gupta',
    company: 'oauthprovider.io',
    dueDate: new Date('2024-02-19'),
    status: 'PAUSED',
    email: getRandomEmailThreads(3, 'ticket-34'),
    aiSummary:
      'Google OAuth token refresh endpoint returning errors. Client credentials may need updating. OAuth configuration review pending approval.',
  },
  {
    id: 'ticket-35',
    ticketId: 'ticket-35',
    title: 'File Compression Service Timing Out on Large Files',
    createdBy: 'Meghna Iyer',
    company: 'fileprocessor.com',
    dueDate: new Date('2024-02-20'),
    status: 'STARTED',
    email: getRandomEmailThreads(4, 'ticket-35'),
    aiSummary:
      'File compression service timing out for files larger than 100MB. Processing timeout needs adjustment or chunked processing implementation required.',
  },
  {
    id: 'ticket-36',
    ticketId: 'ticket-36',
    title: 'User Role Permissions Not Enforcing Correctly',
    createdBy: 'Kunal Malhotra',
    company: 'accesscontrol.io',
    dueDate: new Date('2024-02-21'),
    status: 'TODO',
    email: getRandomEmailThreads(3, 'ticket-36'),
    aiSummary:
      'Role-based access control not properly enforcing permissions. Some users accessing resources outside their role scope. Permission evaluation logic needs review.',
  },
  {
    id: 'ticket-37',
    ticketId: 'ticket-37',
    title: 'GraphQL Query Resolver Returning Null Values',
    createdBy: 'Divya Pillai',
    company: 'graphqlapi.dev',
    dueDate: new Date('2024-02-22'),
    status: 'STARTED',
    email: getRandomEmailThreads(4, 'ticket-37'),
    aiSummary:
      'GraphQL resolvers returning null for valid queries. Data fetching logic may have issues with nested relationships. Resolver implementation under review.',
  },
  {
    id: 'ticket-38',
    ticketId: 'ticket-38',
    title: 'Scheduled Reports Not Generating on Time',
    createdBy: 'Aryan Joshi',
    company: 'reportingengine.io',
    dueDate: new Date('2024-02-23'),
    status: 'CANCELLED',
    email: getRandomEmailThreads(3, 'ticket-38'),
    aiSummary:
      'Scheduled reports delayed due to high system load during peak hours. This is expected behavior. Reports are queued and will complete when resources available. Ticket rejected.',
  },
  {
    id: 'ticket-39',
    ticketId: 'ticket-39',
    title: 'WebSocket Connection Dropping After 5 Minutes',
    createdBy: 'Sakshi Verma',
    company: 'realtimeapp.io',
    dueDate: new Date('2024-02-24'),
    status: 'TODO',
    email: getRandomEmailThreads(4, 'ticket-39'),
    aiSummary:
      'WebSocket connections dropping exactly at 5-minute mark. Load balancer or proxy timeout configuration likely causing disconnections. Keep-alive settings need adjustment.',
  },
  {
    id: 'ticket-40',
    ticketId: 'ticket-40',
    title: 'Image Optimization Service Crashing on PNG Files',
    createdBy: 'Ritvik Singh',
    company: 'imageprocessor.com',
    dueDate: new Date('2024-02-25'),
    status: 'STARTED',
    email: getRandomEmailThreads(3, 'ticket-40'),
    aiSummary:
      'Image optimization service crashing when processing PNG files with transparency. Memory issue suspected with alpha channel processing. Fix in development.',
  },
  {
    id: 'ticket-41',
    ticketId: 'ticket-41',
    title: 'Customer Onboarding Flow Missing Validation Step',
    createdBy: 'Ananya Reddy',
    company: 'onboarding.tool',
    dueDate: new Date('2024-02-26'),
    status: 'PAUSED',
    email: getRandomEmailThreads(4, 'ticket-41'),
    aiSummary:
      'Onboarding flow allowing users to proceed without completing required validation step. Business logic validation missing. Product approval needed for fix.',
  },
  {
    id: 'ticket-42',
    ticketId: 'ticket-42',
    title: 'Redis Cache Invalidation Not Working Properly',
    createdBy: 'Vivek Nair',
    company: 'cachemanager.io',
    dueDate: new Date('2024-02-27'),
    status: 'STARTED',
    email: getRandomEmailThreads(3, 'ticket-42'),
    aiSummary:
      'Cache invalidation not triggering when data updates occur. Stale data being served to users. Cache invalidation strategy needs review and fix.',
  },
  {
    id: 'ticket-43',
    ticketId: 'ticket-43',
    title: 'Stripe Payment Webhook Signature Verification Failing',
    createdBy: 'Preeti Sharma',
    company: 'paymentgateway.com',
    dueDate: new Date('2024-02-28'),
    status: 'TODO',
    email: getRandomEmailThreads(4, 'ticket-43'),
    aiSummary:
      'Stripe webhook signature verification failing. Webhook secret may be incorrect or request timestamp validation issue. Webhook handler needs debugging.',
  },
  {
    id: 'ticket-44',
    ticketId: 'ticket-44',
    title: 'Elasticsearch Index Not Updating After Data Changes',
    createdBy: 'Rohit Kapoor',
    company: 'searchservice.io',
    dueDate: new Date('2024-03-01'),
    status: 'COMPLETED',
    email: getRandomEmailThreads(3, 'ticket-44'),
    aiSummary:
      'Elasticsearch index synchronization issue resolved. Index update queue was stuck. Queue cleared and reindexing completed. All data now in sync.',
  },
  {
    id: 'ticket-45',
    ticketId: 'ticket-45',
    title: 'Multi-tenant Database Query Returning Wrong Tenant Data',
    createdBy: 'Kavya Patel',
    company: 'multitenant.app',
    dueDate: new Date('2024-03-02'),
    status: 'STARTED',
    email: getRandomEmailThreads(4, 'ticket-45'),
    aiSummary:
      'Critical security issue: queries returning data from wrong tenant. Tenant isolation filter not being applied correctly. Urgent fix required.',
  },
  {
    id: 'ticket-46',
    ticketId: 'ticket-46',
    title: 'API Rate Limiter Not Respecting Custom Limits',
    createdBy: 'Arjun Deshmukh',
    company: 'ratelimit.service',
    dueDate: new Date('2024-03-03'),
    status: 'TODO',
    email: getRandomEmailThreads(3, 'ticket-46'),
    aiSummary:
      'Rate limiter applying default limits instead of custom per-client limits. Configuration not being read correctly. Rate limit service needs fix.',
  },
  {
    id: 'ticket-47',
    ticketId: 'ticket-47',
    title: 'PDF Watermarking Service Not Applying Watermarks',
    createdBy: 'Neha Iyer',
    company: 'documentprocessor.io',
    dueDate: new Date('2024-03-04'),
    status: 'PAUSED',
    email: getRandomEmailThreads(4, 'ticket-47'),
    aiSummary:
      'PDF watermarking service processing files but not applying watermarks. Watermark template or positioning logic may have issues. Service review pending approval.',
  },
  {
    id: 'ticket-48',
    ticketId: 'ticket-48',
    title: 'GraphQL Subscription Not Broadcasting Updates',
    createdBy: 'Siddharth Rao',
    company: 'realtimegraphql.io',
    dueDate: new Date('2024-03-05'),
    status: 'STARTED',
    email: getRandomEmailThreads(3, 'ticket-48'),
    aiSummary:
      'GraphQL subscriptions not broadcasting real-time updates to connected clients. PubSub mechanism may be disconnected. Subscription server needs investigation.',
  },
  {
    id: 'ticket-49',
    ticketId: 'ticket-49',
    title: 'Customer Feedback Form Submission Not Saving',
    createdBy: 'Pooja Malhotra',
    company: 'feedbacktool.com',
    dueDate: new Date('2024-03-06'),
    status: 'TODO',
    email: getRandomEmailThreads(4, 'ticket-49'),
    aiSummary:
      'Feedback form submissions not being saved to database. Form validation passing but database insert failing silently. Data persistence layer needs debugging.',
  },
];
