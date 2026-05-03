/// <reference path="./.sst/platform/config.d.ts" />
export default $config({
  app(input) {
    return {
      name: "notify",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "aws",
      providers: { neon: { package: "@sst-provider/neon", version: "0.13.0" } },
    };
  },
  async run() {
    const myAppProject = new neon.Project('MyAppProject', {
      name: 'my-sst-project',
      pgVersion: 17,
      regionId: 'aws-us-east-1',
      orgId: process.env.NEON_ORG_ID!,
      historyRetentionSeconds: 21600,
    });

    const db = new sst.Linkable('NeonDB', {
      properties: {
        connectionString: myAppProject.connectionUri,
      },
    });

    const adminApi = new sst.aws.Function('AdminApi', {
      handler: 'apps/server/functions/admin/index.handler',
      link: [db],
      nodejs: {
        install: ['expo-server-sdk'],
      },
      url: {
        cors: {
          allowOrigins: ['*'],
          allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
          allowHeaders: ['Content-Type', 'X-Customer-Id'],
        },
      },
    });

    const posthogWebhookApi = new sst.aws.Function('PosthogWebhookApi', {
      handler: 'apps/server/functions/posthog-webhook/index.handler',
      link: [db],
      url: {
        cors: {
          allowOrigins: ['*'],
          allowMethods: ['POST'],
          allowHeaders: ['Content-Type'],
        },
      },
    });

    const publicApi = new sst.aws.Function('PublicApi', {
      handler: 'apps/server/functions/public/index.handler',
      link: [db],
      environment: {
        WEBHOOK_BASE_URL: posthogWebhookApi.url,
      },
      url: {
        cors: {
          allowOrigins: ['*'],
          allowMethods: ['GET', 'POST', 'PATCH', 'DELETE'],
          allowHeaders: ['Content-Type', 'Authorization', 'X-Customer-Id'],
        },
      },
    });

    const enrollmentDlq = new sst.aws.Queue('EnrollmentDLQ', {
      transform: {
        queue: { messageRetentionSeconds: 60 * 60 * 24 * 14 },
      },
    });

    const enrollmentQueue = new sst.aws.Queue('EnrollmentQueue', {
      visibilityTimeout: '90 seconds',
      dlq: { queue: enrollmentDlq.arn, retry: 3 },
    });

    enrollmentQueue.subscribe(
      {
        handler: 'apps/server/functions/worker/index.handler',
        link: [db],
        timeout: '60 seconds',
        nodejs: { install: ['expo-server-sdk'] },
      },
      {
        batch: { size: 10, partialResponses: true },
      }
    );

    const dispatcher = new sst.aws.Function('EnrollmentDispatcher', {
      handler: 'apps/server/functions/dispatcher/index.handler',
      link: [db, enrollmentQueue],
      timeout: '30 seconds',
    });

    new sst.aws.CronV2('EnrollmentCron', {
      schedule: 'rate(1 minute)',
      function: dispatcher,
    });

    const receiptPoller = new sst.aws.Function('ReceiptPoller', {
      handler: 'apps/server/functions/receipt-poller/index.handler',
      link: [db],
      timeout: '60 seconds',
      nodejs: { install: ['expo-server-sdk'] },
    });

    new sst.aws.CronV2('ReceiptPollerCron', {
      schedule: 'rate(1 minute)',
      function: receiptPoller,
    });

    new sst.aws.StaticSite('Frontend', {
      build: {
        command: 'bun run build',
        output: 'dist',
      },
      environment: {
        VITE_API_URL: adminApi.url,
        VITE_PUBLIC_API_URL: publicApi.url,
      },
    });
  },
});
